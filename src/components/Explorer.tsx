import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "../store";
import { useTreeStore } from "../treeStore";
import { useEditorStore } from "../editorStore";
import { createEntry, deleteEntry, openFolderDialog, renameEntry, revealInExplorer } from "../tauri";
import { openTerminalAt } from "../commands";
import type { FileNode } from "../types";

/** 常见扩展名 → 图标/颜色（轻量实现；文件图标主题属 M6 扩展范畴） */
const FILE_ICONS: Record<string, { icon: LucideIcon; cls: string }> = {
  ts: { icon: FileCode2, cls: "text-[#3178c6]" },
  tsx: { icon: FileCode2, cls: "text-[#3178c6]" },
  js: { icon: FileCode2, cls: "text-[#e8d44d]" },
  jsx: { icon: FileCode2, cls: "text-[#e8d44d]" },
  json: { icon: FileJson, cls: "text-[#cbcb41]" },
  rs: { icon: FileCode2, cls: "text-[#dea584]" },
  py: { icon: FileCode2, cls: "text-[#4b8bbe]" },
  html: { icon: FileCode2, cls: "text-[#e44d26]" },
  css: { icon: FileCode2, cls: "text-[#519aba]" },
  md: { icon: FileText, cls: "text-[#519aba]" },
  toml: { icon: FileText, cls: "text-[#9c4221]" },
};

function FileIcon({ name }: { name: string }) {
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const meta = FILE_ICONS[ext];
  if (!meta) return <File size={14} className="shrink-0 text-[#8b8b8b]" />;
  const Icon = meta.icon;
  return <Icon size={14} className={`shrink-0 ${meta.cls}`} />;
}

function IconAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
        disabled
          ? "cursor-default text-[var(--aluka-text-dim)] opacity-40"
          : "text-[var(--aluka-text)] hover:bg-[var(--aluka-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

/** 树内联输入框：新建 / 重命名。Enter 或失焦提交，Escape 取消。 */
function InlineInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    if (initial) ref.current?.select();
  }, [initial]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const name = ref.current?.value.trim() ?? "";
    if (name) onCommit(name);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      className="h-[22px] min-w-0 flex-1 rounded-sm border border-[#0078d4] bg-[var(--aluka-input-bg)] px-1 text-[13px] text-[var(--aluka-text)] outline-none"
    />
  );
}

interface MenuItem {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  action: () => void;
}

function parentOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

function joinPath(parent: string, name: string): string {
  return parent.replace(/[\\/]+$/, "") + "\\" + name;
}

