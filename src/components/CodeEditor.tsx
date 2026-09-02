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
import { setActiveEditor, clearActiveEditor } from "../activeEditor";
import { monacoThemeName } from "../theme";

/**
 * Monaco 已启用（M4 修复：移除 StrictMode 后渲染恢复，双挂载与单例冲突）。
 * 若修复成功保持 true（语法高亮）；若仍失败改回 false 用 textarea 降级。
 */
const useMonaco = true;

interface Props {
  groupId: string;
  activePath: string | null;
}

/**
 * Monaco 编辑器（callback ref 挂载）。
 * 关键点：editor 的创建与 model 同步共用同一个 `syncModel` 函数——
 * 渲染期调用（处理标签切换）+ ref callback 创建编辑器后立即调用一次。
 * 多组分屏下按 `${groupId}:${path}` 隔离保存各自的视图状态（光标与滚动）。
 */
export default function CodeEditor({ groupId, activePath }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const cursorHandlerRef = useRef<monaco.IDisposable | null>(null);
  const focusHandlerRef = useRef<monaco.IDisposable | null>(null);
  const [monacoFailed, setMonacoFailed] = useState(!useMonaco);
  // ref callback 只建一次（useCallback []），经此 ref 读取最新的同步闭包
  const syncRef = useRef<() => void>(() => {});

  const stateKey = (p: string) => `${groupId}:${p}`;

  // 切换 model / 恢复视图态 / 联动状态栏（幂等：path 未变则直接返回）
  const syncModel = () => {
    const editor = editorRef.current;
    if (!editor || prevPathRef.current === activePath) return;
    if (prevPathRef.current) {
      const st = editor.saveViewState();
      if (st) viewStates.set(stateKey(prevPathRef.current), st);
    }
    prevPathRef.current = activePath;
    const model = activePath ? getModel(activePath) : null;
    editor.setModel(model);
    if (activePath && model) {
      const viewState = viewStates.get(stateKey(activePath)) ?? viewStates.get(activePath);
      if (viewState) editor.restoreViewState(viewState);
      const isCurrentActiveGroup = useEditorStore.getState().activeGroupId === groupId;
      if (isCurrentActiveGroup) {
        editor.focus();
      }
      const group = useEditorStore.getState().groups.find((g) => g.id === groupId);
      const tab = group?.tabs.find((t) => t.path === activePath);
      editor.updateOptions({ readOnly: tab?.readOnly ?? false });
      if (isCurrentActiveGroup) {
        useStatusStore.getState().update({
          line: 1,
          col: 1,
          eol: model.getEOL() === "\n" ? "LF" : "CRLF",
          language: languageLabel(model.getLanguageId() || languageOf(activePath)),
        });
      }
    }
  };
  syncRef.current = syncModel;

  // 渲染期同步：编辑器已存在时的标签切换路径
  syncModel();

  // ref callback：元素挂载/卸载时同步调用
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      // 卸载：销毁 editor 与订阅，重置 refs，保证 remount 得到全新实例
      const ed = editorRef.current;
      if (ed) clearActiveEditor(ed);
      cursorHandlerRef.current?.dispose();
      cursorHandlerRef.current = null;
      focusHandlerRef.current?.dispose();
      focusHandlerRef.current = null;
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
      focusHandlerRef.current = ed.onDidFocusEditorWidget(() => {
        // 登记为全局活动编辑器：菜单「编辑/选择」命令的执行目标
        setActiveEditor(ed);
        useEditorStore.getState().setActiveGroup(groupId);
        const model = ed.getModel();
        const pos = ed.getPosition();
        if (model && pos) {
          useStatusStore.getState().update({
            line: pos.lineNumber,
            col: pos.column,
            eol: model.getEOL() === "\n" ? "LF" : "CRLF",
            language: languageLabel(model.getLanguageId() || (activePath ? languageOf(activePath) : "")),
          });
        }
      });
      cursorHandlerRef.current = ed.onDidChangeCursorPosition((e) => {
        if (useEditorStore.getState().activeGroupId !== groupId) return;
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
  }, [groupId, activePath]);

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
    const isCurrentActiveGroup = useEditorStore.getState().activeGroupId === groupId;
    if (!isCurrentActiveGroup) return;
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
  }, [revealSeq, activePath, groupId]);

  // 降级渲染：纯 textarea（Monaco 未启用或创建失败）
  if (monacoFailed) {
    return (
      <textarea
        key={activePath ?? "empty"}
        spellCheck={false}
        defaultValue={activePath ? getDraft(activePath) : ""}
        onFocus={() => useEditorStore.getState().setActiveGroup(groupId)}
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

