import monaco from "../monaco-setup";
import {
  registerCommands,
  unregisterCommands,
  guardRegisteredCommands,
  type AlukaCommand,
} from "../commands";
import { registerTheme, unregisterTheme } from "../theme";
import { useSettingsStore } from "../settingsStore";
import { useAppStore } from "../store";
import { useNotificationStore } from "../notificationStore";
import {
  listExtensions,
  readExtensionFile,
  type InstalledExtension,
} from "../tauri";
import {
  parseJsonc,
  parseManifest,
  parseThemeJson,
  extensionId,
  type ExtensionManifest,
} from "./manifest";

/**
 * 扩展宿主（M6 / FR-10，兼容分级 L1~L2 + 代码片段）。
 * 激活流程：清单收窄 → 主题注册（含切换命令）→ 片段注册。
 *
 * 能力边界（REQUIREMENTS §5）：本层**不执行任何扩展代码**。
 * `main.js` 沙箱与 `vscode` API 垫片已按范围决策整体移除——在缺少文档同步、
 * 编辑器访问与事件派发的条件下，L3 只能支撑"注册一个只会弹通知的命令"，
 * 却承担了执行任意 JS 的全部安全风险与最重的维护成本，故不保留。
 * 因此 contributes.commands / keybindings 不再注册（避免在命令面板留下
 * "可点但无实现"的死命令）；扩展退化为纯声明式数据。
 *
 * 取舍：禁用/启用与工作区级扩展变更需重开应用生效（activated 去重，
 * 避免重复注册 completion provider）。
 */

const DISABLED_KEY = "aluka.disabledExtensions";

export function getDisabledExtensions(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function setExtensionDisabled(id: string, disabled: boolean): void {
  const set = getDisabledExtensions();
  if (disabled) set.add(id);
  else set.delete(id);
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...set]));
  } catch {
    /* 忽略 */
  }
}

/** 已激活扩展 id（publisher.name），防止重复注册 */
const activated = new Set<string>();
/** 每个扩展注册的命令 id / 主题 id / 片段 provider（卸载时热清理） */
const extensionOwnedCommands = new Map<string, string[]>();
const extensionOwnedThemes = new Map<string, string[]>();
const snippetDisposablesByExt = new Map<string, monaco.IDisposable[]>();
/**
 * 主题 id 归属：拒绝跨扩展抢占同一 id。
 * 主题 id 形如 `<publisher>.<name>.<label>`，本身已带命名空间，
 * 但扩展可声明 publisher/name 恰好组成他人的 id 前缀 → 后激活者覆盖先注册者。
 * 故记录持有者，先到先得（卸载时释放）。
 */
const themeOwner = new Map<string, string>();

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "theme"
  );
}

/** 扫描并激活全部扩展（幂等；扩展视图打开 / 应用启动时调用） */
export async function loadExtensions(): Promise<void> {
  const workspaceRoot = useAppStore.getState().workspaceRoot;
  let installed: InstalledExtension[];
  try {
    installed = await listExtensions(workspaceRoot);
  } catch {
    return; // 纯浏览器 dev 无后端
  }
  // 工作区级优先激活（VS Code 语义：工作区扩展覆盖全局同名）
  installed.sort((a) => (a.origin === "workspace" ? -1 : 1));
  for (const inst of installed) {
    const m = parseManifest(inst.manifest);
    if (!m) continue;
    const id = extensionId(m);
    if (activated.has(id) || getDisabledExtensions().has(id)) continue;
    try {
      await activate(inst.dir, m);
      activated.add(id);
    } catch (e) {
      useNotificationStore
        .getState()
        .show("error", `扩展 ${id} 激活失败: ${String(e)}`);
    }
  }
}

export function isActivated(id: string): boolean {
  return activated.has(id);
}

