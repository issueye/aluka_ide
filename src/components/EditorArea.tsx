import { useState, useRef, useEffect } from "react";
import {
  BookOpen,
  CodeXml,
  Columns2,
  File,
  FileText,
  Pencil,
  Rows2,
  X,
  GitCompare,
} from "lucide-react";
import { useAppStore } from "../store";
import { openFileDialog, openFolderDialog } from "../tauri";
import type { EditorGroup, EditorTab } from "../editorStore";
import { useEditorStore } from "../editorStore";
import CodeEditor from "./CodeEditor";
import DiffEditor from "./DiffEditor";
import MarkdownPreview from "./MarkdownPreview";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + Shift + P", "命令面板（M4）"],
  ["Ctrl + P", "快速打开文件（M4）"],
  ["F12 / Ctrl + 点击", "转到定义（多命中 Peek 预览）"],
  ["Shift + F12", "查找所有引用（Peek 预览）"],
  ["Alt + ← / →", "后退 / 前进（跳转历史）"],
  ["Ctrl + \\", "向右拆分编辑器"],
  ["Ctrl + 1 / 2", "在编辑器组间切换焦点"],
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

function Welcome({
  onOpenFolder,
  onOpenFile,
}: {
  onOpenFolder: () => void;
  onOpenFile: () => void;
}) {
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
            <div className="flex flex-col gap-2">
              <button
                onClick={onOpenFile}
                className="self-start rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
              >
                打开文件…
              </button>
              <button
                onClick={onOpenFolder}
                className="self-start rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
              >
                打开文件夹
              </button>
            </div>
            <span className="text-[12px] text-[var(--aluka-text-dim)]">
              {workspaceRoot ? `已打开：${workspaceRoot}` : "尚未打开工作区"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tab({ tab, groupId, isActiveGroup }: { tab: EditorTab; groupId: string; isActiveGroup: boolean }) {
  const group = useEditorStore((s) => s.groups.find((g) => g.id === groupId));
  const dirty = useEditorStore((s) => s.dirtyPaths.has(tab.path));
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const closeTab = useEditorStore((s) => s.closeTab);
  const pinTab = useEditorStore((s) => s.pinTab);
  const tabs = group?.tabs ?? [];
  const active = group?.activePath === tab.path;
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);

  // 右键菜单项（VS Code 标签行为子集）
  const closeOthers = () => {
    for (const t of tabs) {
      if (t.path !== tab.path && t.path !== group?.activePath) {
        closeTab(t.path, groupId);
      }
    }
    if (group?.activePath && group.activePath !== tab.path) {
      closeTab(group.activePath, groupId);
    }
  };
  const closeAll = () => {
    for (const t of [...tabs]) closeTab(t.path, groupId);
  };
  const copyPath = () => {
    void navigator.clipboard.writeText(tab.path);
  };

  const MENU: { label: string; action: () => void }[] = [
    ...(tab.preview ? [{ label: "保持打开", action: () => pinTab(tab.path, groupId) }] : []),
    { label: "关闭", action: () => closeTab(tab.path, groupId) },
    { label: "关闭其他", action: closeOthers },
    { label: "关闭全部", action: closeAll },
    { label: "复制路径", action: copyPath },
  ];

  return (
    <>
      <div
        onClick={() => {
          setActiveTab(tab.path, groupId);
          setActiveGroup(groupId);
        }}
        onDoubleClick={() => pinTab(tab.path, groupId)}
        onAuxClick={(e) => {
          if (e.button === 1) closeTab(tab.path, groupId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY });
        }}
        title={tab.preview ? `${tab.path}（预览）` : tab.path}
        className={`group flex h-full min-w-[100px] max-w-[220px] cursor-pointer items-center gap-1.5 border-r border-[var(--aluka-border)] px-3 text-[13px] ${
          active
            ? `${
                isActiveGroup
                  ? "border-t-2 border-t-[#0078d4]"
                  : "border-t-2 border-t-[var(--aluka-border)] opacity-80"
              } bg-[var(--aluka-bg)] pt-0.5 text-[var(--aluka-text-active)]`
            : "bg-[var(--aluka-tabs-bg)] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
        }`}
      >
        {tab.isDiff ? (
          <GitCompare size={14} className="shrink-0 text-[#007acc]" />
        ) : (
          <File size={14} className="shrink-0" />
        )}
        <span className={`truncate ${tab.preview ? "italic" : ""}`}>{tab.name}</span>
        <button
          title={dirty ? "关闭（有未保存修改）" : "关闭"}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.path, groupId);
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
            onClick={() => void resolveClose("cancel")}
            className="rounded px-3 py-1.5 text-[13px] hover:bg-[var(--aluka-hover)]"
          >
            取消
          </button>
          <button
            onClick={() => void resolveClose("discard")}
            className="rounded px-3 py-1.5 text-[13px] hover:bg-[var(--aluka-hover)]"
          >
            不保存
          </button>
          <button
            onClick={() => void resolveClose("save")}
            className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorGroupView({
  group,
  isSingle,
  onOpenFolder,
  onOpenFile,
}: {
  group: EditorGroup;
  isSingle: boolean;
  onOpenFolder: () => void;
  onOpenFile: () => void;
}) {
  const activeGroupId = useEditorStore((s) => s.activeGroupId);
  const splitGroup = useEditorStore((s) => s.splitGroup);
  const closeGroup = useEditorStore((s) => s.closeGroup);
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const togglePreview = useEditorStore((s) => s.togglePreview);
  const isMarkdownPath = useEditorStore((s) => s.isMarkdownPath);
  const inPreview = useEditorStore((s) =>
    group.activePath ? s.previewPaths.has(group.activePath) : false,
  );
  const isActiveGroup = activeGroupId === group.id;
  const activeIsMarkdown = isMarkdownPath(group.activePath);

  return (
    <div
      onClick={() => setActiveGroup(group.id)}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--aluka-bg)] ${
        !isSingle && isActiveGroup ? "ring-1 ring-inset ring-[#0078d4]/40" : ""
      }`}
    >
      {/* 组标签栏 */}
      <div className="flex h-9 shrink-0 select-none items-stretch border-b border-[var(--aluka-border)] bg-[var(--aluka-tabs-bg)]">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {group.tabs.length === 0 ? (
            <div className="flex items-center border-r border-[var(--aluka-border)] px-4 text-[13px] text-[var(--aluka-text-dim)]">
              未打开文件
            </div>
          ) : (
            group.tabs.map((t) => (
              <Tab key={t.path} tab={t} groupId={group.id} isActiveGroup={isActiveGroup} />
            ))
          )}
        </div>
        {/* 右侧组操作按钮 */}
        <div className="flex shrink-0 items-center gap-0.5 px-1.5 text-[var(--aluka-text-dim)]">
          {activeIsMarkdown && group.activePath && (
            <button
              title={inPreview ? "返回编辑 (Ctrl+Shift+V)" : "打开预览 (Ctrl+Shift+V)"}
              onClick={(e) => {
                e.stopPropagation();
                togglePreview(group.activePath as string);
              }}
              className={`flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text-active)] ${
                inPreview ? "bg-[var(--aluka-hover)] text-[var(--aluka-text-active)]" : ""
              }`}
            >
              {inPreview ? <Pencil size={15} /> : <BookOpen size={15} />}
            </button>
          )}
          <button
            title="向右拆分编辑器 (Ctrl+\)"
            onClick={(e) => {
              e.stopPropagation();
              splitGroup("horizontal", group.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text-active)]"
          >
            <Columns2 size={15} />
          </button>
          <button
            title="向下拆分编辑器"
            onClick={(e) => {
              e.stopPropagation();
              splitGroup("vertical", group.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text-active)]"
          >
            <Rows2 size={15} />
          </button>
          {!isSingle && (
            <button
              title="关闭编辑器组"
              onClick={(e) => {
                e.stopPropagation();
                closeGroup(group.id);
              }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text-active)]"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 编辑器本体 / Markdown 预览 / 差异对比 / 欢迎页 */}
      {group.activePath ? (
        group.tabs.find((t) => t.path === group.activePath)?.isDiff ? (
          <DiffEditor
            path={group.activePath}
            original={group.tabs.find((t) => t.path === group.activePath)?.diffOriginal ?? ""}
            modified={group.tabs.find((t) => t.path === group.activePath)?.diffModified ?? ""}
          />
        ) : inPreview && activeIsMarkdown ? (
          <MarkdownPreview path={group.activePath} />
        ) : (
          <CodeEditor groupId={group.id} activePath={group.activePath} />
        )
      ) : isSingle ? (
        <Welcome onOpenFolder={onOpenFolder} onOpenFile={onOpenFile} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--aluka-text-dim)] select-none">
          点击侧栏文件在该组打开
        </div>
      )}
    </div>
  );
}

function Splitter({
  direction,
  containerRef,
}: {
  direction: "horizontal" | "vertical";
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const setSplitRatio = useEditorStore((s) => s.setSplitRatio);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (direction === "horizontal") {
        const ratio = (e.clientX - rect.left) / rect.width;
        setSplitRatio(ratio);
      } else {
        const ratio = (e.clientY - rect.top) / rect.height;
        setSplitRatio(ratio);
      }
    };
    const onMouseUp = () => setDragging(false);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, direction, containerRef, setSplitRatio]);

  return (
    <>
      {dragging && (
        <div
          className={`fixed inset-0 z-50 ${
            direction === "horizontal" ? "cursor-col-resize" : "cursor-row-resize"
          }`}
        />
      )}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setSplitRatio(0.5)}
        title="双击重置为 50%"
        className={`shrink-0 bg-[var(--aluka-border)] transition-colors hover:bg-[#0078d4] ${
          direction === "horizontal"
            ? "w-1 cursor-col-resize hover:w-1.5"
            : "h-1 cursor-row-resize hover:h-1.5"
        }`}
      />
    </>
  );
}

export default function EditorArea() {
  const groups = useEditorStore((s) => s.groups);
  const layoutDirection = useEditorStore((s) => s.layoutDirection);
  const splitRatio = useEditorStore((s) => s.splitRatio);
  const error = useEditorStore((s) => s.error);
  const setError = useEditorStore((s) => s.setError);
  const closePrompt = useEditorStore((s) => s.closePrompt);
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const containerRef = useRef<HTMLDivElement>(null);

  const pickFolder = async () => {
    try {
      const p = await openFolderDialog();
      if (p) openWorkspace(p);
    } catch {
      /* 忽略：用户取消等 */
    }
  };

  const pickFile = async () => {
    try {
      const p = await openFileDialog();
      // 常驻方式打开：纯文件视图下标签不因预览替换被清掉
      if (p) await useEditorStore.getState().openFile(p, undefined, { preview: false });
    } catch {
      /* 忽略：用户取消等 */
    }
  };

  const isSplit = groups.length > 1 && layoutDirection !== "single";

  return (
    <section ref={containerRef} className="relative flex min-h-0 flex-1 flex-col bg-[var(--aluka-bg)]">
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

      {/* 编辑器组布局 */}
      {!isSplit ? (
        <EditorGroupView
          group={groups[0]}
          isSingle={true}
          onOpenFolder={() => void pickFolder()}
          onOpenFile={() => void pickFile()}
        />
      ) : (
        <div
          className={`flex min-h-0 min-w-0 flex-1 ${
            layoutDirection === "horizontal" ? "flex-row" : "flex-col"
          }`}
        >
          <div
            style={
              layoutDirection === "horizontal"
                ? { width: `${splitRatio * 100}%` }
                : { height: `${splitRatio * 100}%` }
            }
            className="flex min-h-0 min-w-0 flex-col"
          >
            <EditorGroupView
              group={groups[0]}
              isSingle={false}
              onOpenFolder={() => void pickFolder()}
              onOpenFile={() => void pickFile()}
            />
          </div>

          <Splitter direction={layoutDirection} containerRef={containerRef} />

          <div
            style={
              layoutDirection === "horizontal"
                ? { width: `${(1 - splitRatio) * 100}%` }
                : { height: `${(1 - splitRatio) * 100}%` }
            }
            className="flex min-h-0 min-w-0 flex-col"
          >
            <EditorGroupView
              group={groups[1]}
              isSingle={false}
              onOpenFolder={() => void pickFolder()}
              onOpenFile={() => void pickFile()}
            />
          </div>
        </div>
      )}

      {closePrompt && <SaveConfirmDialog path={closePrompt.path} />}
    </section>
  );
}

