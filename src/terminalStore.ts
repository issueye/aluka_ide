import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { createTerminal, killTerminal, reapTerminal, writeTerminal } from "./tauri";

/**
 * 终端会话状态（M5 / FR-06）。
 * 输出以纯文本流累积（管道模式无屏幕控制序列）；输入行本地回显。
 * 事件订阅通过 setupTerminalListeners() 在 App 级安装一次。
 */
export interface TerminalSession {
  id: number;
  name: string;
  /** 累积输出（含提示符/回显）；超长截头防内存膨胀 */
  buffer: string;
  /** 进程是否已退出（closed 事件后置位，UI 显示"会话已结束"） */
  closed: boolean;
}

const BUFFER_MAX_CHARS = 200_000;

interface TerminalStore {
  sessions: TerminalSession[];
  activeId: number | null;
  /** 会话输出版本号：Panel 依赖它触发滚动（buffer 是同一字符串引用的替换） */
  create: (root: string, name: string) => Promise<void>;
  writeLine: (id: number, line: string) => Promise<void>;
  kill: (id: number) => Promise<void>;
  setActive: (id: number) => void;
  removeLocal: (id: number) => void;
}

/** 追加输出并截头（保留尾部） */
function appendBuffer(prev: string, data: string): string {
  const next = prev + data;
  return next.length > BUFFER_MAX_CHARS ? next.slice(-BUFFER_MAX_CHARS) : next;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeId: null,

  create: async (root, name) => {
    try {
      const id = await createTerminal(root);
      set((s) => ({
        sessions: [...s.sessions, { id, name, buffer: "", closed: false }],
        activeId: id,
      }));
    } catch (e) {
      console.error("创建终端失败:", e);
    }
  },

  writeLine: async (id, line) => {
    // 本地立即回显输入行（管道模式下 cmd 不回显 stdin）
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id ? { ...t, buffer: appendBuffer(t.buffer, `${line}\r\n`) } : t,
      ),
    }));
    try {
      await writeTerminal(id, `${line}\r\n`);
    } catch (e) {
      set((s) => ({
        sessions: s.sessions.map((t) =>
          t.id === id ? { ...t, buffer: appendBuffer(t.buffer, `写入失败: ${String(e)}\r\n`) } : t,
        ),
      }));
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
        useTerminalStore.setState((s) => ({
          sessions: s.sessions.map((t) =>
            t.id === id && !t.closed ? { ...t, buffer: appendBuffer(t.buffer, data) } : t,
          ),
        }));
      });
      unlistenClosed = await listen<{ id: number }>("terminal:closed", (e) => {
        const { id } = e.payload;
        useTerminalStore.setState((s) => ({
          sessions: s.sessions.map((t) => (t.id === id ? { ...t, closed: true } : t)),
        }));
        // 后端清理残留表项（读线程 EOF 后会话已死）
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
