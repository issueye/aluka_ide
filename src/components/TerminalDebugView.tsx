import { useEffect, useState } from "react";
import { Bug, ChevronDown, ChevronRight, Copy, Eraser, Pause, Play, Send, Trash2 } from "lucide-react";
import { useTerminalStore } from "../terminalStore";
import {
  escapeControlChars,
  payloadBytesHex,
  resendRecord,
  sendManual,
  setSessionMode,
  setSessionRules,
  useTerminalIoStore,
  VIEW_RECORD_LIMIT,
  type TerminalIoDirection,
  type TerminalIoMode,
  type TerminalIoRecord,
  type TerminalIoRule,
} from "../terminalIo";

/**
 * 终端 IO 调试视图（M8 增强 / FR-06 调试配套）。
 * 观察 xterm → Rust write_terminal → Shell 链路的输入与回显：
 *   - 会话级放行 / 丢弃（整帧拦截）；
 *   - 字面量 / 正则改写规则；
 *   - 手动发送（转义解析）与历史重发；
 *   - 输入 / 输出 / 手动 / 重发四类记录，可复制原文与 UTF-8 字节序列。
 * 仅记录不发送任何遥测；调试配置不持久化。
 */

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const DIRECTION_LABEL: Record<TerminalIoDirection, string> = {
  in: "输入",
  out: "输出",
  manual: "手动",
  resend: "重发",
};

const DIRECTION_COLOR: Record<TerminalIoDirection, string> = {
  in: "text-[var(--aluka-text)]",
  out: "text-[#569cd6]",
  manual: "text-[#ce9178]",
  resend: "text-[#ce9178]",
};

const VERDICT_LABEL: Record<TerminalIoRecord["verdict"], string> = {
  sent: "已发送",
  received: "已接收",
  dropped: "已拦截",
};

const VERDICT_COLOR: Record<TerminalIoRecord["verdict"], string> = {
  sent: "text-[#4ec9b0]",
  received: "text-[#569cd6]",
  dropped: "text-[#f48771]",
};

