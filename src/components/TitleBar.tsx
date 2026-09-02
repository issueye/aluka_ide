import { useEffect, useState } from "react";
import { CodeXml, Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store";

/** 非 Tauri 环境（纯浏览器 dev）下降级为 no-op，避免抛错 */
function tryWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** 跟踪最大化状态（还原/最大化按钮图标切换） */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const w = tryWindow();
    if (!w) return;
    let unlisten: (() => void) | undefined;
    void w.isMaximized().then(setMaximized).catch(() => {});
    void w.onResized(() => {
      void w
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);
  return maximized;
}

const MENUS = ["文件", "编辑", "选择", "查看", "转到", "运行", "终端", "帮助"];

function ControlButton({
  onClick,
  danger,
  children,
  title,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-full w-[46px] items-center justify-center text-[var(--aluka-text)] ${
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-[var(--aluka-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const maximized = useMaximized();
  const workspaceName = useAppStore((s) => s.workspaceName);

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center bg-[var(--aluka-titlebar-bg)] pl-3"
    >
      <CodeXml size={17} className="shrink-0 text-[#0098ff]" />
      <span data-tauri-drag-region className="ml-2 shrink-0 text-[13px] font-medium">
        Aluka IDE
      </span>
      {/* 菜单占位：M4 命令系统就绪后接入真实菜单 */}
      <nav className="ml-4 flex items-center gap-0.5">
        {MENUS.map((m) => (
          <button
            key={m}
            className="rounded px-2 py-0.5 text-[13px] text-[var(--aluka-text)] hover:bg-[var(--aluka-hover)]"
          >
            {m}
          </button>
        ))}
      </nav>
      <div
        data-tauri-drag-region
        className="min-w-0 flex-1 truncate text-center text-[13px] text-[var(--aluka-text-dim)]"
      >
        {workspaceName ? `${workspaceName} — Aluka IDE` : "Aluka IDE"}
      </div>
      <div className="flex h-full shrink-0 items-stretch">
        <ControlButton title="最小化" onClick={() => void tryWindow()?.minimize()}>
          <Minus size={16} />
        </ControlButton>
        <ControlButton
          title={maximized ? "还原" : "最大化"}
          onClick={() => void tryWindow()?.toggleMaximize()}
        >
          {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={12} />}
        </ControlButton>
        <ControlButton title="关闭" danger onClick={() => void tryWindow()?.close()}>
          <X size={16} />
        </ControlButton>
      </div>
    </header>
  );
}
