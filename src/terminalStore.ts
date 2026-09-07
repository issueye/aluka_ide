import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  createTerminal,
  killTerminal,
  listTerminalShells,
  reapTerminal,
  resizeTerminal,
  writeTerminal,
  type TerminalShell,
} from "./tauri";
import { useSettingsStore } from "./settingsStore";

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
  /** 本机可用 Shell 候选（面板打开时探测一次） */
  shells: TerminalShell[];
  /** 是否已完成一次 Shell 探测（含失败），自动创建终端前以此判定 */
  shellsLoaded: boolean;
  create: (
    root: string,
    name?: string,
    shell?: string,
    cols?: number,
    rows?: number,
  ) => Promise<number | null>;
  loadShells: () => Promise<void>;
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
  shells: [],
  shellsLoaded: false,

  create: async (root, name, shell, cols, rows) => {
    try {
      const id = await createTerminal(root, shell, cols, rows);
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

  loadShells: async () => {
    if (get().shellsLoaded) return;
    set({ shellsLoaded: true });
    try {
      const shells = await listTerminalShells();
      set({ shells });
    } catch (e) {
      console.error("探测可用 Shell 失败:", e);
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

/**
 * 解析默认 Shell：优先取设置中记住的 terminalShell（不可用则回退探测列表第一项）。
 * 首次调用会触发一次 Shell 探测；供命令面板「新建终端」等非组件场景复用。
 */
export async function resolveDefaultShell(): Promise<{ id?: string; name: string }> {
  const t = useTerminalStore.getState();
  if (!t.shellsLoaded) await t.loadShells();
  const saved = useSettingsStore.getState().terminalShell;
  const found = t.shells.find((s) => s.id === saved) ?? t.shells[0];
  return { id: found?.id, name: found?.name ?? "PowerShell" };
}

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

