import { create } from "zustand";

/** 状态栏实时编辑信息（由 CodeEditor 的光标/模型事件驱动） */
interface EditorStatus {
  line: number;
  col: number;
  eol: "LF" | "CRLF";
  language: string;
  update: (s: Partial<Omit<EditorStatus, "update">>) => void;
}

export const useStatusStore = create<EditorStatus>((set) => ({
  line: 1,
  col: 1,
  eol: "CRLF",
  language: "纯文本",
  update: (s) => set(s),
}));
