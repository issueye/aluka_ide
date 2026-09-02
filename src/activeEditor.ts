import type * as monaco from "monaco-editor";

/**
 * 全局活动 Monaco 编辑器注册（菜单「编辑/选择」命令的执行目标）。
 * CodeEditor 在获得焦点时登记、卸载时注销；
 * 未聚焦任何编辑器时命令降级走 document.execCommand 或静默提示。
 */
let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null;

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
  activeEditor = editor;
}

export function clearActiveEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
  if (activeEditor === editor) activeEditor = null;
}

export function getActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor;
}
