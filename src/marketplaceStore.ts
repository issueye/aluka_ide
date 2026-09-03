import { create } from "zustand";
import { installVsixBytes } from "./tauri";
import { loadExtensions } from "./extHost/registry";

export interface MarketplaceExtension {
  id: string; // namespace.name
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  iconUrl?: string;
  downloadUrl: string;
  /** 详情 API 返回的 README 直链（搜索接口不带，按需 fetchReadme 补齐） */
  readmeUrl?: string;
  downloadCount?: number;
  averageRating?: number;
  reviewCount?: number;
}

interface RawOpenVsxExtension {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  files?: {
    icon?: string;
    download?: string;
  };
  downloadCount?: number;
  averageRating?: number;
  reviewCount?: number;
}

interface OpenVsxSearchResponse {
  totalSize: number;
  offset: number;
  extensions: RawOpenVsxExtension[];
}

interface MarketplaceStore {
  query: string;
  results: MarketplaceExtension[];
  popular: MarketplaceExtension[];
  loading: boolean;
  error: string | null;
  installingIds: Set<string>;
  /** 在线安装下载进度（0~100，按扩展 id 记录） */
  downloadProgress: Record<string, number>;
  activeTab: "installed" | "marketplace";
  setQuery: (q: string) => void;
  setActiveTab: (tab: "installed" | "marketplace") => void;
  search: (keyword?: string) => Promise<void>;
  loadPopular: () => Promise<void>;
  install: (ext: MarketplaceExtension) => Promise<boolean>;
  /** 按需拉取市场扩展 README 文本（详情页用；失败返回 null） */
  fetchReadme: (ext: MarketplaceExtension) => Promise<string | null>;
}

/** 语义化版本比较：latest 是否严格新于 installed（数字段逐位比较，忽略预发布后缀细节） */
export function isNewerVersion(latest: string, installed: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(latest);
  const b = parse(installed);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai > bi;
  }
  return false;
}

const OPEN_VSX_API = "https://open-vsx.org/api";

function mapRawExtension(raw: RawOpenVsxExtension): MarketplaceExtension | null {
  const downloadUrl = raw.files?.download;
  if (!downloadUrl) return null;

  return {
    id: `${raw.namespace}.${raw.name}`.toLowerCase(),
    namespace: raw.namespace,
    name: raw.name,
    version: raw.version,
    displayName: raw.displayName || raw.name,
    description: raw.description,
    iconUrl: raw.files?.icon,
    downloadUrl,
    downloadCount: raw.downloadCount,
    averageRating: raw.averageRating,
    reviewCount: raw.reviewCount,
  };
}

export const useMarketplaceStore = create<MarketplaceStore>((set, get) => ({
  query: "",
  results: [],
  popular: [],
  loading: false,
  error: null,
  installingIds: new Set<string>(),
  downloadProgress: {},
  activeTab: "installed",

  setQuery: (query) => set({ query }),
  setActiveTab: (activeTab) => set({ activeTab }),

  search: async (keyword) => {
    const q = (keyword !== undefined ? keyword : get().query).trim();
    if (!q) {
      set({ results: [], error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const url = `${OPEN_VSX_API}/-/search?query=${encodeURIComponent(q)}&offset=0&size=30&sortBy=downloadCount`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`市场请求失败: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as OpenVsxSearchResponse;
      const exts = (data.extensions || [])
        .map(mapRawExtension)
        .filter((x): x is MarketplaceExtension => x !== null);

      set({ results: exts, loading: false });
    } catch (e) {
      console.error("搜索开源插件市场异常:", e);
      set({ error: String(e), loading: false, results: [] });
    }
  },

  loadPopular: async () => {
    if (get().popular.length > 0) return;
    set({ loading: true, error: null });
    try {
      const url = `${OPEN_VSX_API}/-/search?query=theme&offset=0&size=20&sortBy=downloadCount`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`获取热门推荐失败: ${res.status}`);
      }
      const data = (await res.json()) as OpenVsxSearchResponse;
      const exts = (data.extensions || [])
        .map(mapRawExtension)
        .filter((x): x is MarketplaceExtension => x !== null);

      set({ popular: exts, loading: false });
    } catch (e) {
      console.error("加载推荐插件失败:", e);
      set({ loading: false });
    }
  },

  install: async (ext: MarketplaceExtension) => {
    const id = ext.id;
    const nextInstalling = new Set(get().installingIds);
    nextInstalling.add(id);
    set({ installingIds: nextInstalling });

    try {
      // 1. 在线下载 VSIX（流式读取，记录下载进度；content-length 缺失时只显示已收字节数不显示百分比）
      const res = await fetch(ext.downloadUrl);
      if (!res.ok) {
        throw new Error(`下载 VSIX 失败: ${res.status} ${res.statusText}`);
      }
      const total = Number(res.headers.get("content-length") ?? 0);
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            set((s) => ({
              downloadProgress: {
                ...s.downloadProgress,
                [id]: Math.min(99, Math.round((received / total) * 100)),
              },
            }));
          }
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        received = buf.length;
      }
      // 合并分块
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }

      // 2. 传递给 Rust 后端安全解包安装（原始 IPC 载荷）
      await installVsixBytes(bytes);
      set((s) => ({ downloadProgress: { ...s.downloadProgress, [id]: 100 } }));

      // 3. 重新加载扩展注册表以即时激活扩展（主题、片段等）
      await loadExtensions();
      return true;
    } catch (e) {
      console.error(`安装插件 ${ext.displayName ?? ext.name} 失败:`, e);
      throw e;
    } finally {
      const finishInstalling = new Set(get().installingIds);
      finishInstalling.delete(id);
      set((s) => {
        const dp = { ...s.downloadProgress };
        delete dp[id];
        return { installingIds: finishInstalling, downloadProgress: dp };
      });
    }
  },

  fetchReadme: async (ext) => {
    try {
      // 搜索接口不带 files.readme：调详情接口取直链再拉文本
      const detailRes = await fetch(
        `${OPEN_VSX_API}/${encodeURIComponent(ext.namespace)}/${encodeURIComponent(ext.name)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!detailRes.ok) return null;
      const detail = (await detailRes.json()) as {
        files?: { readme?: string };
        readme?: string;
      };
      const url = detail.files?.readme ?? detail.readme;
      if (!url) return null;
      const textRes = await fetch(url, { headers: { Accept: "text/plain,text/markdown,*/*" } });
      if (!textRes.ok) return null;
      const text = await textRes.text();
      return text.trim() ? text : null;
    } catch (e) {
      console.error("拉取市场扩展 README 失败:", e);
      return null;
    }
  },
}));
