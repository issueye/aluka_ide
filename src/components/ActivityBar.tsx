import { Blocks, Files, GitFork, History, Search, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "../store";
import { useGitStore } from "../gitStore";
import type { SidebarView } from "../store";

const TOP_ITEMS: { view: SidebarView; icon: LucideIcon; title: string }[] = [
  { view: "explorer", icon: Files, title: "资源管理器 (Ctrl+Shift+E)" },
  { view: "search", icon: Search, title: "搜索 (Ctrl+Shift+F)" },
  { view: "scm", icon: GitFork, title: "源代码管理 (Ctrl+Shift+G)" },
  { view: "history", icon: History, title: "提交记录 (Git 历史)" },
  { view: "extensions", icon: Blocks, title: "扩展 (Ctrl+Shift+X)" },
];

export default function ActivityBar() {
  const activeView = useAppStore((s) => s.activeView);
  const selectView = useAppStore((s) => s.selectView);
  const gitStatus = useGitStore((s) => s.status);
  const changeCount = (gitStatus?.staged.length ?? 0) + (gitStatus?.unstaged.length ?? 0);

  return (
    <aside className="flex w-12 shrink-0 flex-col items-center bg-[var(--aluka-activity-bg)]">
      {TOP_ITEMS.map(({ view, icon: Icon, title }) => {
        const active = activeView === view;
        return (
          <button
            key={view}
            title={title}
            onClick={() => selectView(view)}
            className={`relative flex h-12 w-12 items-center justify-center ${
              active
                ? "text-[var(--aluka-activity-active)]"
                : "text-[var(--aluka-activity-fg)] hover:text-[var(--aluka-activity-active)]"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-0 h-full w-[2px] bg-[var(--aluka-activity-active)]" />
            )}
            <Icon size={24} strokeWidth={1.5} />
            {view === "scm" && changeCount > 0 && (
              <span className="absolute right-2 top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#007acc] px-1 text-[10px] font-bold text-white shadow">
                {changeCount > 99 ? "99+" : changeCount}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto flex flex-col pb-1">
        <button
          title="管理（未实现）"
          className="flex h-12 w-12 items-center justify-center text-[var(--aluka-activity-fg)] hover:text-[var(--aluka-activity-active)]"
        >
          <Settings size={22} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  );
}
