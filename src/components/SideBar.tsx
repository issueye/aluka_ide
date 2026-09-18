import { useRef } from "react";
import { X } from "lucide-react";
import Explorer from "./Explorer";
import SearchView from "./SearchView";
import SourceControlView from "./SourceControlView";
import GitHistoryView from "./GitHistoryView";
import ExtensionsView from "./ExtensionsView";
import TerminalDebugView from "./TerminalDebugView";
import ResizeHandle from "./ResizeHandle";
import { SIDEBAR_MIN, sidebarMax, useAppStore } from "../store";
import type { SidebarView } from "../store";

const TITLES: Record<SidebarView, string> = {
  explorer: "资源管理器",
  search: "搜索",
  scm: "源代码管理",
  extensions: "扩展",
  history: "提交记录",
  terminalDebug: "终端 IO 调试",
};

export default function SideBar() {
  const activeView = useAppStore((s) => s.activeView);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = useAppStore((s) => s.resetSidebarWidth);
  const closeTerminalDebug = useAppStore((s) => s.closeTerminalDebug);
  const asideRef = useRef<HTMLElement>(null);

  return (
    <>
      <aside
        ref={asideRef}
        style={{ width: sidebarWidth }}
        className="flex shrink-0 flex-col overflow-hidden bg-[var(--aluka-sidebar-bg)]"
      >
        <div className="flex h-9 shrink-0 select-none items-center justify-between px-5 text-[11px] uppercase tracking-wider text-[var(--aluka-text-dim)]">
          <span>{TITLES[activeView]}</span>
          {/* 终端 IO 调试是「用后即弃」的临时功能：标题栏右上角 × 彻底关闭（停录 + 隐藏入口） */}
          {activeView === "terminalDebug" && (
            <button
              title="关闭终端 IO 调试"
              onClick={closeTerminalDebug}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeView === "explorer" && <Explorer />}
          {activeView === "search" && <SearchView />}
          {activeView === "scm" && <SourceControlView />}
          {activeView === "history" && <GitHistoryView />}
          {activeView === "extensions" && <ExtensionsView />}
          {activeView === "terminalDebug" && <TerminalDebugView />}
        </div>
      </aside>
      <ResizeHandle
        targetRef={asideRef}
        side="right"
        min={SIDEBAR_MIN}
        max={sidebarMax}
        value={sidebarWidth}
        onSize={setSidebarWidth}
        onReset={resetSidebarWidth}
        title="拖拽调整侧栏宽度（双击重置）"
      />
    </>
  );
}
