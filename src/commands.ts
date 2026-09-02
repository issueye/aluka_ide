import { useAppStore } from "./store";
import { useEditorStore } from "./editorStore";
import { useGitStore } from "./gitStore";
import { useSettingsStore } from "./settingsStore";
import { useTerminalStore, clearTerminalView } from "./terminalStore";
import { showInfo } from "./notificationStore";
import { getActiveEditor } from "./activeEditor";
import { openFolderDialog } from "./tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import pkg from "../package.json";

/**
 * 命令注册表 + 快捷键中枢（M4 / FR-07、FR-08）。
 * 核心命令与后续扩展命令（M6）共用此统一入口：
 * 命令面板按 id/title 模糊匹配执行，快捷键中枢按单表映射分发，菜单栏按 id 引用执行。
 */
export interface AlukaCommand {
  id: string;
  /** 面板显示标题（中文） */
  title: string;
  /** 分类前缀（面板显示为「分类: 标题」，参与匹配） */
  category?: string;
  /** 归一化快捷键，如 ctrl+shift+p / ctrl+` */
  keybinding?: string;
  /**
   * 仅用于菜单/面板展示的组合键（不进入快捷键中枢）。
   * 适用于原生/Monaco 已绑定的按键（如 Ctrl+C、Ctrl+/），全局再拦截会双重触发。
   */
  displayKeybinding?: string;
  run: () => void | Promise<void>;
}

const registry = new Map<string, AlukaCommand>();

export function registerCommand(cmd: AlukaCommand): void {
  registry.set(cmd.id, cmd);
}

export function registerCommands(cmds: AlukaCommand[]): void {
  for (const c of cmds) registerCommand(c);
}

export function listCommands(): AlukaCommand[] {
  return [...registry.values()];
}

export function getCommand(id: string): AlukaCommand | null {
  return registry.get(id) ?? null;
}

/** 将快捷键字符串（如 "ctrl+`", "Ctrl+~", "ctrl+backslash"）统一归一化 */
export function normalizeKeybinding(kb: string): string {
  const parts = kb.toLowerCase().split("+");
  const mods: string[] = [];
  let main = "";
  for (const p of parts) {
    if (p === "ctrl" || p === "control") mods.push("ctrl");
    else if (p === "alt") mods.push("alt");
    else if (p === "shift") mods.push("shift");
    else if (p === "meta" || p === "win" || p === "cmd") mods.push("meta");
    else {
      if (p === "`" || p === "~" || p === "backquote") main = "backquote";
      else if (p === "\\" || p === "backslash") main = "backslash";
      else if (p === "-" || p === "minus") main = "minus";
      else if (p === "=" || p === "equal") main = "equal";
      else if (p === " " || p === "space") main = "space";
      else main = p;
    }
  }
  return mods.length > 0 ? [...mods, main].join("+") : main;
}

