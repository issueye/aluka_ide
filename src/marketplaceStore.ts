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
  activeTab: "installed" | "marketplace";
  setQuery: (q: string) => void;
  setActiveTab: (tab: "installed" | "marketplace") => void;
  search: (keyword?: string) => Promise<void>;
  loadPopular: () => Promise<void>;
  install: (ext: MarketplaceExtension) => Promise<boolean>;
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
      // 1. 在线下载 VSIX
      const res = await fetch(ext.downloadUrl);
      if (!res.ok) {
        throw new Error(`下载 VSIX 失败: ${res.status} ${res.statusText}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // 2. 传递给 Rust 后端安全解包安装
      await installVsixBytes(bytes);

      // 3. 重新加载扩展注册表以即时激活扩展（主题、片段等）
      await loadExtensions();
      return true;
    } catch (e) {
      console.error(`安装插件 ${ext.displayName ?? ext.name} 失败:`, e);
      throw e;
    } finally {
      const finishInstalling = new Set(get().installingIds);
      finishInstalling.delete(id);
      set({ installingIds: finishInstalling });
    }
  },
}));