/** 单条规则的编辑行 */
function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: TerminalIoRule;
  onChange: (rule: TerminalIoRule) => void;
  onDelete: () => void;
}) {
  const inputCls =
    "min-w-0 flex-1 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-1.5 py-0.5 text-[11px] text-[var(--aluka-text)] outline-none";
  return (
    <div className="flex items-center gap-1">
      <button
        title={rule.enabled ? "启用中" : "已禁用"}
        onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
        className={`h-4 w-4 shrink-0 rounded border text-[10px] ${
          rule.enabled
            ? "border-transparent bg-[var(--aluka-btn-bg)] text-white"
            : "border-[var(--aluka-border)] text-[var(--aluka-text-dim)]"
        }`}
      >
        {rule.enabled ? "✓" : ""}
      </button>
      <input
        value={rule.find}
        placeholder="查找"
        spellCheck={false}
        onChange={(e) => onChange({ ...rule, find: e.target.value })}
        className={inputCls}
      />
      <span className="text-[10px] text-[var(--aluka-text-dim)]">→</span>
      <input
        value={rule.replace}
        placeholder="替换"
        spellCheck={false}
        onChange={(e) => onChange({ ...rule, replace: e.target.value })}
        className={inputCls}
      />
      <button
        title={rule.regex ? "正则模式" : "字面量模式"}
        onClick={() => onChange({ ...rule, regex: !rule.regex })}
        className={`h-5 shrink-0 rounded px-1 text-[10px] ${
          rule.regex ? "bg-[var(--aluka-btn-bg)] text-white" : "text-[var(--aluka-text-dim)]"
        }`}
      >
        .*
      </button>
      <button title="删除规则" onClick={onDelete} className="shrink-0 text-[var(--aluka-text-dim)] hover:text-[#f48771]">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

/** 单个终端会话的调试配置区 */
function SessionCard({
  sessionId,
  name,
  mode,
  rules,
}: {
  sessionId: number;
  name: string;
  mode: TerminalIoMode;
  rules: TerminalIoRule[];
}) {
  const [open, setOpen] = useState(false);
  const recordCount = useTerminalIoStore((s) => s.records.filter((r) => r.sessionId === sessionId).length);

  const updateRules = (next: TerminalIoRule[]) => setSessionRules(sessionId, next);

  return (
    <div className="rounded border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)]">
      <div className="flex h-7 items-center gap-1.5 px-2">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="truncate text-[12px] text-[var(--aluka-text)]">{name}</span>
          <span className="shrink-0 text-[10px] text-[var(--aluka-text-dim)]">#{sessionId} · {recordCount} 条</span>
        </button>
        <select
          value={mode}
          title="调试模式：放行 / 丢弃（整帧不发送）"
          onChange={(e) => setSessionMode(sessionId, e.target.value as TerminalIoMode)}
          className="shrink-0 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-1 py-0.5 text-[11px] text-[var(--aluka-text)] outline-none"
        >
          <option value="allow">放行</option>
          <option value="drop">丢弃</option>
        </select>
        <button
          title="清空该会话记录"
          onClick={() => useTerminalIoStore.getState().clearSessionRecords(sessionId)}
          className="shrink-0 text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
        >
          <Eraser size={12} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-[var(--aluka-border)] p-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onChange={(next) => updateRules(rules.map((r) => (r.id === next.id ? next : r)))}
              onDelete={() => updateRules(rules.filter((r) => r.id !== rule.id))}
            />
          ))}
          <button
            onClick={() =>
              updateRules([
                ...rules,
                { id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, find: "", replace: "", regex: false, enabled: true },
              ])
            }
            className="self-start text-[11px] text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
          >
            + 添加替换规则
          </button>
          {rules.length === 0 && (
            <div className="text-[10px] text-[var(--aluka-text-dim)]">无替换规则；开启后输入原样透传</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 单条 IO 记录行 */
function RecordRow({ record }: { record: TerminalIoRecord }) {
  const [copied, setCopied] = useState<string | null>(null);
  const sessionName = useTerminalStore((s) => s.sessions.find((t) => t.id === record.sessionId)?.name);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied("复制失败");
    }
  };

  return (
    <div className="border-b border-[var(--aluka-border)] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[10px] text-[var(--aluka-text-dim)]">{formatTime(record.ts)}</span>
        <span className={`shrink-0 text-[10px] ${DIRECTION_COLOR[record.direction]}`}>{DIRECTION_LABEL[record.direction]}</span>
        <span className={`shrink-0 text-[10px] ${VERDICT_COLOR[record.verdict]}`}>{VERDICT_LABEL[record.verdict]}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--aluka-text-dim)]">
          {sessionName ?? `终端 ${record.sessionId}`}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {record.verdict !== "received" && (
            <button
              title="以该 payload 重发"
              onClick={() => resendRecord(record)}
              className="text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
            >
              <Send size={12} />
            </button>
          )}
          <button
            title="复制原始数据"
            onClick={() => void copy(record.payload, "已复制原文")}
            className="text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
          >
            <Copy size={12} />
          </button>
          <button
            title="复制 UTF-8 字节序列"
            onClick={() => void copy(payloadBytesHex(record.payload), "已复制字节")}
            className="text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
          >
            <Copy size={12} />
          </button>
        </div>
      </div>
      <div
        title={record.note ?? undefined}
        className={`mt-0.5 break-all font-mono text-[11px] ${VERDICT_COLOR[record.verdict]}`}
      >
        {escapeControlChars(record.payload)}
      </div>
      {record.sentPayload !== undefined && record.sentPayload !== record.payload && (
        <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--aluka-text-dim)]">
          → {escapeControlChars(record.sentPayload)}
        </div>
      )}
      {copied && <div className="mt-0.5 text-[10px] text-[#4ec9b0]">{copied}</div>}
    </div>
  );
}

