import { useMemo } from "react";
import { renderMarkdown } from "../markdown";
import { showInfo } from "../notificationStore";

/**
 * Markdown 静态渲染（扩展 README 等非编辑器内容用）。
 * 安全与交互语义与 MarkdownPreview 一致：外链点击复制地址并 toast，不直接跳转。
 */
export default function MarkdownBody({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return renderMarkdown(source);
    } catch {
      return "<p>预览渲染失败</p>";
    }
  }, [source]);

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
    <article
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
      className="md-body px-1 py-2"
    />
  );
}
