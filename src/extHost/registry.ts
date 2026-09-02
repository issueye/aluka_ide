import monaco from "../monaco-setup";
import { registerCommands, getCommand, runCommand } from "../commands";
import { registerTheme } from "../theme";
import { useSettingsStore } from "../settingsStore";
import { useAppStore } from "../store";
import { useNotificationStore } from "../notificationStore";
import {
  listExtensions,
  readExtensionFile,
  readFile,
  type InstalledExtension,
} from "../tauri";
import {
  parseManifest,
  parseThemeJson,
  extensionId,
  type ExtensionManifest,
} from "./manifest";

/**
 * 扩展宿主（M6 / FR-10，兼容分级 L1~L3）。
 * 激活流程：清单收窄 → 命令声明占位 → 主题注册 → 片段注册 → main.js 沙箱执行
 * （垫片 registerCommand 覆盖占位实现）→ keybindings 挂到命令。
 * 取舍：禁用/启用与工作区级扩展变更需重开应用生效（activated 去重，避免重复
 * 注册 completion provider）；垫片 workspace 仅提供 rootPath + 只读 readFile，
 * 写路径待沙箱隔离强化后开放（质量红线 4：不暴露无确认的用户文件覆盖能力）。
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
/** 扩展注册的片段 provider 卸载器（记录用途，禁用生效依赖重启） */
const snippetDisposables: monaco.IDisposable[] = [];

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
      await activate(inst.dir, m, inst.origin);
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

async function activate(dir: string, m: ExtensionManifest, origin: string): Promise<void> {
  const id = extensionId(m);
  const displayName = m.displayName ?? m.name;

  // 1) contributes.commands：先注册声明（面板可见；main.js 稍后覆盖实现）
  const declared = (m.contributes?.commands ?? []).map((c) => ({
    id: c.command,
    title: c.title,
    category: c.category ?? displayName,
    run: () =>
      useNotificationStore
        .getState()
        .show("warning", `命令 ${c.command} 已声明但扩展未提供实现`),
  }));
  registerCommands(declared);

  // 2) contributes.themes：读取主题 JSON → 注册为可选主题 + 切换命令
  for (const t of m.contributes?.themes ?? []) {
    const json: unknown = JSON.parse(await readExtensionFile(dir, t.path));
    const theme = parseThemeJson(`${id}.${slug(t.label)}`, t.label, json);
    if (!theme) continue;
    registerTheme(theme);
    registerCommands([
      {
        id: `aluka.theme.${id}.${slug(t.label)}`,
        title: t.label,
        category: "主题",
        run: () => useSettingsStore.getState().update({ theme: theme.id }),
      },
    ]);
  }

  // 3) contributes.snippets：VS Code 片段 JSON → Monaco completion provider
  for (const s of m.contributes?.snippets ?? []) {
    if (!s.language) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readExtensionFile(dir, s.path));
    } catch {
      continue;
    }
    const items = parseSnippets(parsed);
    if (items.length === 0) continue;
    snippetDisposables.push(
      monaco.languages.registerCompletionItemProvider(s.language, {
        triggerCharacters: ["@", "#"],
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

  // 4) main.js：沙箱执行（垫片提供 vscode API 面）
  if (m.main) {
    const code = await readExtensionFile(dir, m.main);
    runSandboxed(code, createVscodeShim(id, m));
  }

  // 5) contributes.keybindings：挂到命令注册表（keymap 每次按键从 registry 派生）
  for (const kb of m.contributes?.keybindings ?? []) {
    const cmd = getCommand(kb.command);
    if (cmd && kb.key) cmd.keybinding = kb.key.toLowerCase();
  }

  void origin;
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

/* ---------------- vscode 兼容垫片（L3） ---------------- */

function createVscodeShim(id: string, m: ExtensionManifest) {
  const notify = useNotificationStore.getState();
  return {
    commands: {
      registerCommand: (commandId: string, impl: (...args: unknown[]) => void) => {
        registerCommands([
          {
            id: commandId,
            title: m.contributes?.commands?.find((c) => c.command === commandId)?.title ?? commandId,
            category: m.displayName ?? m.name,
            run: () => Promise.resolve(impl()),
          },
        ]);
      },
      executeCommand: (commandId: string) => void runCommand(commandId),
    },
    window: {
      showInformationMessage: (msg: string) => notify.show("info", `[${m.displayName ?? id}] ${msg}`),
      showWarningMessage: (msg: string) => notify.show("warning", `[${m.displayName ?? id}] ${msg}`),
      showErrorMessage: (msg: string) => notify.show("error", `[${m.displayName ?? id}] ${msg}`),
    },
    workspace: {
      get rootPath(): string | null {
        return useAppStore.getState().workspaceRoot;
      },
      readFile: async (path: string): Promise<string> => {
        const root = useAppStore.getState().workspaceRoot;
        if (!root || !path.startsWith(root)) {
          throw new Error("workspace.readFile 仅允许读取工作区内的文件");
        }
        const f = await readFile(path);
        if (f.isBinary) throw new Error("目标为二进制文件");
        return f.content;
      },
    },
  };
}

/** 沙箱执行 main.js：严格模式 + 仅注入 vscode 形参。
 * 隔离强度说明：扩展代码技术上仍可触达全局对象；完整的 Worker/iframe
 * 隔离属 L4+ 范畴（REQUIREMENTS §5），当前以"最小 API 面"为边界。 */
function runSandboxed(code: string, vscode: unknown): void {
  new Function("vscode", `"use strict";\n${code}`)(vscode);
}
