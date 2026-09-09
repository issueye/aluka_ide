import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "./components/TitleBar";
import ActivityBar from "./components/ActivityBar";
import SideBar from "./components/SideBar";
import EditorArea from "./components/EditorArea";
import Panel from "./components/Panel";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import LanguageManager from "./components/LanguageManager";
import Notifications from "./components/Notifications";
import { clampLayoutToViewport, getLastWorkspaceRoot, useAppStore } from "./store";
import { installKeybindingHub, registerCoreCommands } from "./commands";
import { loadSettings, useSettingsStore } from "./settingsStore";
import { setupTerminalListeners } from "./terminalStore";
import { useLanguageStore } from "./languageStore";
import {
  loadEditorSession,
  reloadFile,
  saveEditorSession,
  useEditorStore,
} from "./editorStore";
import { loadExtensions } from "./extHost/registry";
import { scheduleTreeRefresh } from "./treeStore";
import { useSymbolsStore } from "./symbolsStore";
import { takePendingFile, takePendingWorkspace } from "./tauri";
import type { WorkspaceChange } from "./types";

/** 把当前打开的标签快照持久化（HMR/应用重载后恢复） */
function persistCurrentSession(): void {
  const s = useEditorStore.getState();
  const paths = [
    ...new Set(
      s.groups.flatMap((g) => g.tabs.map((t) => t.path).filter((p) => !p.startsWith("diff:"))),
    ),
  ];
  saveEditorSession({ paths, activePath: s.activePath });
}

export default function App() {
  // 会话恢复完成前禁止持久化：避免首次空快照覆盖已保存的会话
  const sessionReadyRef = useRef(false);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const palette = useAppStore((s) => s.palette);
  const setPalette = useAppStore((s) => s.setPalette);
  const groups = useEditorStore((s) => s.groups);
  const activePath = useEditorStore((s) => s.activePath);

  // 快捷键中枢（FR-08）：单表映射统一分发；命令注册与设置加载一次即可
  useEffect(() => {
    registerCoreCommands();
    void loadSettings();
    void loadExtensions(); // M6：扫描并激活全局/工作区扩展
    void useLanguageStore.getState().load(); // FR-09：自定义 Monarch 语言注册
    const uninstall = installKeybindingHub();
    const uninstallTerminal = setupTerminalListeners();
    return () => {
      uninstall();
      uninstallTerminal();
    };
  }, []);

  // 外部启动参数优先；无参数时恢复最近会话（刷新/重载后工作区不丢）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await takePendingWorkspace();
        if (pending && !cancelled) {
          useAppStore.getState().openWorkspace(pending);
          return;
        }
        const pendingFile = await takePendingFile();
        // 常驻方式打开（preview=false），避免后续预览标签把它替换掉
        if (pendingFile && !cancelled) {
          await useEditorStore.getState().openFile(pendingFile, undefined, { preview: false });
          return;
        }
        const root = getLastWorkspaceRoot();
        if (root && !cancelled) {
          useAppStore.getState().openWorkspace(root);
        }
        const session = loadEditorSession();
        if (session && !cancelled) {
          for (const p of session.paths) {
            if (cancelled) break;
            await useEditorStore.getState().openFile(p, undefined, { preview: false });
          }
          if (!cancelled && session.activePath) {
            const s = useEditorStore.getState();
            if (s.groups.some((g) => g.tabs.some((t) => t.path === session.activePath))) {
              useEditorStore.getState().setActive(session.activePath);
            }
          }
          if (!cancelled) persistCurrentSession();
        }
      } catch {
        // 纯浏览器 dev 下无 Tauri IPC，忽略
      } finally {
        sessionReadyRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 会话快照：标签/活动文件变化时持久化，供 HMR 或应用重载后恢复
  useEffect(() => {
    if (!sessionReadyRef.current) return;
    persistCurrentSession();
  }, [groups, activePath]);

  // 窗口尺寸变化（缩放/最大化/换显示器）后，把侧栏与面板尺寸重新收敛回可用范围，
  // 否则之前拖大的面板（shrink-0）会把编辑器区挤没甚至顶出窗口。
  useEffect(() => {
    clampLayoutToViewport();
    const onResize = () => clampLayoutToViewport();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 自动保存（FR-12 autoSave=afterDelay）：脏文件变化后静默 800ms 全量落盘
  const autoSave = useSettingsStore((s) => s.autoSave);
  const dirtyPaths = useEditorStore((s) => s.dirtyPaths);
  useEffect(() => {
    if (autoSave !== "afterDelay" || dirtyPaths.size === 0) return;
    const timer = setTimeout(() => {
      void useEditorStore.getState().saveAllDirty();
    }, 800);
    return () => clearTimeout(timer);
  }, [autoSave, dirtyPaths]);

  // 工作区文件变更（Rust notify 监听）→ 刷新目录树 + 打开中的编辑器内容。
  // 订阅放在 App 级：侧栏隐藏时事件不丢失。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listen<WorkspaceChange[]>("workspace:changed", (e) => {
          for (const change of e.payload) void reloadFile(change.path);
          scheduleTreeRefresh();
          // 代码跳转的定义索引随文件变更失效，下次使用时重建（FR-20）
          useSymbolsStore.getState().invalidate();
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch {
        // 纯浏览器 dev 下无 Tauri IPC，忽略
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        {/* min-h-0：允许编辑器区随面板挤压，否则内容会溢出到面板之上 */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorArea />
          {panelOpen && <Panel />}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      {palette === "languages" && <LanguageManager onClose={() => setPalette(null)} />}
      <Notifications />
    </div>
  );
}
