import { create } from "zustand";
import { findWorkspaceSymbols, type WorkspaceSymbol } from "./tauri";

/**
 * 定义索引缓存（FR-20 / M9，供 navigation.ts 跳转流程使用）：
 * 首次跳转/搜符号时按工作区根构建，`workspace:changed` 时失效重建。
 * 明确边界：文本级定义索引，无 LSP 语义（类型/重载/import 不解析）。
 */

interface SymbolsStore {
  /** 已构建索引的工作区根；null = 未构建 */
  indexedRoot: string | null;
  building: boolean;
  /** 索引已过期（workspace:changed 后置位），下次 ensureIndex 时重建；旧索引保留供查询 */
  stale: boolean;
  /** 符号名（小写键）→ 定义列表 */
  index: Map<string, WorkspaceSymbol[]> | null;

  /** 确保索引就绪（幂等；过期时惰性重建） */
  ensureIndex: (root: string) => Promise<void>;
  /** 工作区文件变更后标记过期（不清空旧索引，避免 dev 构建产物高频变动导致索引反复丢失） */
  invalidate: () => void;
}

function keyOf(name: string): string {
  return name.toLowerCase();
}

export const useSymbolsStore = create<SymbolsStore>((set, get) => ({
  indexedRoot: null,
  building: false,
  stale: false,
  index: null,

  ensureIndex: async (root) => {
    const { indexedRoot, building, index, stale } = get();
    if (building) return;
    if (indexedRoot === root && index && !stale) return;
    set({ building: true });
    try {
      const symbols = await findWorkspaceSymbols(root, "", 4000);
      // 构建期间工作区可能已切换：以当前请求的 root 记账（后续 invalidate 会纠正）
      const map = new Map<string, WorkspaceSymbol[]>();
      for (const s of symbols) {
        const key = keyOf(s.name);
        const list = map.get(key);
        if (list) list.push(s);
        else map.set(key, [s]);
      }
      set({ indexedRoot: root, index: map, stale: false });
    } catch (e) {
      console.error("构建符号索引失败:", e);
    } finally {
      set({ building: false });
    }
  },

  invalidate: () => {
    if (get().index) set({ stale: true });
  },
}));
