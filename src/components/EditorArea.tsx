import { useState } from "react";
import { CodeXml, File, FileText, X } from "lucide-react";
import { useAppStore } from "../store";
import { openFolderDialog } from "../tauri";
import type { EditorTab } from "../editorStore";
import { useEditorStore } from "../editorStore";
import CodeEditor from "./CodeEditor";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + Shift + P", "命令面板（M4）"],
  ["Ctrl + P", "快速打开文件（M4）"],
  ["Ctrl + B", "显示 / 隐藏侧边栏"],
  ["Ctrl + `", "显示 / 隐藏面板"],
  ["Ctrl + S", "保存"],
];

function Kbd({ k, t }: { k: string; t: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-1.5 py-0.5 font-mono text-[11px]">
        {k}
      </kbd>
      <span className="text-[var(--aluka-text-dim)]">{t}</span>
    </div>
  );
}

function Welcome({ onOpenFolder }: { onOpenFolder: () => void }) {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 select-none">
        <div className="flex items-center gap-3">
          <CodeXml size={56} strokeWidth={1.2} className="text-[#0098ff]" />
          <h1 className="text-4xl font-light tracking-wide">Aluka IDE</h1>
        </div>
        <p className="text-[13px] text-[var(--aluka-text-dim)]">
          轻量 · VS Code 观感 · 兼容 VS Code 插件子集
        </p>
        <div className="mt-8 flex items-start gap-16">
          <div className="flex flex-col gap-2.5">
            <span className="mb-1 text-[13px] font-semibold">快捷键</span>
            {SHORTCUTS.map(([k, t]) => (
              <Kbd key={k} k={k} t={t} />
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="mb-1 text-[13px] font-semibold">开始</span>
            <button
              onClick={onOpenFolder}
              className="self-start rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
            >
              打开文件夹
            </button>
            <span className="text-[12px] text-[var(--aluka-text-dim)]">
              {workspaceRoot ? `已打开：${workspaceRoot}` : "尚未打开工作区"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tab({ tab }: { tab: EditorTab }) {
  const activePath = useEditorStore((s) => s.activePath);
  const dirty = useEditorStore((s) => s.dirtyPaths.has(tab.path));
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const tabs = useEditorStore((s) => s.tabs);
  const active = activePath === tab.path;
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);

  // 右键菜单项（VS Code 标签行为子集）
  const closeOthers = () => {
    for (const t of tabs) {
      if (t.path !== tab.path && t.path !== activePath) {
        // closeTab 对脏文件先弹确认（单路径确认）；非脏立即关闭
        closeTab(t.path);
      }
    }
    if (activePath && activePath !== tab.path) closeTab(activePath);
  };
  const closeAll = () => {
    for (const t of [...tabs]) closeTab(t.path);
  };
  const copyPath = () => {
    void navigator.clipboard.writeText(tab.path);
  };

  const MENU: { label: string; action: () => void }[] = [
    { label: "关闭", action: () => closeTab(tab.path) },
    { label: "关闭其他", action: closeOthers },
    { label: "关闭全部", action: closeAll },
    { label: "复制路径", action: copyPath },
  ];

  return (
    <>
      <div
        onClick={() => setActive(tab.path)}
        onAuxClick={(e) => {
          if (e.button === 1) closeTab(tab.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY });
        }}
        title={tab.path}
        className={`group flex h-full min-w-[100px] max-w-[220px] cursor-pointer items-center gap-1.5 border-r border-[var(--aluka-border)] px-3 text-[13px] ${
          active
            ? "border-t-2 border-t-[#0078d4] bg-[var(--aluka-bg)] pt-0.5 text-[var(--aluka-text-active)]"
            : "bg-[var(--aluka-tabs-bg)] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
        }`}
      >
        <File size={14} className="shrink-0" />
        <span className="truncate">{tab.name}</span>
        <button
          title={dirty ? "关闭（有未保存修改）" : "关闭"}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.path);
          }}
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[var(--aluka-hover)]"
        >
          {dirty && <span className="h-2 w-2 rounded-full bg-current group-hover:hidden" />}
          <X size={14} className="hidden group-hover:block" />
        </button>
      </div>
      {/* 标签右键浮动菜单 */}
      {ctx && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[140px] rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] py-1 shadow-2xl"
            style={{ left: ctx.x, top: ctx.y }}
          >
            {MENU.map(({ label, action }) => (
              <button
                key={label}
                onClick={() => {
                  setCtx(null);
                  action();
                }}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] text-[var(--aluka-text)] hover:bg-[var(--aluka-btn-bg)] hover:text-white"
              >
                {label === "关闭" ? (
                  <X size={14} className="shrink-0" />
                ) : (
                  <FileText size={14} className="shrink-0" />
                )}
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function SaveConfirmDialog({ path }: { path: string }) {
  const resolveClose = useEditorStore((s) => s.resolveClose);
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[400px] rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] p-4 shadow-2xl">
        <div className="mb-2 text-[13px] font-semibold text-[var(--aluka-text)]">未保存的更改</div>
        <p className="mb-4 text-[13px] text-[var(--aluka-text-dim)]">
          是否保存对 “{name}” 的更改？
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => void resolveClose(path, "cancel")}
            className="rounded px-3 py-1.5 text-[13px] hover:bg-[var(--aluka-hover)]"
          >
            取消
          </button>
          <button
            onClick={() => void resolveClose(path, "discard")}
            className="rounded px-3 py-1.5 text-[13px] hover:bg-[var(--aluka-hover)]"
          >
            不保存
          </button>
          <button
            onClick={() => void resolveClose(path, "save")}
            className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const error = useEditorStore((s) => s.error);
  const setError = useEditorStore((s) => s.setError);
  const closePromptPath = useEditorStore((s) => s.closePromptPath);
  const openWorkspace = useAppStore((s) => s.openWorkspace);

  const pickFolder = async () => {
    try {
      const p = await openFolderDialog();
      if (p) openWorkspace(p);
    } catch {
      /* 忽略：用户取消等 */
    }
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-[var(--aluka-bg)]">
      {/* 标签栏 */}
      <div className="flex h-9 shrink-0 select-none items-stretch overflow-x-auto border-b border-[var(--aluka-border)] bg-[var(--aluka-tabs-bg)]">
        {tabs.length === 0 ? (
          <div className="flex items-center border-r border-[var(--aluka-border)] px-4 text-[13px] text-[var(--aluka-text-dim)]">
            未打开文件
          </div>
        ) : (
          tabs.map((t) => <Tab key={t.path} tab={t} />)
        )}
      </div>
      {/* 错误提示：浮动层（不挤压编辑器布局），手动关闭 */}
      {error && (
        <div className="absolute left-2 right-2 top-11 z-30 flex items-start gap-2 rounded border border-[#5a2b1d] bg-[#3a231d] px-2 py-1.5 text-[12px] text-[#f48771] shadow-lg">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            title="关闭"
            onClick={() => setError(null)}
            className="px-1 hover:text-[var(--aluka-text-active)]"
          >
            ×
          </button>
        </div>
      )}
      {activePath ? <CodeEditor activePath={activePath} /> : <Welcome onOpenFolder={() => void pickFolder()} />}
      {closePromptPath && <SaveConfirmDialog path={closePromptPath} />}
    </section>
  );
}
