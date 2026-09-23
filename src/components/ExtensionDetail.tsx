import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { readExtensionFile, readExtensionFileBytes } from "../tauri";
import type { ExtensionManifest } from "../extHost/manifest";
import MarkdownBody from "./MarkdownBody";

/**
 * 扩展详情：头部（名称/版本/发布者/来源 + 操作）+ README 渲染。
 * 仅处理已安装扩展：README 取自本地扩展目录，相对图片经 read_extension_file_bytes
 * 转 base64 内联 —— 全程零网络请求（NFR-03/06：无外联、离线可用）。
 */

const README_CANDIDATES = ["README.md", "Readme.md", "readme.md", "README.MD", "README.txt"];

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const IMAGE_LINK_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isRelativeImagePath(href: string): boolean {
  if (/^(https?:|data:|mailto:|#)/i.test(href)) return false;
  const clean = href.split(/[?#]/)[0] ?? "";
  const ext = clean.includes(".") ? (clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() ?? "") : "";
  return ext in IMAGE_EXT_MIME;
}

function imageMime(href: string): string {
  const clean = href.split(/[?#]/)[0] ?? "";
  const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
  return IMAGE_EXT_MIME[ext] ?? "application/octet-stream";
}

/** 字节数组 → base64（分块拼接避免 apply 参数上限） */
function toBase64(bytes: number[]): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 把 README 里指向扩展目录内的相对图片替换为 data-URL（失败保持原样，渲染为占位） */
async function inlineLocalImages(dir: string, md: string): Promise<string> {
  const matches = [...md.matchAll(IMAGE_LINK_RE)];
  if (matches.length === 0) return md;
  let out = md;
  for (const m of matches) {
    const href = m[2] ?? "";
    if (!isRelativeImagePath(href)) continue;
    try {
      const bytes = await readExtensionFileBytes(dir, href.replace(/^\.\//, ""));
      const dataUrl = `data:${imageMime(href)};base64,${toBase64(bytes)}`;
      out = out.replace(m[0], `![${m[1] ?? ""}](${dataUrl})`);
    } catch {
      continue;
    }
  }
  return out;
}

export interface InstalledDetail {
  dir: string;
  origin: "global" | "workspace";
  manifest: ExtensionManifest;
  disabled: boolean;
}

export default function ExtensionDetail({
  detail,
  icon,
  onBack,
  onToggleDisabled,
  onUninstall,
}: {
  detail: InstalledDetail;
  icon: React.ReactNode;
  onBack: () => void;
  onToggleDisabled?: () => void;
  onUninstall?: () => void;
}) {
  const title = detail.manifest.displayName ?? detail.manifest.name;
  const version = detail.manifest.version;
  const subtitle = `${detail.manifest.publisher}${detail.origin === "workspace" ? " · 工作区" : ""}${detail.disabled ? " · 已禁用" : ""}`;
  const description = detail.manifest.description;
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReadme(null);
    void (async () => {
      let text: string | null = null;
      for (const name of README_CANDIDATES) {
        try {
          const t = await readExtensionFile(detail.dir, name);
          if (t.trim()) {
            text = await inlineLocalImages(detail.dir, t);
            break;
          }
        } catch {
          continue;
        }
      }
      if (!cancelled) {
        if (text) setReadme(text);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.dir]);

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={onBack}
        className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[11px] text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
      >
        <ArrowLeft size={13} />
        <span>返回扩展列表</span>
      </button>
      <div className="flex shrink-0 gap-2.5 border-b border-[var(--aluka-border)] p-2">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[14px] font-medium text-[var(--aluka-text)]">
              {title}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
              {version}
            </span>
          </div>
          <div className="truncate text-[11px] text-[var(--aluka-text-dim)]">
            {subtitle}
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              onClick={onToggleDisabled}
              className="text-[11px] text-[#3794ff] hover:underline"
            >
              {detail.disabled ? "启用" : "禁用"}
            </button>
            {detail.origin === "global" && (
              <button
                onClick={onUninstall}
                className="flex items-center gap-0.5 text-[11px] text-[#f48771] hover:underline"
              >
                <Trash2 size={11} />
                <span>卸载</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[var(--aluka-text-dim)]">
            <Loader2 size={14} className="animate-spin" />
            <span>正在读取 README…</span>
          </div>
        ) : readme ? (
          <MarkdownBody source={readme} />
        ) : (
          <p className="px-1 py-4 text-center text-[11px] text-[var(--aluka-text-dim)]">
            {description ?? "该扩展未提供 README"}
          </p>
        )}
      </div>
    </div>
  );
}
