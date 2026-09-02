import { create } from "zustand";

/**
 * 全局通知（M6）：扩展垫片 window.showXxxMessage 与内部错误的统一出口。
 * 右下角 toast 呈现，默认 6s 自动消失。
 */
export interface AlukaNotification {
  id: number;
  kind: "info" | "warning" | "error";
  message: string;
}

interface NotificationStore {
  items: AlukaNotification[];
  show: (kind: AlukaNotification["kind"], message: string, timeoutMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationStore>((set) => ({
  items: [],
  show: (kind, message, timeoutMs = 6000) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { id, kind, message }] }));
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((n) => n.id !== id) }));
    }, timeoutMs);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
}));

export function showInfo(message: string): void {
  useNotificationStore.getState().show("info", message);
}
