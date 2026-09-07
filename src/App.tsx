import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "./components/TitleBar";
import ActivityBar from "./components/ActivityBar";
import SideBar from "./components/SideBar";
import EditorArea from "./components/EditorArea";
import Panel from "./components/Panel";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import Notifications from "./components/Notifications";
import { useAppStore } from "./store";
import { installKeybindingHub, registerCoreCommands } from "./commands";
import { loadSettings, useSettingsStore } from "./settingsStore";
import { setupTerminalListeners } from "./terminalStore";
import { useEditorStore } from "./editorStore";
import { loadExtensions } from "./extHost/registry";
import { scheduleTreeRefresh } from "./treeStore";
import { useSymbolsStore } from "./symbolsStore";
import { takePendingWorkspace } from "./tauri";

export default function App() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelOpen = useAppStore((s) => s.panelOpen);

  // 快捷键中枢（FR-08）：单表映射统一分发；命令注册与设置加载一次即可
  useEffect(() => {
    registerCoreCommands();
    void loadSettings();
    void loadExtensions(); // M6：扫描并激活全局/工作区扩展
    const uninstall = installKeybindingHub();
    const uninstallTerminal = setupTerminalListeners();
    return () => {
      uninstall();
      uninstallTerminal();
    };
  }, []);

  // 外部目录参数：取走后作为工作区打开
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await takePendingWorkspace();
        if (pending && !cancelled) useAppStore.getState().openWorkspace(pending);
      } catch {
        // 纯浏览器 dev 下无 Tauri IPC，忽略
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // 工作区文件变更（Rust notify 监听）→ 防抖刷新目录树。
  // 订阅放在 App 级：侧栏隐藏时事件不丢失。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listen<string[]>("workspace:changed", () => {
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
        <main className="flex min-w-0 flex-1 flex-col">
          <EditorArea />
          {panelOpen && <Panel />}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <Notifications />
    </div>
  );
}