export default function TerminalDebugView() {
  const recording = useTerminalIoStore((s) => s.recording);
  const records = useTerminalIoStore((s) => s.records);
  const sessionsCfg = useTerminalIoStore((s) => s.sessions);
  const terminalSessions = useTerminalStore((s) => s.sessions);
  const [dirFilter, setDirFilter] = useState<"all" | TerminalIoDirection>("all");
  const [manualSession, setManualSession] = useState<number | "">("");
  const [manualInput, setManualInput] = useState("");

  // 打开调试视图自动开启记录（视图关闭后保持，避免切换视图期间丢记录；可手动暂停）
  useEffect(() => {
    if (!useTerminalIoStore.getState().recording) {
      useTerminalIoStore.getState().setRecording(true);
    }
  }, []);

  const filtered = records.filter((r) => dirFilter === "all" || r.direction === dirFilter).slice(-VIEW_RECORD_LIMIT);

  const doManualSend = () => {
    if (manualSession === "" || !manualInput.trim()) return;
    sendManual(manualSession, manualInput);
    setManualInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      {/* 工具条 */}
      <div className="flex items-center gap-1.5">
        <button
          title={recording ? "暂停记录（拦截/改写仍生效）" : "开始记录"}
          onClick={() => useTerminalIoStore.getState().setRecording(!recording)}
          className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] ${
            recording ? "bg-[var(--aluka-btn-bg)] text-white" : "text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
          }`}
        >
          {recording ? <Pause size={12} /> : <Play size={12} />}
          {recording ? "录制中…" : "已暂停"}
        </button>
        <button
          title="清空全部记录"
          onClick={() => useTerminalIoStore.getState().clearRecords()}
          className="flex h-6 items-center gap-1 rounded px-2 text-[11px] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
        >
          <Eraser size={12} /> 清空
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          {(["all", "in", "out", "manual", "resend"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                dirFilter === d ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]" : "text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
              }`}
            >
              {d === "all" ? "全部" : DIRECTION_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      {/* 手动发送 */}
      <div className="mt-2 flex items-center gap-1 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] p-1">
        <select
          value={manualSession}
          onChange={(e) => setManualSession(e.target.value === "" ? "" : Number(e.target.value))}
          className="shrink-0 bg-transparent px-1 text-[11px] text-[var(--aluka-text)] outline-none"
        >
          <option value="">目标会话…</option>
          {terminalSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          value={manualInput}
          placeholder="手动发送，支持 \x1b[A \r 等转义"
          spellCheck={false}
          onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doManualSend();
          }}
          className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[11px] text-[var(--aluka-text)] outline-none"
        />
        <button
          onClick={doManualSend}
          disabled={manualSession === "" || !manualInput.trim()}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)] disabled:opacity-40"
        >
          发送
        </button>
      </div>

      {/* 会话配置 */}
      <div className="mt-2 flex flex-col gap-1">
        {terminalSessions.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--aluka-text-dim)]">
            <Bug size={12} /> 暂无终端会话；打开底部终端后即可调试
          </div>
        )}
        {terminalSessions.map((s) => (
          <SessionCard
            key={s.id}
            sessionId={s.id}
            name={s.name}
            mode={sessionsCfg[s.id]?.mode ?? "allow"}
            rules={sessionsCfg[s.id]?.rules ?? []}
          />
        ))}
      </div>

      {/* 记录列表 */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)]">
        {filtered.length === 0 ? (
          <div className="p-3 text-[11px] text-[var(--aluka-text-dim)]">
            {recording ? "暂无记录；在终端中输入字符后将在此显示" : "记录已暂停"}
          </div>
        ) : (
          filtered.map((r) => <RecordRow key={r.seq} record={r} />)
        )}
      </div>
    </div>
  );
}
