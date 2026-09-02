import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitFork,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useAppStore } from "../store";
import { useGitStore } from "../gitStore";
import { useEditorStore } from "../editorStore";
import { gitGetFileContent, readFile } from "../tauri";
import type { GitFileChange } from "../tauri";

/** 状态徽标颜色与文案 */
function StatusBadge({ status, staged }: { status: string; staged: boolean }) {
  let color = "text-[var(--aluka-text-dim)]";
  if (status === "M") color = staged ? "text-[#89d185]" : "text-[#e2c08d]";
  else if (status === "A" || status === "U") color = "text-[#73c991]";
  else if (status === "D") color = "text-[#f14c4c]";
  else if (status === "R") color = "text-[#3b8eea]";

  return <span className={`font-mono text-[11px] font-semibold ${color}`}>{status}</span>;
}

/** 分解路径为文件名与所在目录 */
function splitPath(fullPath: string): { fileName: string; dirPath: string } {
  const normalized = fullPath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx === -1) return { fileName: normalized, dirPath: "" };
  return {
    fileName: normalized.slice(idx + 1),
    dirPath: normalized.slice(0, idx),
  };
}

export default function SourceControlView() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const {
    status,
    loading,
    commitMessage,
    setCommitMessage,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    push,
    pull,
    initRepo,
  } = useGitStore();
  const openDiff = useEditorStore((s) => s.openDiff);

  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);

  // 初始化与定时刷新
  useEffect(() => {
    if (workspaceRoot) {
      void refresh(workspaceRoot);
    }
  }, [workspaceRoot, refresh]);

  if (!workspaceRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-[12px] text-[var(--aluka-text-dim)]">
        打开工作区以使用源代码管理
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <GitFork size={36} className="mb-3 text-[var(--aluka-text-dim)]" />
        <p className="mb-4 text-[13px] text-[var(--aluka-text-dim)]">
          当前工作区尚未启用 Git 源代码管理
        </p>
        <button
          onClick={() => void initRepo(workspaceRoot)}
          disabled={loading}
          className="rounded bg-[var(--aluka-btn-bg)] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
        >
          初始化 Git 仓库
        </button>
      </div>
    );
  }

  const stagedList = status?.staged ?? [];
  const unstagedList = status?.unstaged ?? [];
  const totalCount = stagedList.length + unstagedList.length;

  /** 点击变更文件打开 Diff 差异比对 */
  const handleOpenDiff = async (file: GitFileChange) => {
    if (!workspaceRoot) return;
    try {
      // 1. 获取 HEAD 版本
      const original = await gitGetFileContent(workspaceRoot, file.path, "HEAD");
      // 2. 获取当前本地工作区文件内容
      const fullAbsPath = `${workspaceRoot.replace(/[\\/]+$/, "")}/${file.path}`;
      let modified = "";
      if (file.status !== "D") {
        try {
          const res = await readFile(fullAbsPath);
          modified = res.content;
        } catch {
          modified = "";
        }
      }
      openDiff(fullAbsPath, original, modified, `${file.path} (Working Tree ↔ HEAD)`);
    } catch (e) {
      console.error("打开 Diff 失败:", e);
    }
  };

  /** 提交操作 */
  const handleCommit = async () => {
    if (!commitMessage.trim() || loading) return;
    await commit(workspaceRoot);
  };

  return (
    <div className="flex h-full flex-col text-[12px]">
      {/* 顶部工具栏 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--aluka-border)] px-3 text-[var(--aluka-text-dim)]">
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] font-semibold uppercase tracking-wider text-[var(--aluka-text)]">
          <GitBranch size={13} className="shrink-0 text-[#007acc]" />
          <span className="truncate">{status?.branch ?? "git"}</span>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="text-[10px] text-[var(--aluka-text-dim)]">
              {status.ahead > 0 && `↑${status.ahead} `}
              {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            title="拉取 (Pull)"
            onClick={() => void pull(workspaceRoot)}
            disabled={loading}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)] disabled:opacity-40"
          >
            <ArrowDown size={13} />
          </button>
          <button
            title="推送 (Push)"
            onClick={() => void push(workspaceRoot)}
            disabled={loading}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)] disabled:opacity-40"
          >
            <ArrowUp size={13} />
          </button>
          <button
            title="刷新状态"
            onClick={() => void refresh(workspaceRoot)}
            disabled={loading}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)] disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 提交说明输入区 */}
      <div className="shrink-0 border-b border-[var(--aluka-border)] p-3">
        <div className="relative">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleCommit();
              }
            }}
            placeholder="提交说明 (Ctrl+Enter 快速提交)"
            rows={3}
            className="w-full resize-none rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] p-2 font-mono text-[12px] text-[var(--aluka-text)] placeholder-[var(--aluka-text-dim)] outline-none focus:border-[#007acc]"
          />
        </div>
        <button
          onClick={() => void handleCommit()}
          disabled={!commitMessage.trim() || loading || totalCount === 0}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded bg-[var(--aluka-btn-bg)] py-1.5 text-[12px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={14} />
          <span>{stagedList.length > 0 ? "提交暂存更改" : "暂存所有并提交"}</span>
        </button>
      </div>

      {/* 变更列表滚动区 */}
      <div className="flex-1 overflow-y-auto">
        {/* 暂存的更改 */}
        {stagedList.length > 0 && (
          <div className="border-b border-[var(--aluka-border)]">
            <div
              onClick={() => setStagedCollapsed(!stagedCollapsed)}
              className="group flex h-7 cursor-pointer select-none items-center justify-between px-2 text-[11px] font-semibold text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
            >
              <div className="flex items-center gap-1">
                {stagedCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span className="uppercase tracking-wider">暂存的更改</span>
                <span className="ml-1 rounded-full bg-[var(--aluka-active)] px-1.5 py-0.2 text-[10px] text-[var(--aluka-text)]">
                  {stagedList.length}
                </span>
              </div>
              <button
                title="全部取消暂存"
                onClick={(e) => {
                  e.stopPropagation();
                  void unstage(workspaceRoot, []);
                }}
                className="hidden h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-active)] hover:text-[var(--aluka-text)] group-hover:flex"
              >
                <Minus size={13} />
              </button>
            </div>

            {!stagedCollapsed && (
              <div className="py-0.5">
                {stagedList.map((file) => {
                  const { fileName, dirPath } = splitPath(file.path);
                  return (
                    <div
                      key={file.path}
                      onClick={() => void handleOpenDiff(file)}
                      className="group flex h-6 cursor-pointer items-center justify-between px-3 text-[12px] hover:bg-[var(--aluka-hover)]"
                    >
                      <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden">
                        <span className="truncate text-[var(--aluka-text)]">{fileName}</span>
                        {dirPath && (
                          <span className="truncate text-[11px] text-[var(--aluka-text-dim)]">
                            {dirPath}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          title="取消暂存"
                          onClick={(e) => {
                            e.stopPropagation();
                            void unstage(workspaceRoot, [file.path]);
                          }}
                          className="hidden h-4 w-4 items-center justify-center rounded hover:bg-[var(--aluka-active)] group-hover:flex"
                        >
                          <Minus size={12} />
                        </button>
                        <StatusBadge status={file.status} staged={true} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 未暂存更改 */}
        <div>
          <div
            onClick={() => setChangesCollapsed(!changesCollapsed)}
            className="group flex h-7 cursor-pointer select-none items-center justify-between px-2 text-[11px] font-semibold text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
          >
            <div className="flex items-center gap-1">
              {changesCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="uppercase tracking-wider">更改</span>
              <span className="ml-1 rounded-full bg-[var(--aluka-active)] px-1.5 py-0.2 text-[10px] text-[var(--aluka-text)]">
                {unstagedList.length}
              </span>
            </div>
            {unstagedList.length > 0 && (
              <div className="hidden items-center gap-0.5 group-hover:flex">
                <button
                  title="放弃所有更改"
                  onClick={(e) => {
                    e.stopPropagation();
                    const tracked = unstagedList
                      .filter((f) => f.status !== "U")
                      .map((f) => f.path);
                    const untracked = unstagedList
                      .filter((f) => f.status === "U")
                      .map((f) => f.path);
                    if (tracked.length > 0) void discard(workspaceRoot, tracked, false);
                    if (untracked.length > 0) void discard(workspaceRoot, untracked, true);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-active)] hover:text-[var(--aluka-text)]"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  title="暂存所有更改"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stage(workspaceRoot, []);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-active)] hover:text-[var(--aluka-text)]"
                >
                  <Plus size={13} />
                </button>
              </div>
            )}
          </div>

          {!changesCollapsed && (
            <div className="py-0.5">
              {unstagedList.length === 0 ? (
                <div className="px-5 py-2 text-[11px] text-[var(--aluka-text-dim)]">
                  没有未暂存的更改
                </div>
              ) : (
                unstagedList.map((file) => {
                  const { fileName, dirPath } = splitPath(file.path);
                  return (
                    <div
                      key={file.path}
                      onClick={() => void handleOpenDiff(file)}
                      className="group flex h-6 cursor-pointer items-center justify-between px-3 text-[12px] hover:bg-[var(--aluka-hover)]"
                    >
                      <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden">
                        <span className="truncate text-[var(--aluka-text)]">{fileName}</span>
                        {dirPath && (
                          <span className="truncate text-[11px] text-[var(--aluka-text-dim)]">
                            {dirPath}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          title="放弃更改"
                          onClick={(e) => {
                            e.stopPropagation();
                            void discard(workspaceRoot, [file.path], file.status === "U");
                          }}
                          className="hidden h-4 w-4 items-center justify-center rounded hover:bg-[var(--aluka-active)] group-hover:flex"
                        >
                          <RotateCcw size={12} />
                        </button>
                        <button
                          title="暂存更改"
                          onClick={(e) => {
                            e.stopPropagation();
                            void stage(workspaceRoot, [file.path]);
                          }}
                          className="hidden h-4 w-4 items-center justify-center rounded hover:bg-[var(--aluka-active)] group-hover:flex"
                        >
                          <Plus size={12} />
                        </button>
                        <StatusBadge status={file.status} staged={false} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
