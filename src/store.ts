import { create } from "zustand";
import { watchWorkspace } from "./tauri";
import { useTreeStore } from "./treeStore";

export type SidebarView = "explorer" | "search" | "extensions";

interface AppStore {
  /** 工作区根路径（null = 未打开） */
  workspaceRoot: string | null;
  workspaceName: string;
  activeView: SidebarView;
  sidebarVisible: boolean;
  panelOpen: boolean;
  /** 打开的浮层面板：命令面板 / 快速打开文件（null = 关闭） */
  palette: "commands" | "files" | null;
  openWorkspace: (root: string) => void;
  /** 活动栏点击：切换视图；重复点击当前视图时隐藏侧栏（VS Code 行为） */
  selectView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setPalette: (palette: "commands" | "files" | null) => void;
  /** 快捷键：同一面板再次按下则收起，否则切换为指定面板 */
  togglePalette: (kind: "commands" | "files") => void;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export const useAppStore = create<AppStore>((set, get) => ({
  workspaceRoot: null,
  workspaceName: "",
  activeView: "explorer",
  sidebarVisible: true,
  panelOpen: false,
  palette: null,
  openWorkspace: (root) => {
    set({ workspaceRoot: root, workspaceName: baseName(root), sidebarVisible: true });
    // 重置目录树并启动文件监听（异步，不阻塞 UI）
    void useTreeStore.getState().resetTree(root);
    void watchWorkspace(root).catch((e) => console.error("启动文件监听失败:", e));
  },
  selectView: (view) => {
    const { activeView, sidebarVisible } = get();
    if (activeView === view && sidebarVisible) {
      set({ sidebarVisible: false });
    } else {
      set({ activeView: view, sidebarVisible: true });
    }
  },
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPalette: (palette) => set({ palette }),
  togglePalette: (kind) => set((s) => ({ palette: s.palette === kind ? null : kind })),
}));
