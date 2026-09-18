import { create } from "zustand";

/**
 * 终端 IO 调试管道（M8 增强）。
 *
 * 位置：xterm / 右键粘贴 / 命令面板等任何前端写入 → 本管道 → Rust write_terminal → ConPTY。
 * 能力：
 *   - 会话级模式：放行（默认可按会话规则改写）/ 丢弃（整帧不发送）；
 *   - 双向记录：输入（xterm→Shell）与输出（Shell→xterm），环形缓冲上限 MAX_RECORDS；
 *   - 手动发送与历史重发：绕过会话拦截，直接送入终端并记录；
 *   - 不持久化调试状态，避免残留拦截配置影响正常使用。
 *
 * terminalStore 通过 setTerminalSendSink 注入真实发送函数，本模块不依赖 Tauri 细节。
 */

export type TerminalIoMode = "allow" | "drop";
export type TerminalIoDirection = "in" | "out" | "manual" | "resend";
export type TerminalIoVerdict = "sent" | "received" | "dropped";

/** 单条替换规则：字面量精确替换或正则全局替换 */
export interface TerminalIoRule {
  id: string;
  find: string;
  replace: string;
  regex: boolean;
  enabled: boolean;
}

/** 单个终端会话的调试配置 */
export interface TerminalIoSessionConfig {
  mode: TerminalIoMode;
  rules: TerminalIoRule[];
}

/** 一条 IO 记录。payload 始终保留原始完整数据，展示层再转义。 */
export interface TerminalIoRecord {
  seq: number;
  sessionId: number;
  direction: TerminalIoDirection;
  ts: number;
  payload: string;
  /** 实际发送内容（改写后 / 重发原样）；输出方向与丢弃场景为空 */
  sentPayload?: string;
  verdict: TerminalIoVerdict;
  /** 改写规则命中 / 正则编译失败等辅助说明 */
  note?: string;
}

interface TerminalIoStore {
  /** 是否记录（关闭时仍可拦截/改写；默认关闭，调试视图打开时自动开启） */
  recording: boolean;
  records: TerminalIoRecord[];
  sessions: Record<number, TerminalIoSessionConfig>;
  setRecording: (on: boolean) => void;
  setSessionMode: (sessionId: number, mode: TerminalIoMode) => void;
  setSessionRules: (sessionId: number, rules: TerminalIoRule[]) => void;
  clearRecords: () => void;
  clearSessionRecords: (sessionId: number) => void;
  removeSession: (sessionId: number) => void;
}

export const MAX_RECORDS = 1000;
/** 视图最多渲染最近 N 条，避免 1000 条 DOM 卡顿 */
export const VIEW_RECORD_LIMIT = 300;

let seqCounter = 0;
let sendSink: (sessionId: number, data: string) => Promise<void> | void = async () => {};
/** 会话存活检查（由 terminalStore 注入，避免本模块依赖 terminalStore 形成循环引用） */
let sessionAliveCheck: (sessionId: number) => boolean = () => true;

/**
 * 每个会话的发送串行队列：Tauri invoke 并发发起时后端仍按到达顺序写 PTY，
 * 但快速打字 / 粘贴大块内容时逐帧 await 可保证严格顺序且不互相交错。
 */
const sendQueues = new Map<number, Promise<void>>();

function enqueueSend(sessionId: number, task: () => Promise<void> | void): Promise<void> {
  const prev = sendQueues.get(sessionId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      await task();
    })
    .catch((e) => {
      console.error("终端调试管道发送失败:", e);
    });
  sendQueues.set(sessionId, next);
  return next;
}

/**
 * 注入真实发送函数（terminalStore 初始化时调用一次）。
 * sink 必须捕获自身异常；本管道不因写入失败中断记录。
 */
export function setTerminalSendSink(
  sink: (sessionId: number, data: string) => Promise<void> | void,
): void {
  sendSink = sink;
}

/** 注入会话存活检查回调（terminalStore 初始化时调用一次） */
export function setTerminalSessionAliveCheck(
  check: (sessionId: number) => boolean,
): void {
  sessionAliveCheck = check;
}

