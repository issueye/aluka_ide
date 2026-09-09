import { create } from "zustand";
import { watchWorkspace } from "./tauri";
import { useTreeStore } from "./treeStore";
import { clearEditorSession } from "./editorStore";

export type SidebarView = "explorer" | "search" | "scm" | "extensions";
/** 浮层面板类型：命令 / 快速打开文件 / 转到行 / 工作区符号 / 语言管理 */
export type PaletteKind = "commands" | "files" | "goto" | "symbols" | "languages";

/** 菜单 → 资源管理器的新建请求（seq 变化驱动 Explorer 弹出内联输入框） */
export interface ExplorerRequest {
  kind: "newFile" | "newFolder";
  seq: number;
}

/** 最近工作区持久化（会话恢复：刷新/重载后自动重开） */
const WORKSPACE_KEY = "aluka.lastWorkspace";

export function getLastWorkspaceRoot(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function persistWorkspaceRoot(root: string | null): void {
  try {
    if (root) localStorage.setItem(WORKSPACE_KEY, root);
    else localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
}

/**
 * 工作台面板尺寸（拖拽调整）：侧栏宽度 / 控制台面板高度。
 * 与最近工作区一样存 localStorage —— 属于「窗口状态」，不进 settings.json。
 */
const LAYOUT_KEY = "aluka.layout";

export const SIDEBAR_MIN = 170;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 240;
export const PANEL_MIN = 96;
export const PANEL_MAX = 900;
export const PANEL_DEFAULT = 256;

/** 把任意输入收敛到 [min, max]（max 小于 min 时退化为 min，避免反向区间） */
export function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}

interface SavedLayout {
  sidebarWidth?: number;
  panelHeight?: number;
}

function loadLayout(): SavedLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    // 注意 null 也是合法 JSON：`p.sidebarWidth` 会在模块初始化期抛错导致整白屏，必须显式挡掉
    const p: unknown = JSON.parse(raw);
    return p && typeof p === "object" ? (p as SavedLayout) : {};
  } catch {
    return {};
  }
}

/** 拖拽过程中 mousemove 频率很高，落盘做 200ms 防抖，避免同步 IO 拖慢拖动 */
let layoutTimer: number | undefined;
let pendingLayout: SavedLayout | null = null;

function writeLayout(): void {
  const pending = pendingLayout;
  if (!pending) return;
  pendingLayout = null;
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(pending));
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
}

function persistLayout(layout: SavedLayout): void {
  pendingLayout = layout;
  if (layoutTimer !== undefined) window.clearTimeout(layoutTimer);
  // 关窗/重载前把防抖期内未落盘的最后一次尺寸补上，否则重启回到旧尺寸
  layoutTimer = window.setTimeout(writeLayout, 200);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", writeLayout);
}

const savedLayout = loadLayout();
const initialSidebarWidth = clampSize(
  savedLayout.sidebarWidth ?? SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
);
const initialPanelHeight = clampSize(savedLayout.panelHeight ?? PANEL_DEFAULT, PANEL_MIN, PANEL_MAX);

/** 侧栏可调上限：不超过绝对上限，且右侧给编辑器留 400px */
export function sidebarMax(): number {
  return Math.min(SIDEBAR_MAX, window.innerWidth - 400);
}

/** 面板可调上限：不超过窗口高度，且顶部给编辑器留 260px（标题栏/标签栏/状态栏 + 可用编辑区） */
export function panelMax(): number {
  return Math.max(PANEL_MIN, window.innerHeight - 260);
}

/**
 * 把当前尺寸重新收敛到视口允许的范围。
 * 窗口缩小 / 换显示器 / 取消最大化后，之前持久化的大尺寸若不再放得下，
 * 会把编辑器区挤没甚至顶出窗口（面板是 shrink-0），故 resize 时须回调。
 */
export function clampLayoutToViewport(): void {
  const s = useAppStore.getState();
  const maxW = sidebarMax();
  const maxH = panelMax();
  if (s.sidebarWidth > maxW) s.setSidebarWidth(maxW);
  if (s.panelHeight > maxH) s.setPanelHeight(maxH);
}

interface AppStore {
  /** 工作区根路径（null = 未打开） */
  workspaceRoot: string | null;
  workspaceName: string;
  activeView: SidebarView;
  sidebarVisible: boolean;
  panelOpen: boolean;
  /** 侧栏宽度（px，拖拽调整并持久化） */
  sidebarWidth: number;
  /** 底部控制台面板高度（px，拖拽调整并持久化） */
  panelHeight: number;
  /** 打开的浮层面板：命令面板 / 快速打开文件 / 转到行（null = 关闭） */
  palette: PaletteKind | null;
  /** 菜单栏发起的新建文件/文件夹请求（Explorer 消费） */
  explorerRequest: ExplorerRequest | null;
  openWorkspace: (root: string) => void;
  closeWorkspace: () => void;
  /** 活动栏点击：切换视图；重复点击当前视图时隐藏侧栏（VS Code 行为） */
  selectView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  /** 设置侧栏宽度（px，越界自动收敛并持久化） */
  setSidebarWidth: (px: number) => void;
  /** 设置底部面板高度（px，越界自动收敛并持久化） */
  setPanelHeight: (px: number) => void;
  resetSidebarWidth: () => void;
  resetPanelHeight: () => void;
  setPalette: (palette: PaletteKind | null) => void;
  /** 快捷键：同一面板再次按下则收起，否则切换为指定面板 */
  togglePalette: (kind: "commands" | "files") => void;
  /** 菜单「文件」发起新建：工作区打开时由资源管理器弹出内联输入框 */
  requestExplorer: (kind: "newFile" | "newFolder") => void;
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
  sidebarWidth: initialSidebarWidth,
  panelHeight: initialPanelHeight,
  palette: null,
  explorerRequest: null,
  openWorkspace: (root) => {
    set({ workspaceRoot: root, workspaceName: baseName(root), sidebarVisible: true });
    persistWorkspaceRoot(root);
    // 重置目录树并启动文件监听（异步，不阻塞 UI）
    void useTreeStore.getState().resetTree(root);
    void watchWorkspace(root).catch((e) => console.error("启动文件监听失败:", e));
  },
  closeWorkspace: () => {
    set({ workspaceRoot: null, workspaceName: "" });
    persistWorkspaceRoot(null);
    clearEditorSession();
    void useTreeStore.getState().resetTree(null);
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
  // 上限一律走 sidebarMax()/panelMax()：绝对上限之外还要受当前视口约束，
  // 这样双击重置与任何程序化调用都不可能写出「放不下」的尺寸
  setSidebarWidth: (px) => {
    const width = clampSize(px, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, sidebarMax()));
    const { panelHeight } = get();
    set({ sidebarWidth: width });
    persistLayout({ sidebarWidth: width, panelHeight });
  },
  setPanelHeight: (px) => {
    const height = clampSize(px, PANEL_MIN, Math.min(PANEL_MAX, panelMax()));
    const { sidebarWidth } = get();
    set({ panelHeight: height });
    persistLayout({ sidebarWidth, panelHeight: height });
  },
  resetSidebarWidth: () => get().setSidebarWidth(SIDEBAR_DEFAULT),
  resetPanelHeight: () => get().setPanelHeight(PANEL_DEFAULT),
  setPalette: (palette) => set({ palette }),
  togglePalette: (kind) => set((s) => ({ palette: s.palette === kind ? null : kind })),
  requestExplorer: (kind) =>
    set((s) => ({ explorerRequest: { kind, seq: (s.explorerRequest?.seq ?? 0) + 1 } })),
}));
