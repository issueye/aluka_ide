import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useAppStore } from "../store";
import {
  registerTerminalClearHook,
  subscribeTerminalOutput,
  useTerminalStore,
} from "../terminalStore";
import { useSettingsStore } from "../settingsStore";
import type { TerminalShell } from "../tauri";

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

    // 登记清空钩子（菜单「终端 → 清空终端」）
    const unsubClear = registerTerminalClearHook(id, () => term.clear());

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
      unsubClear();
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
  const shells = useTerminalStore((s) => s.shells);
  const shellsLoaded = useTerminalStore((s) => s.shellsLoaded);
  const loadShells = useTerminalStore((s) => s.loadShells);
  const terminalShell = useSettingsStore((s) => s.terminalShell);
  const updateSetting = useSettingsStore((s) => s.update);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);

  // 默认 Shell：设置中记住的 id 仍在本机探测结果内则用之，否则回退第一项（未探测到则后端默认 PowerShell）
  const defaultShell = shells.find((s) => s.id === terminalShell) ?? shells[0];
  const defaultShellName = defaultShell?.name ?? "PowerShell";

  // 面板打开时探测一次可用 Shell（新建/自动创建以此为准）
  useEffect(() => {
    if (panelOpen) void loadShells();
  }, [panelOpen, loadShells]);

  // 终端仅在面板打开期间挂载；首次打开自动建一个会话（等 Shell 探测完成，保证 Shell 类型正确）
  useEffect(() => {
    if (panelOpen && shellsLoaded && sessions.length === 0 && workspaceRoot) {
      void create(workspaceRoot, `${defaultShellName} 1`, defaultShell?.id);
    }
  }, [panelOpen, shellsLoaded, sessions.length, workspaceRoot, create, defaultShell, defaultShellName]);

  /** 从下拉中选择 Shell：记为默认（settings.json）并立即创建一个该 Shell 的会话 */
  const selectShell = (s: TerminalShell) => {
    setShellMenuOpen(false);
    updateSetting({ terminalShell: s.id });
    if (workspaceRoot) {
      void create(workspaceRoot, `${s.name} ${sessions.length + 1}`, s.id);
    }
  };

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
          title={`新建终端（${defaultShellName}）`}
          onClick={() => {
            if (workspaceRoot) {
              void create(
                workspaceRoot,
                `${defaultShellName} ${sessions.length + 1}`,
                defaultShell?.id,
              );
            }
          }}
          className="ml-1 flex h-5 w-5 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
        >
          <Plus size={14} />
        </button>
        <div className="relative">
          <button
            title="选择 Shell 类型（Git Bash / CMD / PowerShell 等）"
            onClick={() => setShellMenuOpen((o) => !o)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
          >
            <ChevronDown size={14} />
          </button>
          {shellMenuOpen && (
            <>
              {/* 全屏透明遮罩：点击外部关闭菜单 */}
              <div className="fixed inset-0 z-40" onClick={() => setShellMenuOpen(false)} />
              <div className="absolute left-0 top-6 z-50 min-w-[180px] rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] py-1 shadow-2xl">
                {shells.map((s) => (
                  <button
                    key={s.id}
                    title={s.path ?? s.name}
                    onClick={() => selectShell(s)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--aluka-text)] hover:bg-[var(--aluka-hover)]"
                  >
                    <span className="flex w-3.5 shrink-0 justify-center">
                      {defaultShell?.id === s.id && (
                        <Check size={12} className="text-[var(--aluka-statusbar-bg)]" />
                      )}
                    </span>
                    <span>{s.name}</span>
                  </button>
                ))}
                {shells.length === 0 && (
                  <div className="px-3 py-1.5 text-[12px] text-[var(--aluka-text-dim)]">
                    未探测到可用 Shell
                  </div>
                )}
              </div>
            </>
          )}
        </div>
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