/** 归一化快捷键显示：ctrl+shift+p → Ctrl+Shift+P；符号键还原为可读符号 */
export function formatKeybinding(kb: string): string {
  return normalizeKeybinding(kb)
    .split("+")
    .map((p) =>
      p === "ctrl"
        ? "Ctrl"
        : p === "alt"
          ? "Alt"
          : p === "shift"
            ? "Shift"
            : p === "meta"
              ? "Win"
              : p === "backquote"
                ? "`"
                : p === "backslash"
                  ? "\\"
                  : p === "equal"
                    ? "="
                    : p === "minus"
                      ? "-"
                      : p.length === 1
                        ? p.toUpperCase()
                        : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join("+");
}

/**
 * 分发执行：记录最近使用；错误统一走编辑器区错误横幅。
 * 面板关闭逻辑在调用方（CommandPalette），此处只关心执行。
 */
export async function runCommand(id: string): Promise<void> {
  const cmd = registry.get(id);
  if (!cmd) {
    useEditorStore.getState().setError(`未注册的命令：${id}`);
    return;
  }
  pushRecent(id);
  try {
    await cmd.run();
  } catch (e) {
    useEditorStore.getState().setError(String(e));
  }
}

/* ---------------- 最近使用（localStorage，FR-07） ---------------- */

const RECENT_KEY = "aluka.recentCommands";
const RECENT_MAX = 8;

export function getRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  try {
    const list = [id, ...getRecentCommands().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
}

/* ---------------- 子序列模糊匹配（FR-07） ---------------- */

/**
 * 返回匹配得分；null = 不匹配（子序列）。
 * 加分项：连续命中递增、词首/分隔符后/大小写翻转处命中。
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  if (!q) return 0;
  const tl = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  let prev = -2;
  for (let ti = 0; ti < tl.length && qi < q.length; ti++) {
    if (tl[ti] !== q[qi]) continue;
    let bonus = 1;
    if (ti === prev + 1) {
      streak += 1;
      bonus += streak * 2;
    } else {
      streak = 0;
    }
    const pc = target[ti - 1];
    const boundary =
      ti === 0 ||
      (pc !== undefined && /[\\/\-_ .:]/.test(pc)) ||
      (target[ti] !== target[ti].toLowerCase() && pc !== undefined && pc === pc.toLowerCase());
    if (boundary) bonus += 4;
    score += bonus;
    prev = ti;
    qi += 1;
  }
  return qi === q.length ? score : null;
}

/* ---------------- 快捷键中枢（FR-08，单表映射） ---------------- */

/** e.code → 归一化主键（布局无关键位：反引号/减号等符号键的 e.key 随布局和 IME 变化） */
const CODE_MAIN: Record<string, string> = {
  Backquote: "backquote",
  Backslash: "backslash",
  Minus: "minus",
  Equal: "equal",
  Space: "space",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  PageUp: "pageup",
  PageDown: "pagedown",
};

/**
 * KeyboardEvent → 归一化组合键（mod+小写主键）。
 * 修饰键自身按下返回 null（不触发）。
 * 主键取值策略：优先 e.code 物理键位映射，保障在输入法/非英美布局下快捷键依然精准稳定。
 */
export function normalizeKeyEvent(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (k === "control" || k === "shift" || k === "alt" || k === "meta") return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  if (e.metaKey) mods.push("meta");
  let main: string;
  if (CODE_MAIN[e.code]) {
    main = CODE_MAIN[e.code];
  } else if (/^[a-z0-9]$/.test(k)) {
    main = k;
  } else if (k === " ") {
    main = "space";
  } else {
    main = k;
  }
  return mods.length > 0 ? [...mods, main].join("+") : main;
}

/** keybinding → commandId 单表（注册命令时自动派生） */
function keymap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of registry.values()) {
    if (c.keybinding) {
      const normalized = normalizeKeybinding(c.keybinding);
      m.set(normalized, c.id);
      // 特殊别名兼容：ctrl+backquote 自动支持 ctrl+shift+backquote（用户按 Ctrl+~ 时的实际组合键）
      if (normalized === "ctrl+backquote") {
        m.set("ctrl+shift+backquote", c.id);
      }
    }
  }
  return m;
}

