import { useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2, Trash2 } from "lucide-react";
import { readExtensionFile, readExtensionFileBytes } from "../tauri";
import type { ExtensionManifest } from "../extHost/manifest";
import type { MarketplaceExtension } from "../marketplaceStore";
import { useMarketplaceStore } from "../marketplaceStore";
import MarkdownBody from "./MarkdownBody";

/**
 * 扩展详情：头部（图标/名称/版本/发布者/来源 + 操作）+ README 渲染。
 * 已安装：读本地 README 文件；市场：经 Open VSX 在线拉取。
 * README 引用的扩展目录内相对图片经 read_extension_file_bytes 转 base64 内联
 * （零外联，符合 NFR-03）；读不到的保持占位。
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
  kind: "installed";
  dir: string;
  origin: "global" | "workspace";
  manifest: ExtensionManifest;
  disabled: boolean;
}

export interface MarketDetail {
  kind: "market";
  ext: MarketplaceExtension;
}

export type ExtensionDetailTarget = InstalledDetail | MarketDetail;

export default function ExtensionDetail({
  detail,
  icon,
  onBack,
  onToggleDisabled,
  onUninstall,
  onInstall,
  installing,
  installed,
  installProgress,
  outdated,
  latestVersion,
}: {
  detail: ExtensionDetailTarget;
  icon: React.ReactNode;
  onBack: () => void;
  onToggleDisabled?: () => void;
  onUninstall?: () => void;
  onInstall?: () => void;
  installing?: boolean;
  installed?: boolean;
  /** 在线安装下载进度（0~100；未定义时不显示百分比） */
  installProgress?: number;
  /** 市场扩展：本地版本旧于市场版本 */
  outdated?: boolean;
  /** 市场最新版本号（更新按钮旁展示 v旧 → v新） */
  latestVersion?: string;
}) {
  const isInstalled = detail.kind === "installed";
  const title = isInstalled
    ? (detail.manifest.displayName ?? detail.manifest.name)
    : (detail.ext.displayName || detail.ext.name);
  const version = isInstalled ? detail.manifest.version : detail.ext.version;
  const subtitle = isInstalled
    ? `${detail.manifest.publisher}${detail.origin === "workspace" ? " · 工作区" : ""}${detail.disabled ? " · 已禁用" : ""}`
    : `${detail.ext.namespace} · Open VSX`;
  const description = isInstalled
    ? detail.manifest.description
    : detail.ext.description;
  const fetchReadme = useMarketplaceStore((s) => s.fetchReadme);
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReadme(null);
    void (async () => {
      let text: string | null = null;
      if (isInstalled) {
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
      } else {
        text = await fetchReadme(detail.ext);
      }
      if (!cancelled) {
        if (text) setReadme(text);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // detail 切换（不同扩展）时重拉；fetchReadme 为 store 稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInstalled ? (detail as InstalledDetail).dir : (detail as MarketDetail).ext.id]);

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
            {onInstall ? (
              <>
                {outdated && !isInstalled && (
                  <span className="text-[11px] text-[var(--aluka-text-dim)]">
                    v{version} → v{latestVersion}
                  </span>
                )}
                <button
                  onClick={onInstall}
                  disabled={installing}
                  className="flex items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
                >
                  {installing ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Download size={11} />
                  )}
                  <span>
                    {installing
                      ? installProgress != null
                        ? `安装中 ${installProgress}%`
                        : "安装中…"
                      : outdated
                        ? "更新"
                        : "安装"}
                  </span>
                </button>
              </>
            ) : isInstalled ? (
              <>
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
              </>
            ) : installed ? (
              <span className="text-[11px] text-[#89d185]">已安装</span>
            ) : null}
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
