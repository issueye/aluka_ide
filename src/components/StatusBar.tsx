import { useEffect, useState } from "react";
import { Bell, Check, GitBranch, Plus, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { useEditorStore } from "../editorStore";
import { useStatusStore } from "../statusStore";
import { useGitStore } from "../gitStore";

/** 状态栏：行列 / EOL / 语言来自编辑器实时事件；git 分支随工作区/文件变更刷新 */
export default function StatusBar() {
  const workspaceName = useAppStore((s) => s.workspaceName);
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const status = useStatusStore();
  const activeTab = tabs.find((t) => t.path === activePath);

  const {
    status: gitStatus,
    branches,
    branchMenuOpen,
    setBranchMenuOpen,
    refresh,
    loadBranches,
    checkout,
    createBranch,
  } = useGitStore();

  const [newBranchInput, setNewBranchInput] = useState("");
  const [creating, setCreating] = useState(false);

  // 分支与状态刷新：工作区切换时拉取；文件变更事件（含 .git/HEAD 变化）去抖重拉
  useEffect(() => {
    if (!workspaceRoot) return;

    void refresh(workspaceRoot);

    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void listen("workspace:changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh(workspaceRoot);
      }, 500);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      clearTimeout(timer);
      unlisten?.();
    };
  }, [workspaceRoot, refresh]);

  const currentBranch = gitStatus?.branch;

  const handleOpenBranchMenu = () => {
    if (!workspaceRoot) return;
    void loadBranches(workspaceRoot);
    setBranchMenuOpen(true);
    setCreating(false);
    setNewBranchInput("");
  };

  const handleCreateBranch = () => {
    if (!workspaceRoot || !newBranchInput.trim()) return;
    void createBranch(workspaceRoot, newBranchInput);
    setCreating(false);
    setNewBranchInput("");
  };

  return (
    <>
      <footer className="flex h-6 shrink-0 select-none items-center justify-between bg-[var(--aluka-statusbar-bg)] px-2 text-[12px] text-white">
        <div className="flex items-center gap-1">
          {currentBranch && (
            <button
              title="切换/创建分支"
              onClick={handleOpenBranchMenu}
              className="flex items-center gap-1 px-1 hover:bg-white/20"
            >
              <GitBranch size={12} />
              {currentBranch}
            </button>
          )}
          <span className="px-1 hover:bg-white/20">{workspaceName || "未打开工作区"}</span>
          {activeTab?.readOnly && (
            <span className="px-1 font-semibold hover:bg-white/20">只读</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="px-1 hover:bg-white/20">
            行 {status.line}，列 {status.col}
          </span>
          <span className="px-1 hover:bg-white/20">空格: 4</span>
          <span className="px-1 hover:bg-white/20">UTF-8</span>
          <span className="px-1 hover:bg-white/20">{status.eol}</span>
          <span className="px-1 hover:bg-white/20">{status.language}</span>
          <button title="通知" className="px-1 hover:bg-white/20">
            <Bell size={13} />
          </button>
        </div>
      </footer>

      {/* 分支切换/新建浮层 */}
      {branchMenuOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setBranchMenuOpen(false)} />
          <div className="fixed bottom-7 left-2 z-50 w-72 overflow-hidden rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--aluka-border)] px-3 py-2 text-[12px] font-semibold text-[var(--aluka-text)]">
              <span>切换分支</span>
              <button
                onClick={() => setBranchMenuOpen(false)}
                className="rounded p-0.5 hover:bg-[var(--aluka-hover)]"
              >
                <X size={14} />
              </button>
            </div>

            {creating ? (
              <div className="p-3">
                <input
                  autoFocus
                  value={newBranchInput}
                  onChange={(e) => setNewBranchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateBranch();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="输入新分支名称并按回车..."
                  className="w-full rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 py-1 text-[12px] text-[var(--aluka-text)] outline-none focus:border-[#007acc]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setCreating(false)}
                    className="rounded px-2.5 py-1 text-[11px] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateBranch}
                    disabled={!newBranchInput.trim()}
                    className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1 text-[11px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-40"
                  >
                    创建
                  </button>
                </div>
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto py-1">
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#3b8eea] hover:bg-[var(--aluka-hover)]"
                >
                  <Plus size={14} />
                  <span>创建新分支...</span>
                </button>
                <div className="my-1 border-t border-[var(--aluka-border)]" />
                {branches.map((b) => {
                  const isCurrent = b === currentBranch;
                  return (
                    <button
                      key={b}
                      onClick={() => workspaceRoot && void checkout(workspaceRoot, b)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-[var(--aluka-btn-bg)] hover:text-white ${
                        isCurrent
                          ? "font-semibold text-[var(--aluka-text-active)]"
                          : "text-[var(--aluka-text)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <GitBranch size={13} className="shrink-0" />
                        <span className="truncate">{b}</span>
                      </div>
                      {isCurrent && <Check size={14} className="shrink-0 text-[#007acc]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