/** 卸载热清理：反注册该扩展的主题与切换命令、摘除片段 provider、允许重装后重新激活 */
export function unloadExtension(extId: string): void {
  unregisterCommands(extensionOwnedCommands.get(extId) ?? []);
  extensionOwnedCommands.delete(extId);
  for (const themeId of extensionOwnedThemes.get(extId) ?? []) {
    unregisterTheme(themeId);
    themeOwner.delete(themeId);
  }
  extensionOwnedThemes.delete(extId);
  for (const d of snippetDisposablesByExt.get(extId) ?? []) d.dispose();
  snippetDisposablesByExt.delete(extId);
  activated.delete(extId);
}

/**
 * 扩展命令注册（仅用于主题切换这类有真实实现的命令）：
 * 经命令命名空间守卫过滤后落库，被拒命令（与内置 id 冲突）静默丢弃。
 */
function registerExtensionCommands(extId: string, cmds: AlukaCommand[]): AlukaCommand[] {
  const accepted = guardRegisteredCommands(extId, cmds);
  registerCommands(accepted);
  return accepted;
}

async function activate(dir: string, m: ExtensionManifest): Promise<void> {
  const id = extensionId(m);
  const displayName = m.displayName ?? m.name;
  // 本扩展注册的资源追踪（卸载热清理用）
  const ownedCommands: string[] = [];
  const ownedThemes: string[] = [];
  const ownedSnippets: monaco.IDisposable[] = [];

  // 1) contributes.themes：读取主题 JSONC → 注册为可选主题 + 切换命令
  //    （切换命令有真实实现，属 L2 功能；不依赖任何扩展代码执行）
  for (const t of m.contributes?.themes ?? []) {
    let json: unknown;
    try {
      json = parseJsonc(await readExtensionFile(dir, t.path));
    } catch {
      continue; // 主题文件损坏：跳过该主题，不中断扩展激活
    }
    const themeId = `${id}.${slug(t.label)}`;
    const owner = themeOwner.get(themeId);
    if (owner !== undefined && owner !== id) continue; // 不覆盖他人主题
    themeOwner.set(themeId, id);
    const theme = parseThemeJson(themeId, t.label, json);
    if (!theme) {
      themeOwner.delete(themeId);
      continue;
    }
    registerTheme(theme);
    ownedThemes.push(theme.id);
    extensionOwnedThemes.set(id, ownedThemes);

    const themeCommandId = `aluka.theme.${themeId}`;
    const accepted = registerExtensionCommands(id, [
      {
        id: themeCommandId,
        title: t.label,
        category: "主题",
        run: () => useSettingsStore.getState().update({ theme: theme.id }),
      },
    ]);
    ownedCommands.push(...accepted.map((c) => c.id));
    extensionOwnedCommands.set(id, ownedCommands);
  }

  // 2) contributes.snippets：VS Code 片段 JSONC → Monaco completion provider
  //    （不设 triggerCharacters：Monaco 键入即触发，按 prefix 过滤，贴近 VS Code 行为）
  for (const s of m.contributes?.snippets ?? []) {
    if (!s.language) continue;
    let parsed: unknown;
    try {
      parsed = parseJsonc(await readExtensionFile(dir, s.path));
    } catch {
      continue;
    }
    const items = parseSnippets(parsed);
    if (items.length === 0) continue;
    ownedSnippets.push(
      monaco.languages.registerCompletionItemProvider(s.language, {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: items.map((it) => ({
              label: it.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: it.body,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: it.description,
              detail: `${displayName} 片段`,
              range,
            })),
          };
        },
      }),
    );
  }
  if (ownedSnippets.length > 0) snippetDisposablesByExt.set(id, ownedSnippets);
}

/* ---------------- 片段解析（VS Code JSON 格式） ---------------- */

interface SnippetItem {
  prefix: string;
  body: string;
  description?: string;
}

function parseSnippets(raw: unknown): SnippetItem[] {
  if (typeof raw !== "object" || raw === null) return [];
  const items: SnippetItem[] = [];
  for (const [prefix, def] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof def === "object" && def !== null) {
      const d = def as Record<string, unknown>;
      const body = Array.isArray(d.body) ? d.body.join("\n") : d.body;
      if (typeof body === "string") {
        items.push({
          prefix,
          body,
          description: typeof d.description === "string" ? d.description : undefined,
        });
      }
    }
  }
  return items;
}
