import { create } from "zustand";

/**
 * 代码导航状态（FR-20 / M9 增强，参考 VS Code 导航设计）：
 * 1) 跳转历史栈 —— 每次导航型跳转（定义/引用/符号/搜索结果/转到行）前记录当前位置，
 *    Alt+←/→ 在历史间后退/前进；
 * 2) Peek 浮层状态 —— 多定义/引用在来源编辑器内锚定光标行弹出（VS Code Peek 语义），
 *    由对应编辑器组的 CodeEditor 渲染，跳转目标行用 anchorLine 定位浮层。
 */

/** 跳转历史中的单个位置 */
export interface NavLocation {
  path: string;
  line: number;
  col: number;
}

/** Peek 候选条目（定义/引用共用） */
export interface JumpItem {
  path: string;
  line: number;
  col: number;
  /** 列表主文本（符号名/行内容摘要） */
  label: string;
  /** 辅助说明（符号类型 · 相对路径:行号） */
  detail?: string;
}

/** Peek 浮层内容（绑定到接收它的编辑器组） */
export interface PeekState {
  groupId: string;
  title: string;
  items: JumpItem[];
  /** 锚定行（浮层出现在该行下方，随编辑器滚动跟随） */
  anchorLine: number;
}

interface NavigationStore {
  /** 历史栈；index 指向当前位置（-1 = 空） */
  stack: NavLocation[];
  index: number;
  /** 打开中的 Peek 浮层（null = 关闭） */
  peek: PeekState | null;

  /** 跳转前调用：把当前位置压入历史并截断前进分支 */
  pushCurrent: (loc: NavLocation) => void;
  /** 后退一步并返回目标位置；无可后退返回 null（index 已同步前移） */
  back: () => NavLocation | null;
  /** 前进一步并返回目标位置；无可前进返回 null（index 已同步后移） */
  forward: () => NavLocation | null;
  /** 打开/刷新 Peek 浮层（同一组重复打开为替换内容） */
  openPeek: (peek: PeekState) => void;
  closePeek: () => void;
}

const MAX_HISTORY = 100;

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  stack: [],
  index: -1,
  peek: null,

  pushCurrent: (loc) => {
    const { stack, index } = get();
    const cur = stack[index];
    // 与当前位置完全相同则不重复入栈
    if (cur && cur.path === loc.path && cur.line === loc.line && cur.col === loc.col) return;
    const next = [...stack.slice(0, index + 1), loc].slice(-MAX_HISTORY);
    set({ stack: next, index: next.length - 1 });
  },

  back: () => {
    const { stack, index } = get();
    if (index <= 0) return null;
    set({ index: index - 1 });
    return stack[index - 1] ?? null;
  },

  forward: () => {
    const { stack, index } = get();
    if (index >= stack.length - 1) return null;
    set({ index: index + 1 });
    return stack[index + 1] ?? null;
  },

  openPeek: (peek) => set({ peek }),
  closePeek: () => set({ peek: null }),
}));
