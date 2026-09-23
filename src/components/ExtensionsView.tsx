import { useCallback, useEffect, useState } from "react";
import {
  Blocks,
  FolderDown,
  Puzzle,
  RefreshCw,
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
  unloadExtension,
} from "../extHost/registry";
import { useNotificationStore } from "../notificationStore";
import ExtensionDetail from "./ExtensionDetail";

/**
 * 扩展视图（L1~L2 + 片段）：已安装列表 + 本地 VSIX 安装 + 详情（README）。
 * 在线市场（Open VSX）已移除：NFR-03/06 要求离线可用且无外联，
 * 市场是唯一需要联网的功能，删除后应用退化为完全离线（零网络依赖）。
 */

function extDisplayName(m: ExtensionManifest): string {
  return m.displayName ?? m.name;
}

/** 扩展图标：仅内存态占位图（本地扩展无在线图标源，市场已移除） */
function ExtensionIcon({ displayName }: { displayName: string }) {
  return (
    <div
      title={displayName}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--aluka-input-bg)]"
    >
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
  /** 查询框：按显示名/发布者/描述过滤已安装列表 */
  const [query, setQuery] = useState("");
  /** 详情页目标：null = 列表 */
  const [detail, setDetail] = useState<{
    dir: string;
    origin: "global" | "workspace";
    manifest: ExtensionManifest;
  } | null>(null);
  const show = useNotificationStore((s) => s.show);

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
  }, [refreshInstalled]);

  // 本地 VSIX 安装（装完即时激活，无需重启）
  const handleInstallLocalVsix = async () => {
    setBusyLocal(true);
    try {
      const vsixPath = await pickVsixDialog();
      if (!vsixPath) return;
      const r = await installVsix(vsixPath);
      const m = parseManifest(r.manifest);
      show("info", `扩展 ${m ? extDisplayName(m) : ""} 安装成功`);
      await refreshInstalled();
    } catch (e) {
      show("error", `安装失败: ${String(e)}`);
    } finally {
      setBusyLocal(false);
    }
  };

  // 卸载（extId 提供时热清理运行时资产：主题/切换命令/片段 provider）
  const handleUninstall = async (dir: string, name: string, extId?: string) => {
    try {
      await uninstallExtension(dir);
      if (extId) unloadExtension(extId);
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

  // 关键词过滤（空查询 = 全量）
  const keyword = query.trim().toLowerCase();
  const filteredList = keyword
    ? installedList.filter(({ manifest: m }) =>
        [extDisplayName(m), m.publisher, m.description ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(keyword),
      )
    : installedList;

  /** 进入详情后若扩展被卸载导致目标消失，退回列表 */
  useEffect(() => {
    if (!detail) return;
    if (!installedList.some((x) => x.dir === detail.dir)) setDetail(null);
  }, [installedList, detail]);

  if (detail) {
    const item = installedList.find((x) => x.dir === detail.dir);
    if (!item) return null;
    const id = extensionId(item.manifest);
    const isDisabled = disabled.has(id);
    return (
      <div className="flex h-full flex-col text-[12px]">
        <div className="min-h-0 flex-1">
          <ExtensionDetail
            detail={{
              dir: item.dir,
              origin: item.origin === "workspace" ? "workspace" : "global",
              manifest: item.manifest,
              disabled: isDisabled,
            }}
            icon={<ExtensionIcon displayName={extDisplayName(item.manifest)} />}
            onBack={() => setDetail(null)}
            onToggleDisabled={() => handleToggleDisabled(id, !isDisabled)}
            onUninstall={() => {
              void handleUninstall(
                item.dir,
                extDisplayName(item.manifest),
                extensionId(item.manifest),
              ).then(() => setDetail(null));
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-[12px]">
      {/* 顶部：搜索 + 操作栏 */}
      <div className="border-b border-[var(--aluka-border)] p-2">
        <div className="relative flex items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称 / 发布者搜索已安装扩展..."
            className="w-full rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] py-1.5 pl-2 pr-7 font-mono text-[12px] text-[var(--aluka-text)] placeholder-[var(--aluka-text-dim)] outline-none focus:border-[#007acc]"
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

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--aluka-text-dim)]">
            已安装 ({installedList.length})
          </span>
          <div className="flex items-center gap-1">
            <button
              title="从本地 .VSIX 安装"
              onClick={() => void handleInstallLocalVsix()}
              disabled={busyLocal}
              className="flex h-6 items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-2 text-[11px] text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
            >
              <FolderDown size={12} />
              <span>{busyLocal ? "安装中…" : "从 VSIX 安装"}</span>
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

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {installedList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-[var(--aluka-text-dim)]">
            <Blocks size={36} strokeWidth={1} />
            <p className="text-[12px]">尚未安装扩展</p>
            <p className="max-w-[220px] text-[11px] leading-relaxed">
              支持 VS Code 颜色主题与代码片段扩展；点击上方「从 VSIX 安装」选择本地包
            </p>
          </div>
        ) : filteredList.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-[var(--aluka-text-dim)]">
            没有匹配「{query}」的扩展
          </p>
        ) : (
          filteredList.map(({ dir, manifest: m, origin }) => {
            const id = extensionId(m);
            const isDisabled = disabled.has(id);
            return (
              <div
                key={dir}
                role="button"
                tabIndex={0}
                title="查看详情"
                onClick={() =>
                  setDetail({
                    dir,
                    origin: origin === "workspace" ? "workspace" : "global",
                    manifest: m,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setDetail({
                      dir,
                      origin: origin === "workspace" ? "workspace" : "global",
                      manifest: m,
                    });
                  }
                }}
                className="mb-1 flex cursor-pointer gap-2.5 rounded border border-transparent p-2 hover:border-[var(--aluka-border)] hover:bg-[var(--aluka-hover)]"
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
                    {isDisabled && (
                      <span className="shrink-0 rounded bg-[var(--aluka-input-bg)] px-1 text-[10px] text-[var(--aluka-text-dim)]">
                        已禁用
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-[var(--aluka-text-dim)]">
                    {m.description || m.publisher}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleDisabled(id, !isDisabled);
                      }}
                      className="text-[11px] text-[#3794ff] hover:underline"
                    >
                      {isDisabled ? "启用" : "禁用"}
                    </button>
                    {origin === "global" && (
                      <button
                        title="卸载"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleUninstall(dir, extDisplayName(m), id);
                        }}
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
    </div>
  );
}
