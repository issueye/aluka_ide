import { create } from "zustand";
import { findWorkspaceSymbols, type WorkspaceSymbol } from "./tauri";

/**
 * 代码跳转状态（FR-20 / M9）：
 * 1) 定义索引缓存 —— 首次跳转/搜符号时按工作区根构建，`workspace:changed` 时失效重建；
 * 2) jump 候选列表 —— 转到定义/查找引用命中多条时借命令面板（jump 模式）呈现。
 * 明确边界：文本级定义索引，无 LSP 语义（类型/重载/import 不解析）。
 */

export interface JumpItem {
  path: string;
  line: number;
  col: number;
  /** 列表主文本（如符号名/行内容摘要） */
  label: string;
  /** 辅助说明（如 相对路径:行号） */
  detail?: string;
}

interface SymbolsStore {
  /** 已构建索引的工作区根；null = 未构建 */
  indexedRoot: string | null;
  building: boolean;
  /** 索引已过期（workspace:changed 后置位），下次 ensureIndex 时重建；旧索引保留供查询 */
  stale: boolean;
  /** 符号名（小写键）→ 定义列表 */
  index: Map<string, WorkspaceSymbol[]> | null;
  /** 命令面板 jump 模式：静态候选列表（null = 关闭） */
  jump: { title: string; items: JumpItem[] } | null;

  /** 确保索引就绪（幂等；过期时惰性重建） */
  ensureIndex: (root: string) => Promise<void>;
  /** 工作区文件变更后标记过期（不清空旧索引，避免 dev 构建产物高频变动导致索引反复丢失） */
  invalidate: () => void;
  openJumpList: (title: string, items: JumpItem[]) => void;
  closeJumpList: () => void;
}

function keyOf(name: string): string {
  return name.toLowerCase();
}

export const useSymbolsStore = create<SymbolsStore>((set, get) => ({
  indexedRoot: null,
  building: false,
  stale: false,
  index: null,
  jump: null,

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

  openJumpList: (title, items) => set({ jump: { title, items } }),
  closeJumpList: () => set({ jump: null }),
}));

/** 由相对路径构造 "目录/文件:行" 形式的辅助说明 */
export function relativeDetail(path: string, root: string, line: number): string {
  const rel = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, "") : path;
  return `${rel}:${line}`;
}
