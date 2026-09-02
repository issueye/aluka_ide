import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ArrowDownToLine,
  Blocks,
  Check,
  Download,
  FolderDown,
  Loader2,
  Puzzle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../store";
import {
  installVsix,
  listExtensions,
  pickVsixDialog,
  uninstallExtension,
  type InstalledExtension,
} from "../tauri";
import {
  parseManifest,
  extensionId,
  type ExtensionManifest,
} from "../extHost/manifest";
import {
  getDisabledExtensions,
  loadExtensions,
  setExtensionDisabled,
} from "../extHost/registry";
import { useNotificationStore } from "../notificationStore";
import {
  useMarketplaceStore,
  type MarketplaceExtension,
} from "../marketplaceStore";

function extDisplayName(m: ExtensionManifest): string {
  return m.displayName ?? m.name;
}

function formatDownloadCount(num?: number): string {
  if (!num) return "";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return `${num}`;
}

/** 扩展图标组件，支持在线图片与加载失败降级 */
function ExtensionIcon({
  url,
  displayName,
}: {
  url?: string;
  displayName: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (url && !imgError) {
    return (
      <img
        src={url}
        alt={displayName}
        onError={() => setImgError(true)}
        className="h-10 w-10 shrink-0 rounded object-contain bg-[var(--aluka-input-bg)] p-1"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--aluka-input-bg)]">
      <Puzzle size={20} className="text-[var(--aluka-text-dim)]" />
    </div>
  );
}