/** 安装全局 keydown 监听；返回卸载函数 */
export function installKeybindingHub(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const combo = normalizeKeyEvent(e);
    if (!combo) return;
    const id = keymap().get(combo);
    if (!id) return;
    // 核心集一律优先于输入：Ctrl+S / Ctrl+W / Ctrl+` 等在编辑器内同样要生效
    e.preventDefault();
    void runCommand(id);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/* ---------------- 核心命令注册（M4 集） ---------------- */

function toggleQuickOpen(): void {
  const s = useAppStore.getState();
  s.togglePalette("files");
}

/* ---------------- 菜单命令辅助 ---------------- */

/** 执行活动编辑器的具名 Action；编辑器未聚焦或动作未注册时给出提示 */
function runEditorAction(actionId: string, missingHint: string): void {
  const ed = getActiveEditor();
  if (!ed) {
    showInfo(missingHint);
    return;
  }
  const action = ed.getAction(actionId);
  if (!action) {
    showInfo(`编辑器动作不可用：${actionId}`);
    return;
  }
  void action.run();
}

/** 触发活动编辑器的核心命令（如 undo/redo，非 Action 注册表成员） */
function editorTrigger(handlerId: string): void {
  getActiveEditor()?.trigger("menu", handlerId, null);
}

/** 活动文件扩展名 → 终端运行命令模板（{path} 占位） */
const RUN_TEMPLATES: Record<string, string> = {
  py: 'python "{path}"',
  python: 'python "{path}"',
  js: 'node "{path}"',
  mjs: 'node "{path}"',
  cjs: 'node "{path}"',
  go: 'go run "{path}"',
  rs: "cargo run",
  sh: 'bash "{path}"',
  bash: 'bash "{path}"',
  ps1: '& "{path}"',
  bat: 'cmd /c "{path}"',
  cmd: 'cmd /c "{path}"',
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 在终端中运行活动文件：先保存脏文件 → 确保终端会话 → 写入命令 */
async function runActiveFile(): Promise<void> {
  const app = useAppStore.getState();
  if (!app.workspaceRoot) {
    showInfo("请先打开文件夹再运行文件");
    return;
  }
  const path = useEditorStore.getState().activePath;
  if (!path || path.startsWith("diff:")) {
    showInfo("没有可运行的活动文件");
    return;
  }
  const name = path.split(/[\\/]/).pop() ?? path;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const tpl = RUN_TEMPLATES[ext];
  if (!tpl) {
    showInfo(`暂不支持运行 .${ext || "（无扩展名）"} 文件`);
    return;
  }
  await useEditorStore.getState().save(path);
  if (!app.panelOpen) {
    app.togglePanel();
    // 等待 xterm 挂载并订阅输出流，避免首屏输出丢失
    await delay(500);
  }
  const t = useTerminalStore.getState();
  const alive =
    t.sessions.find((s) => s.id === t.activeId && !s.closed) ??
    t.sessions.find((s) => !s.closed);
  const id = alive?.id ?? (await t.create(app.workspaceRoot, `运行 ${name}`));
  if (id == null) {
    showInfo("创建终端会话失败");
    return;
  }
  await delay(300);
  void t.write(id, tpl.replace("{path}", path) + "\r");
}

/** 新建文件/文件夹：工作区未打开时提示，否则交给资源管理器内联输入框 */
function requestExplorerEntry(kind: "newFile" | "newFolder"): void {
  const app = useAppStore.getState();
  if (!app.workspaceRoot) {
    showInfo("请先打开文件夹");
    return;
  }
  app.requestExplorer(kind);
}

/** 关闭工作区：保存并关闭全部编辑器与终端，回到未打开状态 */
async function closeWorkspace(): Promise<void> {
  const app = useAppStore.getState();
  if (!app.workspaceRoot) return;
  await useEditorStore.getState().saveAllDirty();
  useEditorStore.getState().closeAllTabs();
  // 先重置工作区再清终端：若先杀终端，Panel 在 workspaceRoot 尚为空档期间
  // 会因「sessions 为空」的自动创建条件重新建会话（竞态）
  app.closeWorkspace();
  const t = useTerminalStore.getState();
  for (const s of [...t.sessions]) await t.kill(s.id);
}

export function registerCoreCommands(): void {
  registerCommands([
    {
      id: "workbench.action.showCommands",
      title: "显示所有命令",
      category: "文件",
      keybinding: "ctrl+shift+p",
      run: () => useAppStore.getState().togglePalette("commands"),
    },
    {
      id: "workbench.action.quickOpen",
      title: "快速打开文件",
      category: "文件",
      keybinding: "ctrl+p",
      run: toggleQuickOpen,
    },
    {
      id: "workbench.action.files.save",
      title: "保存",
      category: "文件",
      keybinding: "ctrl+s",
      run: () => {
        const { activePath, save } = useEditorStore.getState();
        if (activePath) void save(activePath);
      },
    },
    {
      id: "workbench.action.files.openFolder",
      title: "打开文件夹…",
      category: "文件",
      run: async () => {
        const p = await openFolderDialog();
        if (p) useAppStore.getState().openWorkspace(p);
      },
    },
    {
      id: "workbench.action.files.saveAll",
      title: "全部保存",
      category: "文件",
      keybinding: "ctrl+shift+s",
      run: () => void useEditorStore.getState().saveAllDirty(),
    },
    {
      id: "workbench.action.closeActiveEditor",
      title: "关闭编辑器",
      category: "文件",
      keybinding: "ctrl+w",
      run: () => {
        const s = useEditorStore.getState();
        if (s.activePath) s.closeTab(s.activePath);
      },
    },
    {
      id: "workbench.action.splitEditorRight",
      title: "向右拆分编辑器",
      category: "查看",
      keybinding: "ctrl+backslash",
      run: () => useEditorStore.getState().splitGroup("horizontal"),
    },
    {
      id: "workbench.action.splitEditorDown",
      title: "向下拆分编辑器",
      category: "查看",
      run: () => useEditorStore.getState().splitGroup("vertical"),
    },
    {
      id: "workbench.action.focusFirstEditorGroup",
      title: "聚焦到第一编辑器组",
      category: "转到",
      keybinding: "ctrl+1",
      run: () => {
        const g = useEditorStore.getState().groups[0];
        if (g) useEditorStore.getState().setActiveGroup(g.id);
      },
    },
    {
      id: "workbench.action.focusSecondEditorGroup",
      title: "聚焦到第二编辑器组",
      category: "转到",
      keybinding: "ctrl+2",
      run: () => {
        const g = useEditorStore.getState().groups[1];
        if (g) useEditorStore.getState().setActiveGroup(g.id);
      },
    },
    {
      id: "workbench.action.closeActiveEditorGroup",
      title: "关闭编辑器组",
      category: "查看",
      run: () => {
        const s = useEditorStore.getState();
        if (s.groups.length > 1) s.closeGroup(s.activeGroupId);
      },
    },
    {
      id: "workbench.action.toggleEditorGroupLayout",
      title: "切换编辑器组布局（横向/纵向）",
      category: "查看",
      run: () => {
        const s = useEditorStore.getState();
        if (s.groups.length > 1) {
          s.setSplitDirection(s.layoutDirection === "horizontal" ? "vertical" : "horizontal");
        }
      },
    },
    {
      id: "workbench.action.nextEditor",
      title: "下一个编辑器",
      category: "转到",
      keybinding: "ctrl+pagedown",
      run: () => cycleTab(1),
    },
    {
      id: "workbench.action.previousEditor",
      title: "上一个编辑器",
      category: "转到",
      keybinding: "ctrl+pageup",
      run: () => cycleTab(-1),
    },
    {
      id: "workbench.action.toggleSidebarVisibility",
      title: "切换侧边栏",
      category: "查看",
      keybinding: "ctrl+b",
      run: () => useAppStore.getState().toggleSidebar(),
    },
    {
      id: "workbench.action.togglePanel",
      title: "切换底部面板",
      category: "查看",
      keybinding: "ctrl+`",
      run: () => useAppStore.getState().togglePanel(),
    },
    {
      id: "workbench.view.explorer",
      title: "资源管理器",
      category: "查看",
      keybinding: "ctrl+shift+e",
      run: () => useAppStore.getState().selectView("explorer"),
    },
    {
      id: "workbench.view.search",
      title: "搜索",
      category: "查看",
      keybinding: "ctrl+shift+f",
      run: () => useAppStore.getState().selectView("search"),
    },
    {
      id: "workbench.view.scm",
      title: "源代码管理",
      category: "查看",
      keybinding: "ctrl+shift+g",
      run: () => useAppStore.getState().selectView("scm"),
    },
    {
      id: "git.refresh",
      title: "Git: 刷新",
      category: "Git",
      run: () => {
        const root = useAppStore.getState().workspaceRoot;
        if (root) void useGitStore.getState().refresh(root);
      },
    },
    {
      id: "git.push",
      title: "Git: 推送 (Push)",
      category: "Git",
      run: () => {
        const root = useAppStore.getState().workspaceRoot;
        if (root) void useGitStore.getState().push(root);
      },
    },
    {
      id: "git.pull",
      title: "Git: 拉取 (Pull)",
      category: "Git",
      run: () => {
        const root = useAppStore.getState().workspaceRoot;
        if (root) void useGitStore.getState().pull(root);
      },
    },
    {
      id: "workbench.view.extensions",
      title: "扩展",
      category: "查看",
      keybinding: "ctrl+shift+x",
      run: () => useAppStore.getState().selectView("extensions"),
    },
    {
      id: "workbench.action.selectTheme",
      title: "颜色主题…",
      category: "首选项",
      run: () => useAppStore.getState().togglePalette("commands"),
    },
    {
      id: "aluka.theme.dark",
      title: "Dark+（暗色）",
      category: "主题",
      run: () => useSettingsStore.getState().update({ theme: "dark-plus" }),
    },
    {
      id: "aluka.theme.light",
      title: "Light+（亮色）",
      category: "主题",
      run: () => useSettingsStore.getState().update({ theme: "light-plus" }),
    },

    /* ---------------- 文件菜单 ---------------- */
    {
      id: "workbench.action.files.new",
      title: "新建文本文件",
      category: "文件",
      keybinding: "ctrl+n",
      run: () => requestExplorerEntry("newFile"),
    },
    {
      id: "workbench.action.files.newFolder",
      title: "新建文件夹",
      category: "文件",
      keybinding: "ctrl+shift+n",
      run: () => requestExplorerEntry("newFolder"),
    },
    {
      id: "workbench.action.closeFolder",
      title: "关闭文件夹",
      category: "文件",
      run: () => void closeWorkspace(),
    },
    {
      id: "workbench.action.closeAllEditors",
      title: "关闭所有编辑器",
      category: "文件",
      run: () => useEditorStore.getState().closeAllTabs(),
    },
    {
      id: "workbench.action.quit",
      title: "退出",
      category: "文件",
      run: () => {
        try {
          void getCurrentWindow().close();
        } catch {
          showInfo("退出：仅 Tauri 应用内可用");
        }
      },
    },

    /* ---------------- 编辑菜单 ---------------- */
    {
      id: "edit.undo",
      title: "撤销",
      category: "编辑",
      displayKeybinding: "Ctrl+Z",
      run: () => editorTrigger("undo"),
    },
    {
      id: "edit.redo",
      title: "重做",
      category: "编辑",
      displayKeybinding: "Ctrl+Y",
      run: () => editorTrigger("redo"),
    },
    {
      id: "edit.cut",
      title: "剪切",
      category: "编辑",
      displayKeybinding: "Ctrl+X",
      run: () => runEditorAction("editor.action.clipboardCutAction", "剪切：请先聚焦编辑器"),
    },
    {
      id: "edit.copy",
      title: "复制",
      category: "编辑",
      displayKeybinding: "Ctrl+C",
      run: () => runEditorAction("editor.action.clipboardCopyAction", "复制：请先聚焦编辑器"),
    },
    {
      id: "edit.paste",
      title: "粘贴",
      category: "编辑",
      displayKeybinding: "Ctrl+V",
      run: () => runEditorAction("editor.action.clipboardPasteAction", "粘贴：请先聚焦编辑器"),
    },
    {
      id: "edit.find",
      title: "查找",
      category: "编辑",
      displayKeybinding: "Ctrl+F",
      run: () => runEditorAction("actions.find", "查找：请先聚焦编辑器"),
    },
    {
      id: "edit.replace",
      title: "替换",
      category: "编辑",
      displayKeybinding: "Ctrl+H",
      run: () => runEditorAction("editor.action.startFindReplaceAction", "替换：请先聚焦编辑器"),
    },
    {
      id: "edit.commentLine",
      title: "切换行注释",
      category: "编辑",
      displayKeybinding: "Ctrl+/",
      run: () => runEditorAction("editor.action.commentLine", "行注释：请先聚焦编辑器"),
    },
    {
      id: "edit.blockComment",
      title: "切换块注释",
      category: "编辑",
      displayKeybinding: "Shift+Alt+A",
      run: () => runEditorAction("editor.action.blockComment", "块注释：请先聚焦编辑器"),
    },

    /* ---------------- 选择菜单 ---------------- */
    {
      id: "editor.action.selectAll",
      title: "全选",
      category: "选择",
      displayKeybinding: "Ctrl+A",
      run: () => {
        const ed = getActiveEditor();
        const model = ed?.getModel();
        if (ed && model) {
          ed.setSelection(model.getFullModelRange());
          ed.focus();
        }
      },
    },
    {
      id: "editor.action.insertCursorAbove",
      title: "在上面添加光标",
      category: "选择",
      displayKeybinding: "Ctrl+Alt+↑",
      run: () => runEditorAction("editor.action.insertCursorAbove", "多光标：请先聚焦编辑器"),
    },
    {
      id: "editor.action.insertCursorBelow",
      title: "在下面添加光标",
      category: "选择",
      displayKeybinding: "Ctrl+Alt+↓",
      run: () => runEditorAction("editor.action.insertCursorBelow", "多光标：请先聚焦编辑器"),
    },
    {
      id: "editor.action.addSelectionToNextFindMatch",
      title: "添加下一个匹配项",
      category: "选择",
      displayKeybinding: "Ctrl+D",
      run: () =>
        runEditorAction("editor.action.addSelectionToNextFindMatch", "多光标：请先聚焦编辑器"),
    },
    {
      id: "editor.action.smartSelect.expand",
      title: "扩大选择",
      category: "选择",
      displayKeybinding: "Shift+Alt+→",
      run: () => runEditorAction("editor.action.smartSelect.expand", "扩大选择：请先聚焦编辑器"),
    },

    /* ---------------- 查看菜单 ---------------- */
    {
      id: "view.zoomIn",
      title: "放大编辑器字体",
      category: "查看",
      keybinding: "ctrl+=",
      run: () => {
        const s = useSettingsStore.getState();
        s.update({ fontSize: Math.min(40, s.fontSize + 2) });
      },
    },
    {
      id: "view.zoomOut",
      title: "缩小编辑器字体",
      category: "查看",
      keybinding: "ctrl+-",
      run: () => {
        const s = useSettingsStore.getState();
        s.update({ fontSize: Math.max(8, s.fontSize - 2) });
      },
    },
    {
      id: "view.zoomReset",
      title: "重置编辑器字体",
      category: "查看",
      keybinding: "ctrl+0",
      run: () => useSettingsStore.getState().update({ fontSize: 14 }),
    },

    /* ---------------- 转到菜单 ---------------- */
    {
      id: "workbench.action.gotoLine",
      title: "转到行/列…",
      category: "转到",
      displayKeybinding: "Ctrl+G",
      run: () => useAppStore.getState().setPalette("goto"),
    },

    /* ---------------- 运行菜单 ---------------- */
    {
      id: "run.activeFile",
      title: "在终端中运行活动文件",
      category: "运行",
      run: () => void runActiveFile(),
    },

    /* ---------------- 终端菜单 ---------------- */
    {
      id: "terminal.new",
      title: "新建终端",
      category: "终端",
      keybinding: "ctrl+shift+`",
      run: () => {
        const app = useAppStore.getState();
        if (!app.workspaceRoot) {
          showInfo("请先打开文件夹再使用终端");
          return;
        }
        const t = useTerminalStore.getState();
        // 先建会话再开面板：Panel 首开自动建会话的条件（sessions 为空）即不成立，避免双重创建
        void t.create(app.workspaceRoot, `PowerShell ${t.sessions.length + 1}`).then((id) => {
          if (id != null && !app.panelOpen) app.togglePanel();
        });
      },
    },
    {
      id: "terminal.killActive",
      title: "关闭当前终端",
      category: "终端",
      run: () => {
        const t = useTerminalStore.getState();
        if (t.activeId != null) void t.kill(t.activeId);
        else showInfo("当前没有终端会话");
      },
    },
    {
      id: "terminal.clear",
      title: "清空终端",
      category: "终端",
      run: () => {
        const t = useTerminalStore.getState();
        if (t.activeId == null) {
          showInfo("当前没有终端会话");
          return;
        }
        clearTerminalView(t.activeId);
      },
    },

    /* ---------------- 帮助菜单 ---------------- */
    {
      id: "help.about",
      title: "关于",
      category: "帮助",
      run: () =>
        showInfo(
          `Aluka IDE v${pkg.version} — 轻量级 IDE（Rust + Tauri 2 + React 18 + Monaco Editor），兼容 VS Code 插件子集`,
        ),
    },
  ]);
}

/** Ctrl+PageUp/PageDown 在标签间循环（CodeEditor 渲染期同步会自动聚焦编辑器） */
function cycleTab(dir: 1 | -1): void {
  const s = useEditorStore.getState();
  if (s.tabs.length < 2 || !s.activePath) return;
  const idx = s.tabs.findIndex((t) => t.path === s.activePath);
  const next = (idx + dir + s.tabs.length) % s.tabs.length;
  s.setActive(s.tabs[next].path);
}
