import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useAppStore } from "../store";
import { subscribeTerminalOutput, useTerminalStore } from "../terminalStore";
import { useSettingsStore } from "../settingsStore";

/**
 * 底部面板（ConPTY 升级）：xterm.js 全功能交互终端 + 多标签 + ANSI 彩色渲染。
 */

interface TerminalViewProps {
  id: number;
  visible: boolean;
}

/** 单个 xterm 终端实例视图 */
function TerminalView({ id, visible }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const write = useTerminalStore((s) => s.write);
  const resize = useTerminalStore((s) => s.resize);
  const theme = useSettingsStore((s) => s.theme);

  // 初始化 xterm 实例
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isLight = theme === "light-plus";
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Consolas, 'Cascadia Code', 'Courier New', monospace",
      theme: isLight
        ? {
            background: "#ffffff",
            foreground: "#333333",
            cursor: "#333333",
            selectionBackground: "#add6ff",
            black: "#000000",
            red: "#cd3131",
            green: "#00bc00",
            yellow: "#949800",
            blue: "#0451a5",
            magenta: "#bc05bc",
            cyan: "#0598bc",
            white: "#555555",
            brightBlack: "#666666",
            brightRed: "#cd3131",
            brightGreen: "#14ce14",
            brightYellow: "#b5ba00",
            brightBlue: "#0451a5",
            brightMagenta: "#bc05bc",
            brightCyan: "#0598bc",
            brightWhite: "#a5a5a5",
          }
        : {
            background: "#1e1e1e",
            foreground: "#cccccc",
            cursor: "#ffffff",
            selectionBackground: "#264f78",
            black: "#000000",
            red: "#cd3131",
            green: "#0dbc79",
            yellow: "#e5e510",
            blue: "#2472c8",
            magenta: "#bc3fbc",
            cyan: "#11a8cd",
            white: "#e5e5e5",
            brightBlack: "#666666",
            brightRed: "#f14c4c",
            brightGreen: "#23d18b",
            brightYellow: "#f5f543",
            brightBlue: "#3b8eea",
            brightMagenta: "#d670d6",
            brightCyan: "#29b8db",
            brightWhite: "#ffffff",
          },
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // 初次自适应尺寸并同步后端 PTY
    try {
      fitAddon.fit();
      void resize(id, term.cols, term.rows);
    } catch {
      /* 忽略首次尚未计算完成的异常 */
    }

    // 键盘输入直接送至后端 PTY
    const onDataDisposable = term.onData((data) => {
      void write(id, data);
    });

    // 订阅后端输出流
    const unsubOutput = subscribeTerminalOutput(id, (data) => {
      term.write(data);
    });

    // 监听容器大小动态调整
    const resizeObserver = new ResizeObserver(() => {
      if (!visible || !containerRef.current) return;
      try {
        fitAddon.fit();
        void resize(id, term.cols, term.rows);
      } catch {
        /* 忽略容器隐藏时的尺寸异常 */
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      unsubOutput();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id]);

  // 当标签切换为可见时，自适应尺寸并聚焦
  useEffect(() => {
    if (visible && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminalRef.current) {
            void resize(id, terminalRef.current.cols, terminalRef.current.rows);
            terminalRef.current.focus();
          }
        } catch {
          /* 忽略 */
        }
      }, 30);
    }
  }, [visible, id, resize]);

  // 主题切换联动
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    const isLight = theme === "light-plus";
    term.options.theme = isLight
      ? {
          background: "#ffffff",
          foreground: "#333333",
          cursor: "#333333",
          selectionBackground: "#add6ff",
        }
      : {
          background: "#1e1e1e",
          foreground: "#cccccc",
          cursor: "#ffffff",
          selectionBackground: "#264f78",
        };
  }, [theme]);

  return (
    <div
      style={{ display: visible ? "flex" : "none" }}
      className="relative min-h-0 min-w-0 flex-1 flex-col bg-[var(--aluka-bg)] p-1.5"
    >
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}

export default function Panel() {
  const panelOpen = useAppStore((s) => s.panelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const setActive = useTerminalStore((s) => s.setActive);
  const kill = useTerminalStore((s) => s.kill);
  const create = useTerminalStore((s) => s.create);

  // 终端仅在面板打开期间挂载；首次打开自动建一个会话
  useEffect(() => {
    if (panelOpen && sessions.length === 0 && workspaceRoot) {
      void create(workspaceRoot, "PowerShell 1");
    }
  }, [panelOpen, sessions.length, workspaceRoot, create]);

  if (!panelOpen) return null;

  return (
    <section className="flex h-64 shrink-0 flex-col border-t border-[var(--aluka-border)] bg-[var(--aluka-panel-bg)]">
      <div className="flex h-9 shrink-0 select-none items-center border-b border-[var(--aluka-border)] px-2">
        {sessions.map((t) => (
          <div
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`group flex h-full cursor-pointer items-center gap-1.5 border-r border-[var(--aluka-border)] px-3 text-[12px] ${
              activeId === t.id
                ? "bg-[var(--aluka-bg)] text-[var(--aluka-text-active)]"
                : "text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
            }`}
          >
            <span>{t.name}</span>
            {t.closed && <span className="text-[10px] text-[var(--aluka-text-dim)]">（已结束）</span>}
            <button
              title="结束会话"
              onClick={(e) => {
                e.stopPropagation();
                void kill(t.id);
              }}
              className="ml-1 hidden h-4 w-4 items-center justify-center rounded hover:bg-[var(--aluka-hover)] group-hover:flex"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          title="新建终端"
          onClick={() => {
            if (workspaceRoot) {
              void create(workspaceRoot, `PowerShell ${sessions.length + 1}`);
            }
          }}
          className="ml-1 flex h-5 w-5 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
        >
          <Plus size={14} />
        </button>
        <button
          title="关闭面板 (Ctrl+~)"
          onClick={togglePanel}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)]"
        >
          <X size={14} />
        </button>
      </div>

      {sessions.length > 0 ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {sessions.map((t) => (
            <TerminalView key={t.id} id={t.id} visible={activeId === t.id} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--aluka-text-dim)]">
          {workspaceRoot ? "点击 + 新建终端会话" : "打开工作区后可使用终端"}
        </div>
      )}
    </section>
  );
}

