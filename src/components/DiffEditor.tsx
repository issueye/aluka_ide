import { useEffect, useRef } from "react";
import monaco, { languageOf } from "../monaco-setup";
import { useSettingsStore } from "../settingsStore";

interface DiffEditorProps {
  path: string;
  original: string;
  modified: string;
}

export default function DiffEditor({ path, original, modified }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const lang = languageOf(path.replace(/^diff:/, ""));
    const originalModel = monaco.editor.createModel(original, lang);
    const modifiedModel = monaco.editor.createModel(modified, lang);

    const diffEditor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      fontSize: 13,
      fontFamily: "Consolas, 'Cascadia Code', 'Fira Code', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: theme === "light-plus" ? "vs" : "vs-dark",
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    diffEditorRef.current = diffEditor;

    const resizeObserver = new ResizeObserver(() => {
      diffEditor.layout();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      diffEditorRef.current = null;
    };
  }, [path, original, modified]);

  // 主题同步
  useEffect(() => {
    if (diffEditorRef.current) {
      monaco.editor.setTheme(theme === "light-plus" ? "vs" : "vs-dark");
    }
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
