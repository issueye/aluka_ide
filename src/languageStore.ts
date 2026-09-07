import { create } from "zustand";
import { getUserLanguages, setUserLanguages } from "./tauri";
import { showInfo } from "./notificationStore";
import {
  registerMonarchLanguage,
  type MonarchLanguageDef,
} from "./monaco-setup";

/**
 * 动态语言高亮（FR-09 增强）：
 * 用户自定义 Monarch 语法注册到 Monaco + 扩展名映射，持久化 ~/.aluka-ide/languages.json。
 * 去掉内置 24 语言静态表的限制：任何 Monarch 定义的语言都能运行时添加。
 * TextMate grammar（.tmLanguage.json）需先转换为 Monarch 格式，本期不内置转换器。
 */

interface LanguageStore {
  /** 已加载的自定义语言定义（镜像 monaco-setup 内注册表，供 UI 展示） */
  defs: MonarchLanguageDef[];
  loaded: boolean;
  /** 启动加载：languages.json → 注册全部（幂等） */
  load: () => Promise<void>;
  /** 校验并注册一个语言 + 持久化；失败返回错误信息（不抛出，由 UI 展示） */
  add: (def: unknown) => Promise<string | null>;
  /** 删除语言（仅自定义）+ 持久化 */
  remove: (id: string) => Promise<void>;
}

/** 从 unknown 收窄为 MonarchLanguageDef；非法返回 null（不信任 languages.json 内容） */
function coerceDef(raw: unknown): MonarchLanguageDef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const extensions = Array.isArray(o.extensions)
    ? o.extensions.filter((e): e is string => typeof e === "string" && /^[a-z0-9_-]+$/i.test(e)).map((e) => e.toLowerCase())
    : [];
  const tokenizer =
    typeof o.tokenizer === "object" && o.tokenizer !== null && !Array.isArray(o.tokenizer)
      ? (o.tokenizer as Record<string, unknown>)
      : null;
  if (!id || !label || extensions.length === 0 || !tokenizer) return null;
  return {
    id,
    label,
    extensions,
    tokenizer,
    lineComment: typeof o.lineComment === "string" ? o.lineComment : undefined,
    blockComment:
      Array.isArray(o.blockComment) && o.blockComment.length === 2 &&
      o.blockComment.every((x) => typeof x === "string")
        ? (o.blockComment as [string, string])
        : undefined,
    brackets: undefined,
  };
}

function persist(defs: MonarchLanguageDef[]): void {
  void setUserLanguages(defs).catch((e) => console.error("写入 languages.json 失败:", e));
}

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  defs: [],
  loaded: false,

  load: async () => {
    let raw: unknown = null;
    try {
      raw = await getUserLanguages();
    } catch {
      return; // 纯浏览器 dev 无后端
    }
    const defs: MonarchLanguageDef[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const def = coerceDef(item);
        if (def) {
          registerMonarchLanguage(def);
          defs.push(def);
        }
      }
    }
    set({ defs, loaded: true });
  },

  add: async (raw) => {
    const def = coerceDef(raw);
    if (!def) {
      return "定义无效：需要 id（字母数字连字符）、label、非空 extensions 数组、tokenizer 对象";
    }
    // 内置语言同 id 时用户定义覆盖为允许行为（与 VS Code 语言优先级一致）
    registerMonarchLanguage(def);
    const defs = [...get().defs.filter((d) => d.id !== def.id), def];
    set({ defs });
    persist(defs);
    showInfo(`语言 ${def.label}（${def.extensions.map((e) => "." + e).join(" ")}）已添加`);
    return null;
  },

  remove: async (id) => {
    const defs = get().defs.filter((d) => d.id !== id);
    set({ defs });
    persist(defs);
    showInfo(`语言 ${id} 已移除（重启后完全生效）`);
    // Monaco 无反注册 API：会话内保留注册，重启后不再加载
  },
}));
