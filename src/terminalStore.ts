import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  createTerminal,
  killTerminal,
  reapTerminal,
  resizeTerminal,
  writeTerminal,
} from "./tauri";

/**
 * 终端会话状态（ConPTY 升级）：
 * 状态仅管理会话元信息（ID、名称、存活状态），
 * 字符输出直接经由订阅总线写入对应 xterm 实例，避免 React 多层重渲染与大字符串复制开销。
 */
export interface TerminalSession {
  id: number;
  name: string;
  closed: boolean;
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeId: number | null;
  create: (root: string, name?: string, cols?: number, rows?: number) => Promise<number | null>;
  write: (id: number, data: string) => Promise<void>;
  resize: (id: number, cols: number, rows: number) => Promise<void>;
  kill: (id: number) => Promise<void>;
  setActive: (id: number) => void;
  removeLocal: (id: number) => void;
}

/** 终端原始数据输出订阅总线 */
const outputListeners = new Map<number, Set<(data: string) => void>>();

/** 终端视图清空钩子：TerminalView 挂载时登记 xterm.clear，菜单「清空终端」经此触达视图层 */
const clearHooks = new Map<number, () => void>();

export function registerTerminalClearHook(id: number, hook: () => void): () => void {
  clearHooks.set(id, hook);
  return () => {
    if (clearHooks.get(id) === hook) clearHooks.delete(id);
  };
}

/** 清空指定会话的终端视图（保留当前提示符行） */
export function clearTerminalView(id: number): void {
  clearHooks.get(id)?.();
}

export function subscribeTerminalOutput(
  id: number,
  callback: (data: string) => void,
): () => void {
  let listeners = outputListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    outputListeners.set(id, listeners);
  }
  listeners.add(callback);
  return () => {
    const list = outputListeners.get(id);
    list?.delete(callback);
    if (list?.size === 0) {
      outputListeners.delete(id);
    }
  };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeId: null,

  create: async (root, name, cols, rows) => {
    try {
      const id = await createTerminal(root, cols, rows);
      const sessionName = name ?? `终端 ${id}`;
      set((s) => ({
        sessions: [...s.sessions, { id, name: sessionName, closed: false }],
        activeId: id,
      }));
      return id;
    } catch (e) {
      console.error("创建终端失败:", e);
      return null;
    }
  },

  write: async (id, data) => {
    try {
      await writeTerminal(id, data);
    } catch (e) {
      console.error("写入终端失败:", e);
    }
  },

  resize: async (id, cols, rows) => {
    try {
      await resizeTerminal(id, cols, rows);
    } catch {
      /* 忽略调整中可能发生的瞬时异常 */
    }
  },

  kill: async (id) => {
    try {
      await killTerminal(id);
    } finally {
      get().removeLocal(id);
    }
  },

  setActive: (id) => set({ activeId: id }),

  removeLocal: (id) => {
    outputListeners.delete(id);
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id);
      return {
        sessions,
        activeId: s.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeId,
      };
    });
  },
}));

/** terminal:output / terminal:closed 事件订阅（App 挂载时安装一次） */
export function setupTerminalListeners(): () => void {
  let unlistenOutput: (() => void) | undefined;
  let unlistenClosed: (() => void) | undefined;
  const unsubs: Array<() => void> = [];
  void (async () => {
    try {
      unlistenOutput = await listen<{ id: number; data: string }>("terminal:output", (e) => {
        const { id, data } = e.payload;
        const listeners = outputListeners.get(id);
        if (listeners) {
          for (const cb of listeners) cb(data);
        }
      });
      unlistenClosed = await listen<{ id: number }>("terminal:closed", (e) => {
        const { id } = e.payload;
        useTerminalStore.setState((s) => ({
          sessions: s.sessions.map((t) => (t.id === id ? { ...t, closed: true } : t)),
        }));
        // 后端清理残留表项
        void reapTerminal(id).catch(() => {});
      });
      if (unlistenOutput) unsubs.push(unlistenOutput);
      if (unlistenClosed) unsubs.push(unlistenClosed);
    } catch {
      /* 纯浏览器 dev 无 Tauri IPC */
    }
  })();
  return () => {
    for (const fn of unsubs) fn();
  };
}

