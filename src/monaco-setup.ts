// 核心 API（不含任何语言服务/语言 worker，符合 NFR-06 离线 + R2 轻量取舍）
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

// 菜单「编辑/选择」命令依赖的编辑器 contrib（按需导入，不用 editor.all 全量）：
// 剪贴板剪切/复制/粘贴、查找/替换、行/块注释、多光标、智能选择
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect.js";
// 光标处符号自动高亮（VS Code occurrence highlight；自带 * 语言纯文本词匹配回退，无 LSP 依赖）
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js";

// 常用语言的 Monarch 语法定义（纯高亮，零 worker）。
// 注意：json 无 basic 高亮，复用 javascript（见 LANGUAGE_BY_EXT）。
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution";

// 本地打包编辑器 worker（NFR-06：离线可用，不依赖 CDN）
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

window.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** 扩展名 → Monaco 语言 ID */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  // json 无 basic Monarch 定义，复用 javascript 高亮（无 schema 校验，轻量取舍）
  json: "javascript",
  rs: "rust",
  py: "python",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sh: "shell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  go: "go",
  java: "java",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  toml: "ini",
  ini: "ini",
  lua: "lua",
  swift: "swift",
  kt: "kotlin",
};

/** 语言 ID → 状态栏显示名 */
const LANGUAGE_LABEL: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  python: "Python",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  markdown: "Markdown",
  yaml: "YAML",
  xml: "XML",
  shell: "Shell",
  bat: "Batch",
  sql: "SQL",
  go: "Go",
  java: "Java",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  ini: "INI",
  lua: "Lua",
  swift: "Swift",
  kotlin: "Kotlin",
  plaintext: "纯文本",
};

export function languageOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

export function languageLabel(id: string): string {
  return LANGUAGE_LABEL[id] ?? id;
}

/** 内置主题：VS Code Dark+ 风格（M4/M6 由主题引擎按 VS Code 主题 JSON 动态生成） */
monaco.editor.defineTheme("aluka-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editor.selectionBackground": "#264f78",
    "editor.lineHighlightBackground": "#2a2a2a",
    "editorCursor.foreground": "#aeafad",
    "editorIndentGuide.background1": "#404040",
  },
});

export default monaco;
