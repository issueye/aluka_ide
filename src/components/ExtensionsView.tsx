import { useCallback, useEffect, useState } from "react";
import { Blocks, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { installVsix, listExtensions, pickVsixDialog, uninstallExtension, type InstalledExtension } from "../tauri";
import { parseManifest, extensionId, type ExtensionManifest } from "../extHost/manifest";
import {
  getDisabledExtensions,
  loadExtensions,
  setExtensionDisabled,
} from "../extHost/registry";
import { useNotificationStore } from "../notificationStore";

/**
 * 扩展视图（M6 / FR-10）：已装扩展列表 + 本地 VSIX 安装 + 启用/禁用/卸载。
 * 禁用切换记录到 localStorage，重开应用生效（registry 激活去重，见 registry.ts 取舍注）。
 */

function extDisplayName(m: ExtensionManifest): string {
  return m.displayName ?? m.name;
}

export default function ExtensionsView() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const [list, setList] = useState<Array<InstalledExtension & { manifest: ExtensionManifest }>>([]);
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const show = useNotificationStore((s) => s.show);

  const refresh = useCallback(async () => {
    setDisabled(getDisabledExtensions());
    try {
      const installed = await listExtensions(workspaceRoot);
      const parsed = installed
        .map((inst) => ({ ...inst, manifest: parseManifest(inst.manifest) }))
        .filter((x): x is InstalledExtension & { manifest: ExtensionManifest } => x.manifest !== null);
      setList(parsed);
      void loadExtensions();
    } catch {
      /* 无后端环境 */
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async () => {
    setBusy(true);
    try {
      const vsixPath = await pickVsixDialog();
      if (!vsixPath) return;
      const r = await installVsix(vsixPath);
      const m = parseManifest(r.manifest);
      show("info", `扩展 ${m ? extDisplayName(m) : ""} 安装成功，重开应用后生效`);
      await refresh();
    } catch (e) {
      show("error", `安装失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, next: boolean) => {
    setExtensionDisabled(id, next);
    setDisabled(getDisabledExtensions());
    show("info", next ? "已禁用，重开应用后生效" : "已启用，重开应用后生效");
  };

  const uninstall = async (dir: string, name: string) => {
    try {
      await uninstallExtension(dir);
      show("info", `扩展 ${name} 已卸载，重开应用后生效`);
      await refresh();
    } catch (e) {
      show("error", `卸载失败: ${String(e)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => void install()}
          disabled={busy}
          className="rounded bg-[var(--aluka-btn-bg)] px-2.5 py-1 text-[12px] text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
        >
          {busy ? "安装中…" : "从 VSIX 安装…"}
        </button>
        <button
          title="刷新"
          onClick={() => void refresh()}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {list.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--aluka-text-dim)]">
          <Blocks size={36} strokeWidth={1} />
          <p className="text-[12px]">尚未安装扩展</p>
          <p className="max-w-[200px] text-[11px]">
            安装本地 .vsix（VS Code 插件子集：颜色主题 / 命令 / 快捷键 / 片段）
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.map(({ dir, manifest: m, origin }) => {
          const id = extensionId(m);
          const isDisabled = disabled.has(id);
          return (
            <div
              key={dir}
              className="mb-1 flex gap-2 rounded border border-transparent p-2 hover:border-[var(--aluka-border)] hover:bg-[var(--aluka-hover)]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[var(--aluka-input-bg)]">
                <Puzzle size={18} className="text-[var(--aluka-text-dim)]" />
              </div>
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
                  {m.description ?? m.publisher}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    onClick={() => toggle(id, !isDisabled)}
                    className="text-[11px] text-[#3794ff] hover:underline"
                  >
                    {isDisabled ? "启用" : "禁用"}
                  </button>
                  {origin === "global" && (
                    <button
                      title="卸载"
                      onClick={() => void uninstall(dir, extDisplayName(m))}
                      className="flex items-center gap-0.5 text-[11px] text-[#f48771] hover:underline"
                    >
                      <Trash2 size={11} />
                      卸载
                    </button>
                  )}
                  {isDisabled && (
                    <span className="text-[11px] text-[var(--aluka-text-dim)]">(已禁用)</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