export default function ExtensionsView() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const [installedList, setInstalledList] = useState<
    Array<InstalledExtension & { manifest: ExtensionManifest }>
  >([]);
  const [busyLocal, setBusyLocal] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const show = useNotificationStore((s) => s.show);

  const {
    query,
    results,
    popular,
    loading: marketLoading,
    error: marketError,
    installingIds,
    activeTab,
    setQuery,
    setActiveTab,
    search,
    loadPopular,
    install: installFromMarket,
  } = useMarketplaceStore();

  // 刷新本地已安装列表
  const refreshInstalled = useCallback(async () => {
    setDisabled(getDisabledExtensions());
    try {
      const installed = await listExtensions(workspaceRoot);
      const parsed = installed
        .map((inst) => ({ ...inst, manifest: parseManifest(inst.manifest) }))
        .filter(
          (x): x is InstalledExtension & { manifest: ExtensionManifest } =>
            x.manifest !== null,
        );
      setInstalledList(parsed);
      void loadExtensions();
    } catch (e) {
      console.error("加载已安装扩展失败:", e);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refreshInstalled();
    void loadPopular();
  }, [refreshInstalled, loadPopular]);

  // 已安装扩展 ID 集合（小写 publisher.name）
  const installedIdMap = useMemo(() => {
    const map = new Map<string, InstalledExtension>();
    for (const item of installedList) {
      const id = extensionId(item.manifest).toLowerCase();
      map.set(id, item);
    }
    return map;
  }, [installedList]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        void search(query);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, search]);

  // 本地 VSIX 安装
  const handleInstallLocalVsix = async () => {
    setBusyLocal(true);
    try {
      const vsixPath = await pickVsixDialog();
      if (!vsixPath) return;
      const r = await installVsix(vsixPath);
      const m = parseManifest(r.manifest);
      show(
        "info",
        `扩展 ${m ? extDisplayName(m) : ""} 安装成功，重开应用后完全生效`,
      );
      await refreshInstalled();
    } catch (e) {
      show("error", `安装失败: ${String(e)}`);
    } finally {
      setBusyLocal(false);
    }
  };

  // 在线市场安装
  const handleMarketplaceInstall = async (ext: MarketplaceExtension) => {
    try {
      await installFromMarket(ext);
      show("info", `扩展 ${ext.displayName ?? ext.name} 安装成功！`);
      await refreshInstalled();
    } catch (e) {
      show("error", `安装失败: ${String(e)}`);
    }
  };

  // 卸载
  const handleUninstall = async (dir: string, name: string) => {
    try {
      await uninstallExtension(dir);
      show("info", `扩展 ${name} 已卸载`);
      await refreshInstalled();
    } catch (e) {
      show("error", `卸载失败: ${String(e)}`);
    }
  };

  // 启用/禁用
  const handleToggleDisabled = (id: string, next: boolean) => {
    setExtensionDisabled(id, next);
    setDisabled(getDisabledExtensions());
    show("info", next ? "已禁用，重开应用后生效" : "已启用，重开应用后生效");
  };

  const isSearching = Boolean(query.trim());
  const displayMarketList = isSearching ? results : popular;

  return (
    <div className="flex h-full flex-col text-[12px]">
      {/* 顶部搜索框 */}
      <div className="border-b border-[var(--aluka-border)] p-2">
        <div className="relative flex items-center">
          <Search
            size={13}
            className="absolute left-2 text-[var(--aluka-text-dim)]"
          />
          <input
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (val.trim() && activeTab !== "marketplace") {
                setActiveTab("marketplace");
              }
            }}
            placeholder="搜索开源市场扩展 (Open VSX)..."
            className="w-full rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] py-1.5 pl-7 pr-7 font-mono text-[12px] text-[var(--aluka-text)] placeholder-[var(--aluka-text-dim)] outline-none focus:border-[#007acc]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* 标签栏与操作栏 */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex rounded bg-[var(--aluka-input-bg)] p-0.5 text-[11px]">
            <button
              onClick={() => setActiveTab("installed")}
              className={`rounded px-2 py-0.5 ${
                activeTab === "installed"
                  ? "bg-[var(--aluka-active)] font-medium text-[var(--aluka-text)] shadow-sm"
                  : "text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
              }`}
            >
              已安装 ({installedList.length})
            </button>
            <button
              onClick={() => setActiveTab("marketplace")}
              className={`rounded px-2 py-0.5 ${
                activeTab === "marketplace"
                  ? "bg-[var(--aluka-active)] font-medium text-[var(--aluka-text)] shadow-sm"
                  : "text-[var(--aluka-text-dim)] hover:text-[var(--aluka-text)]"
              }`}
            >
              插件市场
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              title="从本地 .VSIX 安装"
              onClick={() => void handleInstallLocalVsix()}
              disabled={busyLocal}
              className="flex h-6 items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-2 text-[11px] text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
            >
              <FolderDown size={12} />
              <span>{busyLocal ? "安装中…" : "VSIX"}</span>
            </button>
            <button
              title="刷新已安装列表"
              onClick={() => void refreshInstalled()}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* 已安装选项卡 */}
        {activeTab === "installed" && (
          <div>
            {installedList.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-[var(--aluka-text-dim)]">
                <Blocks size={36} strokeWidth={1} />
                <p className="text-[12px]">尚未安装扩展</p>
                <button
                  onClick={() => setActiveTab("marketplace")}
                  className="mt-1 rounded bg-[var(--aluka-btn-bg)] px-3 py-1 text-[11px] text-white hover:bg-[var(--aluka-btn-hover)]"
                >
                  去开源插件市场看看
                </button>
              </div>
            ) : (
              installedList.map(({ dir, manifest: m, origin }) => {
                const id = extensionId(m);
                const isDisabled = disabled.has(id);
                return (
                  <div
                    key={dir}
                    className="mb-1 flex gap-2.5 rounded border border-transparent p-2 hover:border-[var(--aluka-border)] hover:bg-[var(--aluka-hover)]"
                  >
                    <ExtensionIcon displayName={extDisplayName(m)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="truncate text-[13px] font-medium text-[var(--aluka-text)]">
                          {extDisplayName(m)}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
                          {m.version}
                        </span>
                        {origin === "workspace" && (
                          <span className="shrink-0 rounded bg-[var(--aluka-input-bg)] px-1 text-[10px] text-[var(--aluka-text-dim)]">
                            工作区
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-[var(--aluka-text-dim)]">
                        {m.description || m.publisher}
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <button
                          onClick={() => handleToggleDisabled(id, !isDisabled)}
                          className="text-[11px] text-[#3794ff] hover:underline"
                        >
                          {isDisabled ? "启用" : "禁用"}
                        </button>
                        {origin === "global" && (
                          <button
                            title="卸载"
                            onClick={() =>
                              void handleUninstall(dir, extDisplayName(m))
                            }
                            className="flex items-center gap-0.5 text-[11px] text-[#f48771] hover:underline"
                          >
                            <Trash2 size={11} />
                            <span>卸载</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 插件市场选项卡 */}
        {activeTab === "marketplace" && (
          <div>
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-[var(--aluka-text-dim)]">
              <span>
                {isSearching ? `搜索 "${query}" 的结果` : "热门开源扩展推荐"}
              </span>
              <span className="font-mono text-[10px]">Open VSX</span>
            </div>

            {marketLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-[var(--aluka-text-dim)]">
                <Loader2 size={16} className="animate-spin" />
                <span>正在查询开源市场…</span>
              </div>
            )}

            {marketError && !marketLoading && (
              <div className="rounded border border-red-500/20 bg-red-500/10 p-3 text-center text-[11px] text-red-400">
                <p>查询开源市场出错</p>
                <p className="mt-1 text-[10px] opacity-80">{marketError}</p>
                <button
                  onClick={() => (isSearching ? void search(query) : void loadPopular())}
                  className="mt-2 rounded bg-red-500/20 px-2 py-0.5 text-[10px] hover:bg-red-500/30"
                >
                  重试
                </button>
              </div>
            )}

            {!marketLoading && !marketError && displayMarketList.length === 0 && (
              <div className="py-8 text-center text-[var(--aluka-text-dim)]">
                <p className="text-[12px]">未找到相关扩展</p>
                <p className="mt-1 text-[11px]">可尝试更换关键词搜索（如 theme, dracula, rust）</p>
              </div>
            )}

            {!marketLoading &&
              displayMarketList.map((ext) => {
                const isInstalling = installingIds.has(ext.id);
                const installedItem = installedIdMap.get(ext.id);
                const dlCountFormatted = formatDownloadCount(ext.downloadCount);

                return (
                  <div
                    key={ext.id}
                    className="mb-1.5 flex gap-2.5 rounded border border-transparent p-2 hover:border-[var(--aluka-border)] hover:bg-[var(--aluka-hover)]"
                  >
                    <ExtensionIcon
                      url={ext.iconUrl}
                      displayName={ext.displayName || ext.name}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <span
                          className="truncate text-[13px] font-medium text-[var(--aluka-text)]"
                          title={ext.displayName || ext.name}
                        >
                          {ext.displayName || ext.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--aluka-text-dim)]">
                          v{ext.version}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-[var(--aluka-text-dim)]">
                        <span className="truncate">{ext.namespace}</span>
                        {dlCountFormatted && (
                          <span className="flex items-center gap-0.5 text-[10px]">
                            <ArrowDownToLine size={10} />
                            {dlCountFormatted}
                          </span>
                        )}
                      </div>

                      {ext.description && (
                        <div
                          className="mt-0.5 line-clamp-2 text-[11px] text-[var(--aluka-text-dim)]"
                          title={ext.description}
                        >
                          {ext.description}
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-2">
                        {isInstalling ? (
                          <button
                            disabled
                            className="flex items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-2 py-0.5 text-[11px] text-white opacity-70"
                          >
                            <Loader2 size={11} className="animate-spin" />
                            <span>安装中…</span>
                          </button>
                        ) : installedItem ? (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 rounded bg-[#89d185]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#89d185]">
                              <Check size={11} />
                              已安装
                            </span>
                            {installedItem.origin === "global" && (
                              <button
                                onClick={() =>
                                  void handleUninstall(
                                    installedItem.dir,
                                    ext.displayName || ext.name,
                                  )
                                }
                                className="text-[11px] text-[#f48771] hover:underline"
                              >
                                卸载
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => void handleMarketplaceInstall(ext)}
                            className="flex items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-[var(--aluka-btn-hover)]"
                          >
                            <Download size={11} />
                            <span>安装</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