/** 资源管理器：懒加载目录树 + CRUD（新建/重命名/删除→回收站）+ 自动刷新 */
export default function Explorer() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const workspaceName = useAppStore((s) => s.workspaceName);
  const openWorkspace = useAppStore((s) => s.openWorkspace);

  const tree = useTreeStore((s) => s.tree);
  const expanded = useTreeStore((s) => s.expanded);
  const selected = useTreeStore((s) => s.selected);
  const toggleDir = useTreeStore((s) => s.toggleDir);
  const setSelected = useTreeStore((s) => s.setSelected);
  const loadDir = useTreeStore((s) => s.loadDir);
  const expandDir = useTreeStore((s) => s.expandDir);

  const [pendingNew, setPendingNew] = useState<{ parent: string; isDir: boolean } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [deleting, setDeleting] = useState<FileNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explorerRequest = useAppStore((s) => s.explorerRequest);

  const pickFolder = async () => {
    try {
      const p = await openFolderDialog();
      if (p) openWorkspace(p);
    } catch (e) {
      setError(String(e));
    }
  };

  const refresh = () => {
    if (!workspaceRoot) return;
    void loadDir(workspaceRoot);
  };

  const startNew = (parent: string, isDir: boolean) => {
    setMenu(null);
    setPendingNew({ parent, isDir });
    void expandDir(parent);
  };

  // 菜单「文件 → 新建文本文件/文件夹」联动：seq 变化时在根目录弹内联输入框
  useEffect(() => {
    if (!explorerRequest || !workspaceRoot) return;
    startNew(workspaceRoot, explorerRequest.kind === "newFolder");
    // 仅由菜单请求信号驱动，避免常规重渲染时重复弹出输入框
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerRequest]);

  const commitNew = async (parent: string, isDir: boolean, name: string) => {
    setPendingNew(null);
    const path = joinPath(parent, name);
    try {
      await createEntry(path, isDir);
      await loadDir(parent);
      if (isDir) await expandDir(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const commitRename = async (node: FileNode, name: string) => {
    setRenaming(null);
    if (name === node.name) return;
    const newPath = joinPath(parentOf(node.path), name);
    try {
      await renameEntry(node.path, newPath);
      await loadDir(parentOf(node.path));
      // 展开集合中的旧路径同步迁移
      const { expanded: exp } = useTreeStore.getState();
      if (exp.has(node.path)) {
        const next = new Set(exp);
        next.delete(node.path);
        useTreeStore.setState({ expanded: next });
        void expandDir(newPath);
      }
      setSelected(newPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const confirmDelete = async (node: FileNode) => {
    setDeleting(null);
    try {
      await deleteEntry(node.path);
      await loadDir(parentOf(node.path));
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const menuItemsFor = (node: FileNode): MenuItem[] => {
    const target = node.isDir ? node.path : parentOf(node.path);
    const items: MenuItem[] = [
      {
        label: "新建文件",
        icon: FilePlus,
        action: () => startNew(target, false),
      },
      {
        label: "新建文件夹",
        icon: FolderPlus,
        action: () => startNew(target, true),
      },
    ];
    if (node.isDir) {
      items.push({
        label: "刷新目录",
        icon: RefreshCw,
        action: () => {
          setMenu(null);
          void loadDir(node.path);
        },
      });
    }
    items.push(
      {
        label: "在控制台打开",
        icon: Terminal,
        action: () => {
          setMenu(null);
          openTerminalAt(target);
        },
      },
      {
        label: "从文件资源管理器打开",
        icon: FolderSearch,
        action: () => {
          setMenu(null);
          void revealInExplorer(node.path);
        },
      },
    );
    items.push(
      {
        label: "重命名",
        icon: Pencil,
        action: () => {
          setMenu(null);
          setRenaming(node.path);
        },
      },
      {
        label: "删除",
        icon: Trash2,
        danger: true,
        action: () => {
          setMenu(null);
          setDeleting(node);
        },
      },
    );
    return items;
  };

  const renderNodes = (nodes: FileNode[], depth: number): ReactNode[] =>
    nodes.map((n) => {
      const rowIndent = { paddingLeft: 8 + depth * 12 }; // 树层级缩进为动态计算布局
      const icon = n.isDir ? (
        expanded.has(n.path) ? (
          <FolderOpen size={14} className="shrink-0 text-[#c09553]" />
        ) : (
          <Folder size={14} className="shrink-0 text-[#c09553]" />
        )
      ) : (
        <FileIcon name={n.name} />
      );
      const chevron = n.isDir ? (
        expanded.has(n.path) ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )
      ) : (
        <span className="w-[14px] shrink-0" />
      );
      return (
        <div key={n.path}>
          {renaming === n.path ? (
            <div
              className="flex h-[22px] items-center gap-1 pr-2"
              style={rowIndent}
            >
              {icon}
              <InlineInput
                initial={n.name}
                onCommit={(name) => void commitRename(n, name)}
                onCancel={() => setRenaming(null)}
              />
            </div>
          ) : (
            <button
              onClick={() => {
                toggleDir(n);
                if (!n.isDir) void useEditorStore.getState().openFile(n.path);
              }}
              onDoubleClick={() => {
                // 双击以常驻方式打开（预览标签转常驻）
                if (!n.isDir) void useEditorStore.getState().openFile(n.path, undefined, { preview: false });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected(n.path);
                setMenu({
                  x: Math.min(e.clientX, window.innerWidth - 200),
                  y: Math.min(e.clientY, window.innerHeight - 240),
                  node: n,
                });
              }}
              title={n.path}
              style={rowIndent}
              className={`flex h-[22px] w-full items-center gap-1 pr-2 text-left text-[13px] hover:bg-[var(--aluka-hover)] ${
                selected === n.path ? "bg-[var(--aluka-active)]" : ""
              }`}
            >
              {chevron}
              {icon}
              <span className="truncate">{n.name}</span>
            </button>
          )}
          {n.isDir && expanded.has(n.path) && (
            <>
              {pendingNew?.parent === n.path && (
                <div
                  className="flex h-[22px] items-center gap-1 pr-2"
                  style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                >
                  {pendingNew.isDir ? (
                    <Folder size={14} className="shrink-0 text-[#c09553]" />
                  ) : (
                    <File size={14} className="shrink-0 text-[#8b8b8b]" />
                  )}
                  <InlineInput
                    initial=""
                    placeholder={pendingNew.isDir ? "文件夹名称" : "文件名称"}
                    onCommit={(name) => void commitNew(n.path, pendingNew.isDir, name)}
                    onCancel={() => setPendingNew(null)}
                  />
                </div>
              )}
              {tree.has(n.path) && renderNodes(tree.get(n.path)!, depth + 1)}
            </>
          )}
        </div>
      );
    });

  if (!workspaceRoot) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 pt-12 text-center">
        <FolderOpen size={40} strokeWidth={1} className="text-[var(--aluka-text-dim)]" />
        <p className="text-[13px] text-[var(--aluka-text-dim)]">未打开文件夹</p>
        <button
          onClick={() => void pickFolder()}
          className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
        >
          打开文件夹
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 工作区根节点行 */}
      <div className="flex h-[22px] select-none items-center justify-between pr-2 hover:bg-[var(--aluka-hover)]">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 pl-1">
          <ChevronDown size={14} className="shrink-0" />
          <span className="truncate text-[11px] font-bold uppercase tracking-wide">
            {workspaceName}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconAction title="新建文件" onClick={() => startNew(workspaceRoot, false)}>
            <FilePlus size={14} />
          </IconAction>
          <IconAction title="新建文件夹" onClick={() => startNew(workspaceRoot, true)}>
            <FolderPlus size={14} />
          </IconAction>
          <IconAction title="刷新资源管理器" onClick={refresh}>
            <RefreshCw size={14} />
          </IconAction>
          <IconAction title="打开文件夹" onClick={() => void pickFolder()}>
            <FolderOpen size={14} />
          </IconAction>
        </div>
      </div>
      {pendingNew?.parent === workspaceRoot && (
        <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 20 }}>
          {pendingNew.isDir ? (
            <Folder size={14} className="shrink-0 text-[#c09553]" />
          ) : (
            <File size={14} className="shrink-0 text-[#8b8b8b]" />
          )}
          <InlineInput
            initial=""
            placeholder={pendingNew.isDir ? "文件夹名称" : "文件名称"}
            onCommit={(name) => void commitNew(workspaceRoot, pendingNew.isDir, name)}
            onCancel={() => setPendingNew(null)}
          />
        </div>
      )}
      {tree.has(workspaceRoot) ? (
        renderNodes(tree.get(workspaceRoot)!, 1)
      ) : (
        <div className="px-4 py-2 text-[12px] text-[var(--aluka-text-dim)]">加载中…</div>
      )}
      {error && (
        <div className="mx-2 mt-2 rounded border border-[#5a1d1d] bg-[#3a1d1d] px-2 py-1 text-[12px] text-[#f48771]">
          {error}
          <button
            title="关闭"
            onClick={() => setError(null)}
            className="float-right -mt-0.5 px-1 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* 右键菜单 */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[180px] rounded-md border border-[#454545] bg-[var(--aluka-overlay-bg)] py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {menuItemsFor(menu.node).map(({ label, icon: Icon, danger, action }) => (
              <button
                key={label}
                onClick={action}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-[var(--aluka-btn-bg)] hover:text-white ${
                  danger ? "text-[#f48771]" : "text-[var(--aluka-text)]"
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 删除确认弹窗 */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[360px] rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] p-4 shadow-2xl">
            <div className="mb-2 text-[13px] font-semibold">删除</div>
            <p className="mb-4 text-[13px] text-[var(--aluka-text-dim)]">
              确定要删除 “{deleting.name}”
              吗？{deleting.isDir ? "及其全部内容将" : "将"}移入回收站。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleting(null)}
                className="rounded px-3 py-1.5 text-[13px] hover:bg-[var(--aluka-hover)]"
              >
                取消
              </button>
              <button
                onClick={() => void confirmDelete(deleting)}
                className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[13px] text-white hover:bg-[var(--aluka-btn-hover)]"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
