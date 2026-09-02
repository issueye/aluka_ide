import { useAppStore } from "./store";
import { useEditorStore } from "./editorStore";
import { useSettingsStore } from "./settingsStore";
import { openFolderDialog } from "./tauri";

/**
 * 命令注册表 + 快捷键中枢（M4 / FR-07、FR-08）。
 * 核心命令与后续扩展命令（M6）共用此统一入口：
 * 命令面板按 id/title 模糊匹配执行，快捷键中枢按单表映射分发。
 */
export interface AlukaCommand {
  id: string;
  /** 面板显示标题（中文） */
  title: string;
  /** 分类前缀（面板显示为「分类: 标题」，参与匹配） */
  category?: string;
  /** 归一化快捷键，如 ctrl+shift+p / ctrl+` */
  keybinding?: string;
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

/** 归一化快捷键显示：ctrl+shift+p → Ctrl+Shift+P */
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
      category: "查看",
      keybinding: "ctrl+1",
      run: () => {
        const g = useEditorStore.getState().groups[0];
        if (g) useEditorStore.getState().setActiveGroup(g.id);
      },
    },
    {
      id: "workbench.action.focusSecondEditorGroup",
      title: "聚焦到第二编辑器组",
      category: "查看",
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
      category: "查看",
      keybinding: "ctrl+pagedown",
      run: () => cycleTab(1),
    },
    {
      id: "workbench.action.previousEditor",
      title: "上一个编辑器",
      category: "查看",
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
