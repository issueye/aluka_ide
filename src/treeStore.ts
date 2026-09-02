import { create } from "zustand";
import { readDir } from "./tauri";
import type { FileNode } from "./types";

/**
 * 资源管理器目录树状态：提升到全局 store，
 * 使侧栏隐藏/恢复（组件卸载重挂）后展开与选中状态得以保留。
 */
interface TreeStore {
  /** 已加载的目录子项缓存：目录路径 → 子项列表 */
  tree: Map<string, FileNode[]>;
  /** 已展开目录集合 */
  expanded: Set<string>;
  selected: string | null;
  loadDir: (path: string) => Promise<void>;
  expandDir: (path: string) => Promise<void>;
  toggleDir: (node: FileNode) => void;
  setSelected: (path: string | null) => void;
  /** 工作区切换时清空并加载新根目录 */
  resetTree: (root: string | null) => Promise<void>;
  /** 刷新所有已展开目录（外部/内部文件变更后调用） */
  refreshExpanded: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useTreeStore = create<TreeStore>((set, get) => ({
  tree: new Map(),
  expanded: new Set(),
  selected: null,
  loadDir: async (path) => {
    try {
      const list = await readDir(path);
      set((s) => {
        const tree = new Map(s.tree);
        tree.set(path, list);
        return { tree };
      });
    } catch {
      // 目录已被删除/不可读：从缓存与展开集合中移除
      set((s) => {
        const tree = new Map(s.tree);
        tree.delete(path);
        const expanded = new Set(s.expanded);
        expanded.delete(path);
        return { tree, expanded };
      });
    }
  },
  expandDir: async (path) => {
    set((s) => ({ expanded: new Set(s.expanded).add(path) }));
    if (!get().tree.has(path)) await get().loadDir(path);
  },
  toggleDir: (node) => {
    if (!node.isDir) {
      set({ selected: node.path });
      return;
    }
    const { expanded, tree, loadDir } = get();
    if (expanded.has(node.path)) {
      const next = new Set(expanded);
      next.delete(node.path);
      set({ selected: node.path, expanded: next });
    } else {
      set({ selected: node.path, expanded: new Set(expanded).add(node.path) });
      if (!tree.has(node.path)) void loadDir(node.path);
    }
  },
  setSelected: (path) => set({ selected: path }),
  resetTree: async (root) => {
    set({ tree: new Map(), expanded: new Set(), selected: null });
    if (root) await get().expandDir(root);
  },
  refreshExpanded: async () => {
    const { expanded, loadDir } = get();
    await Promise.all([...expanded].map((p) => loadDir(p)));
  },
}));

/** 防抖刷新：workspace:changed 高频事件聚合为一次刷新 */
export function scheduleTreeRefresh(delay = 400): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useTreeStore.getState().refreshExpanded();
  }, delay);
}
