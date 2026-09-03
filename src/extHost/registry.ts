import monaco from "../monaco-setup";
import { registerCommands, unregisterCommands, getCommand, runCommand } from "../commands";
import { registerTheme, unregisterTheme } from "../theme";
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
  parseJsonc,
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
/** 每个扩展注册的命令 id / 主题 id / 片段 provider（卸载时热清理） */
const extensionOwnedCommands = new Map<string, string[]>();
const extensionOwnedThemes = new Map<string, string[]>();
const snippetDisposablesByExt = new Map<string, monaco.IDisposable[]>();

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

/** 卸载热清理：反注册该扩展的命令/主题、摘除片段 provider、允许重装后重新激活 */
export function unloadExtension(extId: string): void {
  unregisterCommands(extensionOwnedCommands.get(extId) ?? []);
  extensionOwnedCommands.delete(extId);
  for (const themeId of extensionOwnedThemes.get(extId) ?? []) unregisterTheme(themeId);
  extensionOwnedThemes.delete(extId);
  for (const d of snippetDisposablesByExt.get(extId) ?? []) d.dispose();
  snippetDisposablesByExt.delete(extId);
  activated.delete(extId);
}

async function activate(dir: string, m: ExtensionManifest, origin: string): Promise<void> {
  const id = extensionId(m);
  const displayName = m.displayName ?? m.name;
  // 沙箱降级记录（宽容兜底触达面），main.js 执行完用于提示
  const degradedSet = new Set<string>();
  // 本扩展注册的资源追踪（卸载热清理用）
  const ownedCommands: string[] = [];
  const ownedThemes: string[] = [];
  const ownedSnippets: monaco.IDisposable[] = [];

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
  ownedCommands.push(...declared.map((c) => c.id));
  extensionOwnedCommands.set(id, ownedCommands);

  // 2) contributes.themes：读取主题 JSONC → 注册为可选主题 + 切换命令
  for (const t of m.contributes?.themes ?? []) {
    let json: unknown;
    try {
      json = parseJsonc(await readExtensionFile(dir, t.path));
    } catch {
      continue; // 主题文件损坏：跳过该主题，不中断扩展激活
    }
    const theme = parseThemeJson(`${id}.${slug(t.label)}`, t.label, json);
    if (!theme) continue;
    registerTheme(theme);
    ownedThemes.push(theme.id);
    extensionOwnedThemes.set(id, ownedThemes);
    registerCommands([
      {
        id: `aluka.theme.${id}.${slug(t.label)}`,
        title: t.label,
        category: "主题",
        run: () => useSettingsStore.getState().update({ theme: theme.id }),
      },
    ]);
    ownedCommands.push(`aluka.theme.${id}.${slug(t.label)}`);
  }

  // 3) contributes.snippets：VS Code 片段 JSONC → Monaco completion provider
  // （不设 triggerCharacters：Monaco 键入即触发，按 prefix 过滤，贴近 VS Code 行为）
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

  // 4) main.js：沙箱执行（vscode 真垫片 + Node/CommonJS/未实现 API 宽容兜底）
  if (m.main) {
    const code = await readExtensionFile(dir, m.main);
    const shim = createVscodeShim(id, m, degradedSet, (commandId) => {
      // 沙箱内注册的命令纳入扩展资产，卸载时可反注册
      if (!ownedCommands.includes(commandId)) ownedCommands.push(commandId);
      extensionOwnedCommands.set(id, ownedCommands);
    });
    const degraded = runSandboxed(code, shim, dir);
    if (degraded.size > 0) {
      useNotificationStore
        .getState()
        .show(
          "info",
          `扩展 ${displayName} 已加载；${degraded.size} 个不受支持的 API 以空实现兜底（相关功能不可用）`,
        );
    }
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

/* ---------------- vscode 兼容垫片（L3 + 宽容兜底） ---------------- */

/**
 * VS Code 模块规范导出名（覆盖 vscode.d.ts 稳定 API 顶级导出面）。
 * esbuild/webpack 互操作会用 getOwnPropertyNames 静态快照模块键：
 * Proxy 不通告这些名字，快照后访问（如 `vscode_1.chat.createChatParticipant`）
 * 就会是字面 undefined。未在此清单中的成员仍可经 get 陷阱宽容兜底（直接属性访问路径）。
 */
const VSCODE_MODULE_EXPORTS: string[] = [
  // 命名空间
  "authentication", "chat", "commands", "comments", "debug", "env", "extensions",
  "languages", "l10n", "lm", "notebooks", "outputs", "scm", "speech", "tasks",
  "tests", "window", "workspace",
  // 类 / 值对象
  "CancellationToken", "CancellationTokenSource", "CodeAction", "CodeActionKind",
  "CodeLens", "Color", "ColorTheme", "Command", "CompletionItem", "CompletionList",
  "Diagnostic", "DiagnosticCollection", "Disposable", "DocumentHighlight",
  "DocumentLink", "DocumentSymbol", "EndOfLine", "Event", "EventEmitter",
  "FileDecoration", "FileSystemError", "FileSystemWatcher", "GlobPattern",
  "Hover", "LanguageConfiguration", "Location", "LogOutputChannel",
  "MarkdownString", "MessageItem", "NotebookCell", "NotebookCellData",
  "NotebookData", "NotebookRendererScript", "OutputChannel", "Position",
  "Progress", "QuickInput", "QuickPick", "QuickPickItem", "Range",
  "RelativePattern", "Selection", "SemanticTokens", "SemanticTokensBuilder",
  "ShellExecution", "SnippetString", "StatusBarItem", "Tab", "TabGroup",
  "Task", "TaskGroup", "TextDocument", "TextEdit", "TextEditor",
  "TextEditorCursorStyle", "TextEditorDecorationType", "TextEditorEdit",
  "ThemeColor", "ThemeIcon", "TreeItem", "TreeItemCollapsibleState",
  "TypeHierarchyItem", "Uri", "ViewColumn", "Webview", "WebviewPanel",
  "WebviewPanelSerializer", "WebviewView", "WebviewViewProvider",
  "WorkspaceEdit", "WorkspaceFolder",
  // 枚举 / 常量对象
  "Breakpoint", "Button", "CallHierarchyItem", "CodeActionTriggerKind",
  "ColorThemeKind", "CompletionItemInsertTextRule", "CompletionItemKind",
  "ConfigurationTarget", "DebugConfigurationProviderTriggerKind",
  "DiagnosticSeverity", "DiagnosticTag", "DocumentHighlightKind",
  "ExtensionKind", "ExtensionMode", "FileChangeType", "FileDecorationOptions",
  "FileType", "IndentAction", "NotebookCellKind",
  "NotebookCellStatusBarAlignment", "OverviewRulerLane",
  "ProgressLocation", "QuickInputButtons", "QuickPickItemKind",
  "SemanticTokensFormat", "ShellQuoting", "SignatureHelpTriggerKind",
  "StatusBarAlignment", "SyntaxTokenType", "TabInputNotebook", "TabInputText",
  "TabInputTextDiff", "TabInputWebview", "TaskPanelKind", "TaskRevealKind",
  "TaskScope", "Terminal", "ProcessExecution", "DebugAdapterExecutable",
  "TextDocumentSaveReason", "TextEditorLineNumbersStyle",
  "TextEditorRevealType", "TreeCheckboxState", "UIKind", "Version",
  "ViewBadge", "WorkspaceEditEntryMetadata",
  "CodeLensList", "ConfigurationChangeEvent", "DebugConfiguration",
  "DebugConsoleMode", "DebugSession", "DebugSessionOptions",
  "DocumentSelector", "EditorGroup", "EditorGroupLayout",
  "ExtensionTerminalOptions", "FileDecorationProvider", "FoldingRange",
  "FoldingRangeKind", "InlayHint", "InlayHintLabelPart", "InlineCompletionItem",
  "InlineValue", "LinkedEditingRanges", "NotebookController", "NotebookEditor",
  "QuickPickItemKind", "SelectionRange", "SignatureHelp",
  "TextEditorOptions", "TextEditorViewColumnChangeEvent", "TreeDragAndDrop",
  "TreeView", "WindowState", "WorkspaceConfiguration", "WorkspaceFoldersChangeEvent",
  // 函数 / 顶级事件
  "createDiagnosticCollection", "createTestItem", "getExtension", "getExtensions",
  "onDidChangeActiveTextEditor", "onDidChangeConfiguration",
  "onDidChangeTextDocument", "onDidChangeVisibleTextEditors",
  "onDidChangeWorkspaceFolders", "onDidCloseTextDocument", "onDidCreateFiles",
  "onDidDeleteFiles", "onDidOpenTextDocument", "onDidRenameFiles",
  "onDidSaveTextDocument", "onWillSaveTextDocument",
  "registerCallHierarchyProvider", "registerCodeActionsProvider",
  "registerCodeLensProvider", "registerCompletionItemProvider",
  "registerDefinitionProvider", "registerDocumentFormattingEditProvider",
  "registerDocumentHighlightProvider", "registerDocumentLinkProvider",
  "registerDocumentSymbolProvider", "registerFoldingRangeProvider",
  "registerHoverProvider", "registerImplementationProvider",
  "registerInlineCompletionItemProvider", "registerReferenceProvider",
  "registerRenameProvider", "registerSelectionRangeProvider",
  "registerSemanticTokensProvider", "registerSignatureHelpProvider",
  "registerTextDocumentContentProvider", "registerTypeHierarchyProvider",
  // 版本 / 兼容
  "version",
];

/**
 * Node 内建模块常用成员（宽容兜底的 ownKeys 通告面）。
 * esbuild/webpack 对 require("path") 等也会做键快照：不通告 basename/join 等
 * 常见成员，`ht(require("path")).basename` 快照后就是 undefined。
 */
const NODE_INTEROP_MEMBERS: string[] = [
  // path
  "basename", "dirname", "extname", "join", "resolve", "normalize", "relative",
  "isAbsolute", "parse", "format", "sep", "delimiter", "posix", "win32",
  "toNamespacedPath",
  // fs / fs.promises
  "readFileSync", "writeFileSync", "existsSync", "statSync", "readdirSync",
  "mkdirSync", "accessSync", "realpathSync", "readFile", "writeFile", "readdir",
  "stat", "access", "mkdir", "rename", "unlink", "rm", "rmSync", "watch",
  "createReadStream", "createWriteStream", "constants", "promises",
  // os
  "platform", "arch", "homedir", "tmpdir", "EOL", "cpus", "totalmem",
  "freemem", "hostname", "type", "release", "userInfo", "networkInterfaces",
  // util
  "promisify", "inherits", "inspect", "format", "callbackify", "types",
  "isDeepStrictEqual", "deprecate",
  // crypto
  "randomUUID", "randomBytes", "createHash", "createHmac", "createCipheriv",
  "createDecipheriv", "getRandomValues", "generateKeyPairSync", "webcrypto",
  "timingSafeEqual",
  // child_process
  "exec", "execSync", "spawn", "spawnSync", "fork",
  // stream
  "Readable", "Writable", "Transform", "Duplex", "PassThrough",
  // zlib / url / http/https / net / events / tty / buffer
  "gzip", "gunzip", "deflate", "inflate", "constants",
  "URL", "URLSearchParams", "fileURLToPath", "pathToFileURL",
  "request", "get", "createServer",
  "connect", "createConnection", "createServer", "isIP",
  "EventEmitter",
  "isatty",
  "Buffer",
];

/**
 * 宽容兜底对象：属性访问返回另一个宽容对象，调用返回宽容对象，
 * 字符串/数值 coercion 得空串——保证第三方扩展在未实现的 API 上继续
 * 执行而非抛 ReferenceError/TypeError（能力不承诺，降级数量事后提示）。
 */
function createTolerant(label: string, degraded: Set<string>): unknown {
  const cache = new Map<string, unknown>();
  const base = function () {
    return undefined;
  } as unknown as Record<string | symbol, unknown>;
  return new Proxy(base, {
    get(_t, prop) {
      if (prop === "then") return undefined; // 不作为 thenable
      if (
        prop === "valueOf" ||
        prop === "toString" ||
        prop === "inspect" ||
        prop === Symbol.toPrimitive
      ) {
        return () => "";
      }
      if (prop === Symbol.iterator) {
        // for...of 宽容对象时为空迭代（防 "is not iterable"）
        return () => [][Symbol.iterator]();
      }
      if (typeof prop === "symbol") return undefined;
      if (!cache.has(prop)) {
        degraded.add(label);
        cache.set(prop, createTolerant(`${label}.${prop}`, degraded));
      }
      return cache.get(prop);
    },
    apply() {
      degraded.add(`${label}()`);
      return createTolerant(`${label}()`, degraded);
    },
    // 构造返回宽容对象而非普通 {}：`new X().onDidChangeDirty` 等实例链访问不炸
    construct() {
      degraded.add(`new ${label}`);
      return createTolerant(`new ${label}()`, degraded) as object;
    },
    has() {
      return true;
    },
    // esbuild __toCommonJS / webpack 互操作会快照模块键：通告 default 与
    // Node 内建常用成员（须含 target 自有键：函数的 prototype 不可配置，漏报触发 Proxy 不变量）
    ownKeys(t) {
      return [...new Set([...Reflect.ownKeys(t), "default", ...NODE_INTEROP_MEMBERS])];
    },
  });
}

/** 最小 Disposable 桩（registerXxx 系列的真实返回，支持 dispose 链） */
class DisposableStub {
  dispose(): void {}
}

function createVscodeShim(
  id: string,
  m: ExtensionManifest,
  degraded: Set<string>,
  trackCommand?: (commandId: string) => void,
): unknown {
  const notify = useNotificationStore.getState();
  /** 真实现对象 → "真优先、宽容兜底" Proxy（防 `vscode.window.X` 二级访问得 undefined） */
  const withFallback = (real: Record<string, unknown>, label: string): unknown =>
    new Proxy(real, {
      get(t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop in t) return t[prop];
        degraded.add(`${label}.${String(prop)}`);
        return createTolerant(`${label}.${String(prop)}`, degraded);
      },
    });
  /** 最小文档桩：结果会流入解析器等严格函数（宽容对象会让 `doc.getText()` 变对象而非字符串） */
  const stubDocument = () => {
    const doc: Record<string, unknown> = {
      uri: createTolerant("doc.uri", degraded),
      fileName: "",
      languageId: "plaintext",
      isDirty: false,
      isUntitled: false,
      isClosed: false,
      eol: 1,
      lineCount: 0,
      getText: () => "",
      positionAt: (_o: number) => createTolerant("doc.positionAt()", degraded),
      offsetAt: () => 0,
      lineAt: () => ({
        text: "",
        range: createTolerant("doc.lineAt().range", degraded),
        lineNumber: 0,
        isEmptyOrWhitespace: true,
        firstNonWhitespaceCharacterIndex: 0,
      }),
      getWordRangeAtPosition: () => undefined,
      save: async () => false,
      validateRange: (r: unknown) => r,
      validatePosition: (p: unknown) => p,
    };
    return doc;
  };
  // 会话/输入类 API 的返回走"真实可用的最小桩"而非宽容对象：
  // 宽容对象在 `doc.getText()`、`input === undefined` 等严格检查处会误伤
  const real: Record<string, unknown> = {
    commands: withFallback(
      {
        registerCommand: (commandId: string, impl: (...args: unknown[]) => void) => {
          trackCommand?.(commandId);
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
      "vscode.commands",
    ),
    window: withFallback(
      {
        showInformationMessage: (msg: string) => notify.show("info", `[${m.displayName ?? id}] ${msg}`),
        showWarningMessage: (msg: string) => notify.show("warning", `[${m.displayName ?? id}] ${msg}`),
        showErrorMessage: (msg: string) => notify.show("error", `[${m.displayName ?? id}] ${msg}`),
        // 输出通道：空实现（扩展日志无处可去，仅保激活不炸）
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          hide: () => {},
          dispose: () => {},
        }),
        activeTextEditor: null,
        visibleTextEditors: [],
        tabGroups: {
          all: [],
          onDidChangeTabGroups: () => new DisposableStub(),
          onDidChangeTabs: () => new DisposableStub(),
          close: async () => true,
          moveTab: async () => true,
        },
        showInputBox: async () => undefined,
        showQuickPick: async () => undefined,
        showOpenDialog: async () => undefined,
        showSaveDialog: async () => undefined,
        registerWebviewViewProvider: () => new DisposableStub(),
        registerWebviewPanelSerializer: () => new DisposableStub(),
      },
      "vscode.window",
    ),
    workspace: withFallback(
      {
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
        // 配置读取：返回扩展提供的默认值（真实 settings 未接入扩展命名空间）
        getConfiguration: () => ({
          get: (_section: string, defaultValue: unknown) => defaultValue,
          has: () => false,
          update: async () => {},
          inspect: () => undefined,
        }),
        // 文档桩：让 `const doc = await openTextDocument(uri); doc.getText()` 拿到字符串
        openTextDocument: async () => stubDocument(),
        openUntitledTextDocument: async () => stubDocument(),
        workspaceFolders: [],
      },
      "vscode.workspace",
    ),
  };
  // 模块互操作标记：__esModule 让 esbuild/webpack 直接透传本模块（.TreeItem 等直接可读）
  real.__esModule = true;
  // 未列出的 vscode.* 顶级成员同样走宽容兜底（记录降级，不中断激活）
  const moduleProxy = withFallback(real, "vscode") as Record<string, unknown>;
  real.default = moduleProxy;
  // 互操作快照兜底：getOwnPropertyNames 通告规范导出名，
  // 否则 `const { TreeItem } = require("vscode")` / __toESM 复制后得字面 undefined
  return new Proxy(moduleProxy, {
    ownKeys(t) {
      const own = Reflect.ownKeys(t);
      return [...new Set([...own, ...VSCODE_MODULE_EXPORTS])];
    },
    getOwnPropertyDescriptor(t, prop) {
      const d = Reflect.getOwnPropertyDescriptor(t, prop);
      if (d) return d;
      if (typeof prop === "string" && VSCODE_MODULE_EXPORTS.includes(prop)) {
        // 访问器描述符：读取时经外层 get 陷阱走宽容兜底
        return {
          configurable: true,
          enumerable: true,
          get: () => (t as Record<string, unknown>)[prop],
          set: () => {},
        };
      }
      return undefined;
    },
    has(t, prop) {
      return (
        Reflect.has(t, prop) ||
        (typeof prop === "string" && VSCODE_MODULE_EXPORTS.includes(prop))
      );
    },
  });
}

/** 沙箱执行 main.js：严格模式 + vscode / CommonJS / Node 兜底垫片。
 * VS Code 扩展（esbuild/webpack CJS 产物）普遍为 `module.exports.activate`
 * 入口 + `require("vscode")` 取 API，部分还引用 Node 内建模块——
 * require("vscode") 返回真垫片，其余模块与未实现的 vscode.* 成员以
 * 空实现兜底（能力不承诺，REQUIREMENTS §5 L3 边界，降级数量事后提示）。
 * 隔离强度说明：扩展代码技术上仍可触达全局对象；完整的 Worker/iframe
 * 隔离属 L4+ 范畴，当前以"最小 API 面"为边界。 */
function runSandboxed(code: string, vscodeApi: unknown, extensionPath: string): Set<string> {
  const degraded = new Set<string>();
  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  const nodeRequire = (modId: string): unknown => {
    if (modId === "vscode") return vscodeApi;
    if (modId === "process") return processShim();
    // Node 内建 / 相对模块：空实现兜底，仅保激活存活
    degraded.add(`require("${modId}")`);
    return createTolerant(`require("${modId}")`, degraded);
  };
  (nodeRequire as { cache?: unknown }).cache = {};
  const processShim = () => {
    const p: Record<string, unknown> = {
      env: {} as Record<string, string>,
      platform: "win32",
      arch: "x64",
      version: "v18.0.0",
      type: "extensionHost",
      cwd: () => useAppStore.getState().workspaceRoot ?? "",
      nextTick: (fn: () => void) => setTimeout(fn, 0),
      stderr: { write: () => true },
    };
    // 互操作兜底：ht(process).default 需命中自身
    p.default = p;
    return p;
  };
  const fn = new Function(
    "vscode",
    "module",
    "exports",
    "require",
    "process",
    `"use strict";\n${code}\n;return module.exports;`,
  );
  let exported: unknown = null;
  try {
    exported =
      fn(vscodeApi, moduleShim, moduleShim.exports, nodeRequire, processShim()) ??
      moduleShim.exports;
  } catch (e) {
    throw new Error(`扩展入口执行失败: ${String(e)}`);
  }
  // VS Code 标准入口：exports.activate(context)；缺失则视为纯 contributes 扩展
  const activate =
    exported !== null && typeof exported === "object"
      ? (exported as Record<string, unknown>).activate
      : undefined;
  if (typeof activate === "function") {
    try {
      const maybePromise = (activate as (ctx: unknown) => unknown).call(
        exported,
        createExtensionContext(degraded, extensionPath),
      );
      // activate 返回 Promise 时吞掉异步 rejection（已在激活通知层面提示过同步失败）
      if (maybePromise instanceof Promise) {
        maybePromise.catch((e: unknown) => {
          useNotificationStore
            .getState()
            .show("warning", `扩展异步激活失败: ${String(e)}`);
        });
      }
    } catch (e) {
      throw new Error(`扩展 activate 失败: ${String(e)}`);
    }
  }
  return degraded;
}

/** 扩展宿主上下文：真实字段（subscriptions/extensionPath 等）+ 宽容兜底
 * （extensionUri/globalStorageUri 等 Uri 类成员未实现，经兜底保证 context.X.fsPath 类访问不炸） */
function createExtensionContext(degraded: Set<string>, extensionPath: string): unknown {
  const real: Record<string, unknown> = {
    subscriptions: [] as { dispose(): unknown }[],
    extensionPath,
    extensionMode: 1, // Production
    globalState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: async () => {},
      setKeysForSync: () => {},
    },
    workspaceState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: async () => {},
    },
    asAbsolutePath: (p: string) => p,
  };
  return new Proxy(real, {
    get(t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop in t) return t[prop];
      degraded.add(`context.${String(prop)}`);
      return createTolerant(`context.${String(prop)}`, degraded);
    },
  });
}
