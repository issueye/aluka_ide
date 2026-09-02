import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useAppStore } from "../store";
import { useTerminalStore } from "../terminalStore";

/**
 * 底部面板（M5 / FR-06）：终端多标签 + 流式输出 + 输入行回显。
 * 管道模式取舍见 terminal.rs 头注：无屏幕控制序列，输出按纯文本流渲染。
 */

/** 单个终端视图：输出区 + 输入行 */
function TerminalView({ id }: { id: number }) {
  const session = useTerminalStore((s) => s.sessions.find((t) => t.id === id));
  const writeLine = useTerminalStore((s) => s.writeLine);
  const [input, setInput] = useState("");
  const outRef = useRef<HTMLDivElement>(null);

  // 新输出到达时贴底（流式回显）
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.buffer]);

  if (!session) return null;

  const submit = () => {
    if (!input.trim() || session.closed) return;
    void writeLine(id, input);
    setInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={outRef}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all bg-[var(--aluka-bg)] px-2 py-1 font-mono text-[12px] leading-4 text-[var(--aluka-text)]"
      >
        {session.buffer}
        {session.closed && (
          <div className="mt-1 text-[var(--aluka-text-dim)]">—— 会话已结束 ——</div>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1 border-t border-[var(--aluka-border)] px-2">
        <span className="font-mono text-[12px] text-[#0e639c]">&gt;</span>
        <input
          value={input}
          disabled={session.closed}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={session.closed ? "会话已结束" : "输入命令，回车执行…"}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--aluka-text)] outline-none"
        />
      </div>
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
      void create(workspaceRoot, "cmd 1");
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
            className={`group flex h-full cursor-pointer items-center gap-1 border-r border-[var(--aluka-border)] px-3 text-[12px] ${
              activeId === t.id
                ? "bg-[var(--aluka-bg)] text-[var(--aluka-text-active)]"
                : "text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
            }`}
          >
            <span>{t.name}</span>
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
              void create(workspaceRoot, `cmd ${sessions.length + 1}`);
            }
          }}
          className="ml-1 flex h-5 w-5 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
        >
          <Plus size={14} />
        </button>
        <button
          title="关闭面板 (Ctrl+`)"
          onClick={togglePanel}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)]"
        >
          <X size={14} />
        </button>
      </div>
      {activeId !== null ? (
        <TerminalView key={activeId} id={activeId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--aluka-text-dim)]">
          {workspaceRoot ? "点击 + 新建终端会话" : "打开工作区后可使用终端"}
        </div>
      )}
    </section>
  );
}
