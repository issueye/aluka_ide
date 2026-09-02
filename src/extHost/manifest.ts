import type { AlukaTheme } from "../theme";

/**
 * VS Code 扩展清单 L1 契约（REQUIREMENTS §5）。
 * package.json 原样来自后端扫描（unknown），在此收窄为强类型。
 */

export interface ThemeContribution {
  /** 主题显示名（用户在主题选择器看到的名字） */
  label: string;
  /** 相对扩展目录的主题 JSON 路径 */
  path: string;
  /** ui 默认；vscode 里还有 ai 生成主题等，忽略 */
  ui?: string;
}

export interface CommandContribution {
  /** 全局唯一命令 id，如 "aluka-hello.sayHello" */
  command: string;
  title: string;
  category?: string;
  icon?: string;
}

export interface KeybindingContribution {
  command: string;
  /** VS Code 快捷键表示法，如 "ctrl+shift+9" */
  key: string;
  /** 生效时机（mac 上 cmd）；本期仅实现 ctrl/shift/alt 组合 */
  mac?: string;
  when?: string;
}

export interface SnippetContribution {
  /** 片段适用的语言 id（如 javascript / go） */
  language: string;
  /** 相对路径的片段 JSON（VS Code 格式：前缀 → {body, description}） */
  path: string;
}

export interface ExtensionManifest {
  name: string;
  publisher: string;
  version: string;
  displayName?: string;
  description?: string;
  main?: string;
  contributes?: {
    themes?: ThemeContribution[];
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    snippets?: SnippetContribution[];
  };
}

/** 从 unknown（后端透传 JSON）收窄清单；结构非法返回 null */
export function parseManifest(raw: unknown): ExtensionManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.publisher !== "string") return null;
  const contributesRaw = o.contributes;
  const contributes =
    typeof contributesRaw === "object" && contributesRaw !== null
      ? (contributesRaw as ExtensionManifest["contributes"])
      : undefined;
  return {
    name: o.name,
    publisher: o.publisher,
    version: typeof o.version === "string" ? o.version : "0.0.0",
    displayName: typeof o.displayName === "string" ? o.displayName : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    main: typeof o.main === "string" ? o.main : undefined,
    contributes,
  };
}

/** 扩展唯一 id（publisher.name，VS Code 惯例） */
export function extensionId(m: ExtensionManifest): string {
  return `${m.publisher}.${m.name}`.toLowerCase();
}

/** 主题 JSON（VS Code 形状）→ AlukaTheme；base 由主题 JSON 的 type 字段推断 */
export function parseThemeJson(
  themeId: string,
  label: string,
  json: unknown,
): AlukaTheme | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const colors: Record<string, string> = {};
  if (typeof o.colors === "object" && o.colors !== null) {
    for (const [k, v] of Object.entries(o.colors as Record<string, unknown>)) {
      if (typeof v === "string") colors[k] = v;
    }
  }
  if (!colors["editor.background"]) return null; // 主题 JSON 至少要有编辑器背景
  const type = o.type === "light" ? "vs" : "vs-dark";
  return {
    id: themeId,
    label,
    base: type,
    colors,
    tokenColors: Array.isArray(o.tokenColors)
      ? (o.tokenColors as AlukaTheme["tokenColors"])
      : [],
  };
}
