import { useCallback, useEffect, useRef, useState } from "react";
import monaco, { languageLabel, languageOf } from "../monaco-setup";
import {
  getModel,
  getDraft,
  setDraft,
  markDirty,
  useEditorStore,
  useRevealStore,
  viewStates,
} from "../editorStore";
import { useStatusStore } from "../statusStore";
import { useSettingsStore } from "../settingsStore";
import { monacoThemeName } from "../theme";

/**
 * Monaco 已启用（M4 修复：移除 StrictMode 后渲染恢复，双挂载与单例冲突）。
 * 若修复成功保持 true（语法高亮）；若仍失败改回 false 用 textarea 降级。
 */
const useMonaco = true;

interface Props {
  activePath: string | null;
}

/**
 * Monaco 编辑器（callback ref 挂载）。
 * 关键点：editor 的创建与 model 同步共用同一个 `syncModel` 函数——
 * 渲染期调用（处理标签切换）+ ref callback 创建编辑器后立即调用一次
 * （处理初始挂载：React 中 ref callback 在 render 之后执行，若不补这次
 * 同步，首个打开的文件会因错过渲染期窗口而空白）。
 * 组件卸载（如关闭全部标签回到欢迎页）时必须销毁 editor，
 * 否则 remount 后 editorRef 仍指向挂在已脱离 DOM 上的旧实例 → 空白。
 */
export default function CodeEditor({ activePath }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const cursorHandlerRef = useRef<monaco.IDisposable | null>(null);
  const [monacoFailed, setMonacoFailed] = useState(!useMonaco);
  // ref callback 只建一次（useCallback []），经此 ref 读取最新的同步闭包
  const syncRef = useRef<() => void>(() => {});

  // 切换 model / 恢复视图态 / 联动状态栏（幂等：path 未变则直接返回）
  const syncModel = () => {
    const editor = editorRef.current;
    if (!editor || prevPathRef.current === activePath) return;
    if (prevPathRef.current) {
      const st = editor.saveViewState();
      if (st) viewStates.set(prevPathRef.current, st);
    }
    prevPathRef.current = activePath;
    const model = activePath ? getModel(activePath) : null;
    editor.setModel(model);
    if (activePath && model) {
      const viewState = viewStates.get(activePath);
      if (viewState) editor.restoreViewState(viewState);
      editor.focus();
      const tab = useEditorStore
        .getState()
        .tabs.find((t) => t.path === activePath);
      editor.updateOptions({ readOnly: tab?.readOnly ?? false });
      useStatusStore.getState().update({
        line: 1,
        col: 1,
        eol: model.getEOL() === "\n" ? "LF" : "CRLF",
        language: languageLabel(model.getLanguageId() || languageOf(activePath)),
      });
    }
  };
  syncRef.current = syncModel;

  // 渲染期同步：编辑器已存在时的标签切换路径
  syncModel();

  // ref callback：元素挂载/卸载时同步调用
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      // 卸载：销毁 editor 与订阅，重置 refs，保证 remount 得到全新实例
      cursorHandlerRef.current?.dispose();
      cursorHandlerRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      prevPathRef.current = null;
      return;
    }
    if (editorRef.current) return;
    try {
      editorRef.current = monaco.editor.create(el, {
        theme: monacoThemeName(useSettingsStore.getState().theme),
        automaticLayout: true,
        fontSize: useSettingsStore.getState().fontSize,
        fontFamily: "Consolas, 'Cascadia Code', monospace",
        minimap: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        renderLineHighlight: "all",
        scrollBeyondLastLine: true,
      });
      const ed = editorRef.current;
      cursorHandlerRef.current = ed.onDidChangeCursorPosition((e) => {
        const model = ed.getModel();
        useStatusStore.getState().update({
          line: e.position.lineNumber,
          col: e.position.column,
          eol: model && model.getEOL() === "\n" ? "LF" : "CRLF",
        });
      });
      // 初始挂载时渲染期同步被跳过（editor 尚不存在），此处立即补一次
      syncRef.current();
    } catch (e) {
      setMonacoFailed(true); // 降级到 textarea，保证编辑保存闭环
    }
  }, []);

  // 字号联动：主题切换无需处理（theme.ts 里 monaco.editor.setTheme 全局生效）
  const fontSize = useSettingsStore((s) => s.fontSize);
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  // 行定位联动（搜索结果点击 → openFile → 定位）：seq 驱动，model 就绪后执行
  const revealSeq = useRevealStore((s) => s.seq);
  useEffect(() => {
    const { path, line } = useRevealStore.getState();
    if (revealSeq === 0 || !path || path !== activePath) return;
    const ed = editorRef.current;
    if (!ed || !ed.getModel()) return;
    ed.setSelection({
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: 1,
    });
    ed.revealLineInCenter(line);
    ed.focus();
  }, [revealSeq, activePath]);

  // 降级渲染：纯 textarea（Monaco 未启用或创建失败）
  if (monacoFailed) {
    return (
      <textarea
        key={activePath ?? "empty"}
        spellCheck={false}
        defaultValue={activePath ? getDraft(activePath) : ""}
        onChange={(e) => {
          if (!activePath) return;
          setDraft(activePath, e.target.value);
          markDirty(activePath, true);
        }}
        className="min-h-0 flex-1 resize-none bg-[var(--aluka-bg)] p-2 font-mono text-[14px] leading-5 text-[var(--aluka-text)] outline-none"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={attachContainer} className="min-h-0 flex-1" data-monaco-container="true" />
    </div>
  );
}
