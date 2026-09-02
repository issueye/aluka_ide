import { AlertTriangle, CircleAlert, Info, X } from "lucide-react";
import { useNotificationStore } from "../notificationStore";

/** 右下角通知 toast（扩展 window.showXxxMessage / 内部错误出口） */
const ICONS = {
  info: <Info size={15} className="text-[#3794ff]" />,
  warning: <AlertTriangle size={15} className="text-[#cca700]" />,
  error: <CircleAlert size={15} className="text-[#f48771]" />,
};

export default function Notifications() {
  const items = useNotificationStore((s) => s.items);
  const dismiss = useNotificationStore((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-10 z-50 flex w-[360px] flex-col gap-2">
      {items.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto flex items-start gap-2 rounded border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] p-2.5 shadow-xl"
        >
          <span className="mt-0.5 shrink-0">{ICONS[n.kind]}</span>
          <span className="min-w-0 flex-1 text-[12px] leading-5 whitespace-pre-wrap text-[var(--aluka-text)]">
            {n.message}
          </span>
          <button
            title="关闭"
            onClick={() => dismiss(n.id)}
            className="shrink-0 rounded p-0.5 text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
