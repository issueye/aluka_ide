import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "../markdown";
import { getContent, subscribeContent } from "../editorStore";
import { showInfo } from "../notificationStore";

/**
 * Markdown 预览：读取 Monaco model 当前内容并渲染为 HTML。
 * 编辑态键入后 model 变更经订阅实时刷新；外链不直接跳转
 * （零依赖、无 opener 插件）：点击复制链接地址并 toast 提示。
 */
export default function MarkdownPreview({ path }: { path: string }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setVersion((v) => v + 1);
    return subscribeContent(path, () => setVersion((v) => v + 1));
  }, [path]);

  const html = useMemo(() => {
    void version;
    try {
      return renderMarkdown(getContent(path));
    } catch {
      return "<p>预览渲染失败</p>";
    }
  }, [path, version]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.("a.md-link");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("title") ?? "";
    if (!href) return;
    void navigator.clipboard
      ?.writeText(href)
      .then(() => showInfo(`已复制链接：${href}`))
      .catch(() => showInfo(`链接：${href}`));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--aluka-bg)]">
      <article
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
        className="md-body mx-auto max-w-[860px] px-8 py-6"
      />
    </div>
  );
}