function pushRecord(
  sessionId: number,
  direction: TerminalIoDirection,
  payload: string,
  verdict: TerminalIoVerdict,
  sentPayload?: string,
  note?: string,
): void {
  seqCounter += 1;
  const record: TerminalIoRecord = {
    seq: seqCounter,
    sessionId,
    direction,
    ts: Date.now(),
    payload,
    verdict,
    sentPayload,
    note,
  };
  useTerminalIoStore.setState((s) => ({
    records: [...s.records, record].slice(-MAX_RECORDS),
  }));
}

/** 惰性初始化会话配置；默认放行、无规则。 */
export function ensureTerminalSession(sessionId: number): void {
  useTerminalIoStore.setState((s) => {
    if (s.sessions[sessionId]) return s;
    return {
      sessions: {
        ...s.sessions,
        [sessionId]: { mode: "allow", rules: [] },
      },
    };
  });
}

function applyRules(payload: string, rules: TerminalIoRule[]): { output: string; notes: string[] } {
  let output = payload;
  const notes: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.find) continue;
    if (rule.regex) {
      try {
        output = output.replace(new RegExp(rule.find, "g"), rule.replace);
        notes.push("正则命中");
      } catch {
        notes.push("正则无效");
      }
    } else if (output.includes(rule.find)) {
      output = output.split(rule.find).join(rule.replace);
      notes.push("规则命中");
    }
  }
  return { output, notes };
}

/**
 * 所有来自 xterm / 粘贴 / 命令写入的统一入口。
 * - drop：整帧不发送，仅记录；
 * - allow + 启用规则：改写后发送；
 * - allow：原样发送。
 * 记录仅在 recording=true 时写入，但拦截始终生效。
 */
export async function proxyWrite(sessionId: number, data: string): Promise<void> {
  ensureTerminalSession(sessionId);
  const cfg = useTerminalIoStore.getState().sessions[sessionId] ?? { mode: "allow" as const, rules: [] };
  if (cfg.mode === "drop") {
    const rec = useTerminalIoStore.getState().recording;
    if (rec) pushRecord(sessionId, "in", data, "dropped", undefined, "会话处于丢弃模式");
    return;
  }
  const { output, notes } = applyRules(data, cfg.rules);
  const preview = notes.length > 0 ? notes.join("；") : undefined;
  const rec = useTerminalIoStore.getState().recording;
  if (rec) {
    if (output === data) pushRecord(sessionId, "in", data, "sent", output, preview);
    else pushRecord(sessionId, "in", data, "sent", output, preview ?? "规则改写");
  }
  await enqueueSend(sessionId, () => sendSink(sessionId, output));
}

/** Shell → xterm 回显记录（terminalStore 输出订阅旁路调用） */
export function recordTerminalOutput(sessionId: number, data: string): void {
  if (!useTerminalIoStore.getState().recording) return;
  pushRecord(sessionId, "out", data, "received");
}

/** 手动发送：绕过会话 drop 拦截，转义解析后直接送达并记录。 */
export function sendManual(sessionId: number, raw: string): void {
  const payload = parseEscapedInput(raw);
  if (payload.length === 0) return;
  if (!sessionAliveCheck(sessionId)) return;
  ensureTerminalSession(sessionId);
  if (useTerminalIoStore.getState().recording) {
    pushRecord(sessionId, "manual", payload, "sent", payload);
  }
  void enqueueSend(sessionId, () => sendSink(sessionId, payload));
}

/** 历史重发：原样重放已记录的输入 payload。 */
export function resendRecord(record: TerminalIoRecord): void {
  if (record.verdict === "received") return;
  if (!sessionAliveCheck(record.sessionId)) return;
  const payload = record.sentPayload ?? record.payload;
  ensureTerminalSession(record.sessionId);
  if (useTerminalIoStore.getState().recording) {
    pushRecord(record.sessionId, "resend", payload, "sent", payload, "历史重发");
  }
  void enqueueSend(record.sessionId, () => sendSink(record.sessionId, payload));
}

/**
 * 将 `\r` `\n` `\t` `\\` `\x1b` `\u{1f600}` 等转义写法还原为真实字符。
 * 未知转义保持原样，便于发送任意控制序列。
 */
