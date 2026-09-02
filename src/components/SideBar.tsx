import Explorer from "./Explorer";
import SearchView from "./SearchView";
import SourceControlView from "./SourceControlView";
import ExtensionsView from "./ExtensionsView";
import { useAppStore } from "../store";
import type { SidebarView } from "../store";

const TITLES: Record<SidebarView, string> = {
  explorer: "资源管理器",
  search: "搜索",
  scm: "源代码管理",
  extensions: "扩展",
};

export default function SideBar() {
  const activeView = useAppStore((s) => s.activeView);

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden bg-[var(--aluka-sidebar-bg)]">
      <div className="flex h-9 shrink-0 select-none items-center px-5 text-[11px] uppercase tracking-wider text-[var(--aluka-text-dim)]">
        {TITLES[activeView]}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeView === "explorer" && <Explorer />}
        {activeView === "search" && <SearchView />}
        {activeView === "scm" && <SourceControlView />}
        {activeView === "extensions" && <ExtensionsView />}
      </div>
    </aside>
  );
}
