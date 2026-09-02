import { useEffect, useState } from "react";
import { Bell, GitBranch } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { useEditorStore } from "../editorStore";
import { useStatusStore } from "../statusStore";
import { getGitBranch } from "../tauri";

/** 状态栏：行列 / EOL / 语言来自编辑器实时事件；git 分支随工作区/文件变更刷新 */
export default function StatusBar() {
  const workspaceName = useAppStore((s) => s.workspaceName);
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const status = useStatusStore();
  const activeTab = tabs.find((t) => t.path === activePath);
  const [branch, setBranch] = useState<string | null>(null);

  // 分支刷新：工作区切换时拉取；文件变更事件（含 .git/HEAD 变化）去抖重拉
  useEffect(() => {
    if (!workspaceRoot) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    const pull = () => {
      void getGitBranch(workspaceRoot)
        .then((b) => {
          if (!cancelled) setBranch(b);
        })
        .catch(() => {
          if (!cancelled) setBranch(null);
        });
    };
    pull();
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void listen("workspace:changed", () => {
      clearTimeout(timer);
      timer = setTimeout(pull, 500);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [workspaceRoot]);

  return (
    <footer className="flex h-6 shrink-0 select-none items-center justify-between bg-[var(--aluka-statusbar-bg)] px-2 text-[12px] text-white">
      <div className="flex items-center gap-1">
        {branch && (
          <button className="flex items-center gap-1 px-1 hover:bg-white/20">
            <GitBranch size={12} />
            {branch}
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
  );
}