export function parseEscapedInput(input: string): string {
  return input.replace(
    /\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]+)\}|\\n|\\r|\\t|\\\\(?!x|u\{)/g,
    (m, hex: string | undefined, uni: string | undefined) => {
      if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
      if (uni !== undefined) {
        const code = parseInt(uni, 16);
        return code > 0xffff ? String.fromCodePoint(code) : String.fromCharCode(code);
      }
      switch (m) {
        case "\\n": return "\n";
        case "\\r": return "\r";
        case "\\t": return "\t";
        default: return "\\";
      }
    },
  );
}

/** 控制字符可读化：ESC / <CR> / <LF> / <TAB> / \x07 等，供列表单行展示。 */
export function escapeControlChars(input: string, limit = 240): string {
  let out = "";
  const chars = Array.from(input.slice(0, limit));
  for (const ch of chars) {
    if (ch === "\x1b") out += "ESC";
    else if (ch === "\r") out += "<CR>";
    else if (ch === "\n") out += "<LF>";
    else if (ch === "\t") out += "<TAB>";
    else if (ch === "\u0000") out += "\\0";
    else {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) {
        out += "\\x" + code.toString(16).padStart(2, "0");
      } else {
        out += ch;
      }
    }
  }
  if (input.length > limit) out += "…";
  return out;
}

/** UTF-8 字节十六进制，便于核对控制序列实际字节：ESC [ A → 1b 5b 41 */
export function payloadBytesHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

export const useTerminalIoStore = create<TerminalIoStore>((set, get) => ({
  recording: false,
  records: [],
  sessions: {},
  setRecording: (on) => set({ recording: on }),
  setSessionMode: (sessionId, mode) => {
    ensureTerminalSession(sessionId);
    const sessions = get().sessions;
    const cfg = sessions[sessionId];
    set({ sessions: { ...sessions, [sessionId]: { ...cfg, mode } } });
  },
  setSessionRules: (sessionId, rules) => {
    ensureTerminalSession(sessionId);
    const sessions = get().sessions;
    const cfg = sessions[sessionId];
    set({ sessions: { ...sessions, [sessionId]: { ...cfg, rules } } });
  },
  clearRecords: () => set({ records: [] }),
  clearSessionRecords: (sessionId) => {
    const records = get().records.filter((r) => r.sessionId !== sessionId);
    set({ records });
  },
  removeSession: (sessionId) => {
    const sessions = get().sessions;
    const next = { ...sessions };
    delete next[sessionId];
    set((s) => ({
      sessions: next,
      records: s.records.filter((r) => r.sessionId !== sessionId),
    }));
  },
}));

/** 清理已关闭会话的调试配置与记录（terminalStore 会话删除时调用） */
export function clearTerminalDebugSession(sessionId: number): void {
  useTerminalIoStore.getState().removeSession(sessionId);
  // 一并释放该会话的发送串行队列，避免关闭后仍累积 promise 链
  sendQueues.delete(sessionId);
}

/** 会话模式切换的薄封装（视图直接调用；未初始化会话时自动补默认配置） */
export function setSessionMode(sessionId: number, mode: TerminalIoMode): void {
  useTerminalIoStore.getState().setSessionMode(sessionId, mode);
}

/** 会话替换规则整体更新的薄封装（视图直接调用） */
export function setSessionRules(sessionId: number, rules: TerminalIoRule[]): void {
  useTerminalIoStore.getState().setSessionRules(sessionId, rules);
}

/**
 * 彻底收尾调试（调试视图关闭按钮调用）：
 *   1. 停止录制；
 *   2. 复位所有会话的拦截/改写配置——否则 drop 模式或改写规则会在视图关闭后继续作用于
 *      正常终端输入，表现为「敲键盘没反应」却无从察觉（配置随后由 ensureTerminalSession
 *      惰性重建为默认放行/无规则）；
 *   3. 清空已跟踪的记录——关闭即视为调试结束，不留存历史 payload。
 * 三者合起来保证「关闭 = 回到未使用该功能的状态」，反复开关不会带回上一次的现场。
 */
export function resetTerminalDebugConfig(): void {
  useTerminalIoStore.setState({
    recording: false,
    sessions: {},
    records: [],
  });
}
