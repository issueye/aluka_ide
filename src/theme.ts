import monaco from "./monaco-setup";

/**
 * 主题引擎（M4 / FR-09）。
 * 主题采用 VS Code 主题 JSON 的形状（colors + tokenColors），
 * 内置 Dark+/Light+ 用同一形状声明，M6 加载的扩展主题原样喂进 applyTheme 即可。
 */
export interface TokenRule {
  scope: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

export interface AlukaTheme {
  id: string;
  label: string;
  /** Monaco 基色（BuiltinTheme：暗=vs-dark，亮=vs） */
  base: "vs-dark" | "vs";
  /** workbench 颜色 ID → 色值 */
  colors: Record<string, string>;
  /** 语法着色规则 */
  tokenColors: TokenRule[];
}

/**
 * VS Code workbench 颜色 ID → Aluka CSS 变量（--aluka-*）映射表。
 * 主题引擎据此把 colors 写进 :root；组件只用 CSS 变量，切换即全局生效。
 */
const COLOR_TO_CSS_VAR: Record<string, string> = {
  "editor.background": "--aluka-bg",
  "sideBar.background": "--aluka-sidebar-bg",
  "activityBar.background": "--aluka-activity-bg",
  "activityBar.inactiveForeground": "--aluka-activity-fg",
  "activityBar.foreground": "--aluka-activity-active",
  "titleBar.background": "--aluka-titlebar-bg",
  "statusBar.background": "--aluka-statusbar-bg",
  "panel.border": "--aluka-border",
  "editorGroupHeader.tabsBackground": "--aluka-tabs-bg",
  "panel.background": "--aluka-panel-bg",
  foreground: "--aluka-text",
  descriptionForeground: "--aluka-text-dim",
  "list.hoverBackground": "--aluka-hover",
  "list.activeSelectionBackground": "--aluka-active",
  "list.activeSelectionForeground": "--aluka-text-active",
  "editorWidget.background": "--aluka-overlay-bg",
  "input.background": "--aluka-input-bg",
  "button.background": "--aluka-btn-bg",
  "button.hoverBackground": "--aluka-btn-hover",
};

function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

/** 把主题 colors 写入 CSS 变量（未映射的 ID 忽略，供 M6 扩展主题前向兼容） */
export function applyThemeColors(theme: AlukaTheme): void {
  for (const [colorId, cssVar] of Object.entries(COLOR_TO_CSS_VAR)) {
    const v = theme.colors[colorId];
    if (v) setVar(cssVar, v);
  }
}

/**
 * Monaco 主题名：只允许字母/数字/-/_（扩展主题 id 含点号，
 * 不清洗会触发 Monaco "illegal theme name!"）。
 */
export function monacoThemeName(id: string): string {
  return `aluka-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** tokenColors → Monaco rules；定义并切换编辑器主题 */
export function applyMonacoTheme(theme: AlukaTheme): void {
  const rules = theme.tokenColors.map((r) => {
    const scope = Array.isArray(r.scope) ? r.scope.join(",") : (r.scope ?? "");
    return {
      token: scope,
      foreground: r.settings.foreground?.replace("#", ""),
      fontStyle: r.settings.fontStyle,
    };
  });
  // Monaco 忽略未知颜色 ID：theme.colors 原样透传（editor.* 生效，workbench 色忽略）
  const colors: Record<string, string> = { ...theme.colors };
  const name = monacoThemeName(theme.id);
  monaco.editor.defineTheme(name, {
    base: theme.base,
    inherit: true,
    rules,
    colors,
  });
  monaco.editor.setTheme(name);
}

export function applyTheme(theme: AlukaTheme): void {
  applyThemeColors(theme);
  applyMonacoTheme(theme);
  // 亮色主题下 webview 默认底色跟随，避免滚动橡皮筋/子像素露白
  document.body.style.background = theme.colors["editor.background"] ?? "#1e1e1e";
}

/* ---------------- 内置主题 ---------------- */

/** Dark+：色值对齐 VS Code Dark+（迁移自 index.css 的静态默认） */
const DARK_PLUS: AlukaTheme = {
  id: "dark-plus",
  label: "Dark+ (default dark)",
  base: "vs-dark",
  colors: {
    "editor.background": "#1e1e1e",
    "sideBar.background": "#252526",
    "activityBar.background": "#333333",
    "activityBar.inactiveForeground": "#858585",
    "activityBar.foreground": "#ffffff",
    "titleBar.background": "#3c3c3c",
    "statusBar.background": "#007acc",
    "panel.border": "#2b2b2b",
    "editorGroupHeader.tabsBackground": "#252526",
    "panel.background": "#1e1e1e",
    foreground: "#cccccc",
    descriptionForeground: "#8b8b8b",
    "list.hoverBackground": "#2a2d2e",
    "list.activeSelectionBackground": "#37373d",
    "list.activeSelectionForeground": "#ffffff",
    "editorWidget.background": "#252526",
    "input.background": "#3c3c3c",
    "button.background": "#0e639c",
    "button.hoverBackground": "#1177bb",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editor.selectionBackground": "#264f78",
    "editor.lineHighlightBackground": "#2a2a2a",
    "editorCursor.foreground": "#aeafad",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6a9955" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#569cd6" } },
    { scope: ["string", "constant.character.escape"], settings: { foreground: "#ce9178" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#b5cea8" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#dcdcaa" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type"], settings: { foreground: "#4ec9b0" } },
    { scope: ["variable", "identifier"], settings: { foreground: "#9cdcfe" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#569cd6" } },
    { scope: ["support.class.component"], settings: { foreground: "#4ec9b0" } },
  ],
};

/** Light+：色值对齐 VS Code Light+ */
const LIGHT_PLUS: AlukaTheme = {
  id: "light-plus",
  label: "Light+ (default light)",
  base: "vs",
  colors: {
    "editor.background": "#ffffff",
    "sideBar.background": "#f3f3f3",
    // 活动栏跟随浅色（新版 VS Code 浅色主题的走向），图标深色保证对比
    "activityBar.background": "#f3f3f3",
    "activityBar.inactiveForeground": "#868686",
    "activityBar.foreground": "#333333",
    "titleBar.background": "#dddddd",
    "statusBar.background": "#007acc",
    "panel.border": "#e7e7e7",
    "editorGroupHeader.tabsBackground": "#f3f3f3",
    "panel.background": "#ffffff",
    foreground: "#1f1f1f",
    descriptionForeground: "#6c6c6c",
    "list.hoverBackground": "#e8e8e8",
    "list.activeSelectionBackground": "#c4dfef",
    "list.activeSelectionForeground": "#1f1f1f",
    "editorWidget.background": "#ffffff",
    "input.background": "#ffffff",
    "button.background": "#007acc",
    "button.hoverBackground": "#0e639c",
    "editor.foreground": "#000000",
    "editorLineNumber.foreground": "#237893",
    "editor.selectionBackground": "#add6ff",
    "editor.lineHighlightBackground": "#f7f7f7",
    "editorCursor.foreground": "#000000",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#008000" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#0000ff" } },
    { scope: ["string", "constant.character.escape"], settings: { foreground: "#a31515" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#098658" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#795e26" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type"], settings: { foreground: "#267f99" } },
    { scope: ["variable", "identifier"], settings: { foreground: "#001080" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#800000" } },
    { scope: ["support.class.component"], settings: { foreground: "#267f99" } },
  ],
};

export const BUILTIN_THEMES: AlukaTheme[] = [DARK_PLUS, LIGHT_PLUS];

/** 运行时注册的扩展主题（M6：VSIX contributes.themes），覆盖同名 id */
const registeredThemes = new Map<string, AlukaTheme>();

export function registerTheme(theme: AlukaTheme): void {
  registeredThemes.set(theme.id, theme);
}

export function getTheme(id: string): AlukaTheme {
  return (
    registeredThemes.get(id) ??
    BUILTIN_THEMES.find((t) => t.id === id) ??
    DARK_PLUS
  );
}

/** 全部可用主题（内置 + 扩展） */
export function allThemes(): AlukaTheme[] {
  return [...BUILTIN_THEMES, ...registeredThemes.values()];
}

/** 主题 ID → 显示名（设置/命令面板用） */
export function themeLabel(id: string): string {
  return getTheme(id).label;
}
