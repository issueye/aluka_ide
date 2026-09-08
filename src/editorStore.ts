import { create } from "zustand";
import monaco, { languageOf } from "./monaco-setup";
import { readFile, writeFile, saveAll } from "./tauri";

/** 拒绝打开阈值（与 Rust 端 READ_MAX_BYTES 对齐，双保险） */
const MAX_BYTES = 20 * 1024 * 1024;

/** 行跳转信号（搜索结果点击/代码跳转 → 打开/定位）：seq 变化驱动 CodeEditor 副作用 */
interface RevealState {
  seq: number;
  path: string | null;
  line: number;
  col: number;
}
export const useRevealStore = create<RevealState>(() => ({ seq: 0, path: null, line: 0, col: 1 }));

/** 请求把某文件定位到某行某列（文件需已 openFile；由 CodeEditor 消费） */
export function requestReveal(path: string, line: number, col = 1): void {
  useRevealStore.setState((s) => ({ seq: s.seq + 1, path, line, col }));
}

export interface EditorTab {
  path: string;
  name: string;
  language: string;
  readOnly: boolean;
  isDiff?: boolean;
  diffOriginal?: string;
  diffModified?: string;
  /**
   * 预览标签（VS Code enablePreview 语义）：单击打开为 true（斜体显示），
   * 再次打开其他文件时原位替换；变脏或显式 pin 后转常驻。
   */
  preview?: boolean;
}

/** openFile 选项：preview=false 表示以常驻方式打开（双击文件/保持打开） */
export interface OpenFileOptions {
  preview?: boolean;
}

export interface EditorGroup {
  id: string;
  tabs: EditorTab[];
  activePath: string | null;
}

export type SplitDirection = "single" | "horizontal" | "vertical";

export interface ClosePrompt {
  path: string;
  groupId: string;
}

/** 外部变更冲突提示：diskContent 为 null 表示文件已被外部删除 */
export interface ExternalChangePrompt {
  path: string;
  diskContent: string | null;
  readonly: boolean;
}

/**
 * 编辑器状态：标签页、编辑器组与脏标记。
 * Monaco model 按文件路径（Uri）缓存于模块级 Map——
 * 切换标签只换 model，天然保留脏状态与撤销栈；同一个文件在不同组打开时共享 Model；
 * 视图态按 `${groupId}:${path}` 隔离存储到 viewStates。
 */
const models = new Map<string, monaco.editor.ITextModel>();
const savedVersionIds = new Map<string, number>();
export const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
/** 正在打开的文件（防止并发 openFile 对同一 Uri 重复 createModel） */
const loadingPaths = new Set<string>();
/** Monaco 不可用时的纯文本草稿（降级编辑模式） */
const fallbackDrafts = new Map<string, string>();
/** 降级草稿版本号：外部重载后驱动 textarea 重新挂载 */
const fallbackVersions = new Map<string, number>();
/** 正在以磁盘内容重载的 Model（抑制 setValue 触发的脏标记） */
const reloadingPaths = new Set<string>();

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? p) : p;
}

export function getDraft(path: string): string {
  return fallbackDrafts.get(path) ?? "";
}

export function setDraft(path: string, value: string): void {
  fallbackDrafts.set(path, value);
}

/** 降级草稿当前版本（外部重载时递增，CodeEditor 用 key 触发重挂载） */
export function getFallbackVersion(path: string): number {
  return fallbackVersions.get(path) ?? 0;
}

function bumpFallbackVersion(path: string): void {
  fallbackVersions.set(path, (fallbackVersions.get(path) ?? 0) + 1);
}

/** 会话恢复快照：最近打开的编辑器标签（用于开发 HMR/应用重载后自动恢复） */
export interface EditorSession {
  paths: string[];
  activePath: string | null;
}

const SESSION_KEY = "aluka.lastTabs";

export function saveEditorSession(session: EditorSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
}

export function loadEditorSession(): EditorSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const record = obj as { paths?: unknown; activePath?: unknown };
    const paths = Array.isArray(record.paths)
      ? record.paths.filter((p): p is string => typeof p === "string")
      : [];
    const activePath = typeof record.activePath === "string" ? record.activePath : null;
    return { paths, activePath };
  } catch {
    return null;
  }
}

export function clearEditorSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 用磁盘内容替换 Model 内容，不产生脏标记（外部刷新/重新加载共用） */
function replaceModelContent(path: string, content: string): void {
  const model = models.get(path);
  if (!model) return;
  reloadingPaths.add(path);
  try {
    model.setValue(content);
  } finally {
    reloadingPaths.delete(path);
  }
  savedVersionIds.set(path, model.getAlternativeVersionId());
}

/** 读取文件当前内容（Monaco model 优先，降级模式读草稿） */
export function getContent(path: string): string {
  return models.get(path)?.getValue() ?? fallbackDrafts.get(path) ?? "";
}

/** 订阅文件内容变更（Monaco model 事件；降级模式返回空卸载函数） */
export function subscribeContent(path: string, cb: () => void): () => void {
  const m = models.get(path);
  if (!m) return () => {};
  const d = m.onDidChangeContent(() => cb());
  return () => d.dispose();
}

/** 标记脏状态（降级模式由 textarea onChange 调用） */
export function markDirty(path: string, dirty: boolean): void {
  const s = useEditorStore.getState();
  if (s.dirtyPaths.has(path) === dirty) return;
  const dirtyPaths = new Set(s.dirtyPaths);
  if (dirty) dirtyPaths.add(path);
  else dirtyPaths.delete(path);
  useEditorStore.setState({ dirtyPaths });
  // 变脏的预览标签自动转常驻（VS Code 行为：编辑即固定）
  if (dirty) pinPreviewTabs(path);
}

/** 清除指定文件在所有组内的预览标记（变脏/保持打开共用） */
function pinPreviewTabs(path: string): void {
  const s = useEditorStore.getState();
  if (!s.groups.some((g) => g.tabs.some((t) => t.path === path && t.preview))) return;
  const groups = s.groups.map((g) =>
    g.tabs.some((t) => t.path === path && t.preview)
      ? { ...g, tabs: g.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)) }
      : g,
  );
  useEditorStore.setState({ groups });
}

export function getModel(path: string): monaco.editor.ITextModel | null {
  return models.get(path) ?? null;
}

function tabName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function isPathOpenInAnyGroup(groups: EditorGroup[], path: string): boolean {
  return groups.some((g) => g.tabs.some((t) => t.path === path));
}

function deriveActiveState(groups: EditorGroup[], activeGroupId: string) {
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  return {
    tabs: activeGroup ? [...activeGroup.tabs] : [],
    activePath: activeGroup?.activePath ?? null,
  };
}

interface EditorStore {
  groups: EditorGroup[];
  activeGroupId: string;
  layoutDirection: SplitDirection;
  splitRatio: number; // 0.15 ~ 0.85，默认 0.5
  dirtyPaths: Set<string>;
  error: string | null;
  closePrompt: ClosePrompt | null;
  /** 兼容旧代码判断：待确认关闭的文件路径 */
  closePromptPath: string | null;
  /** 外部变更冲突/删除提示 */
  externalChangePrompt: ExternalChangePrompt | null;
  /** Markdown 预览态：已进入预览的标签路径集合 */
  previewPaths: Set<string>;

  // 向后兼容当前活动组状态
  tabs: EditorTab[];
  activePath: string | null;

  openFile: (path: string, groupId?: string, opts?: OpenFileOptions) => Promise<void>;
  openDiff: (path: string, original: string, modified: string, title?: string, targetGroupId?: string) => void;
  closeTab: (path: string, groupId?: string) => boolean;
  resolveClose: (choice: "save" | "discard" | "cancel" | { path: string; choice: "save" | "discard" | "cancel" }) => Promise<void>;
  resolveExternalChange: (choice: "keep" | "reload" | "overwrite" | "close") => Promise<void>;
  setActiveTab: (path: string, groupId?: string) => void;
  setActive: (path: string) => void;
  setActiveGroup: (groupId: string) => void;
  splitGroup: (direction: "horizontal" | "vertical", sourceGroupId?: string) => void;
  closeGroup: (groupId: string) => void;
  setSplitRatio: (ratio: number) => void;
  setSplitDirection: (direction: SplitDirection) => void;
  save: (path: string) => Promise<void>;
  saveAllDirty: () => Promise<void>;
  closeAllTabs: () => void;
  setError: (msg: string | null) => void;
  forceClose: (path: string, groupId?: string) => void;
  /** 预览标签转常驻（标签双击 / 右键「保持打开」/ 资源管理器双击打开） */
  pinTab: (path: string, groupId?: string) => void;
  /** Markdown 预览：切换指定 md 标签的预览态（非 md 文件忽略） */
  togglePreview: (path: string) => void;
  /** Markdown 预览：path 是否为 md 文件 */
  isMarkdownPath: (path: string | null) => boolean;
}

const DEFAULT_GROUP: EditorGroup = {
  id: "group-1",
  tabs: [],
  activePath: null,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  groups: [DEFAULT_GROUP],
  activeGroupId: "group-1",
  layoutDirection: "single",
  splitRatio: 0.5,
  dirtyPaths: new Set(),
  error: null,
  closePrompt: null,
  closePromptPath: null,
  externalChangePrompt: null,
  previewPaths: new Set(),

  tabs: [],
  activePath: null,

  openFile: async (path, targetGroupId, opts) => {
    const preview = opts?.preview ?? true;
    const s = get();
    const gId = targetGroupId ?? s.activeGroupId;
    const targetGroup = s.groups.find((g) => g.id === gId) ?? s.groups[0];

    // 如果已经在目标组打开：激活即可；显式以常驻方式打开（preview=false）时顺带转常驻。
    // 注意已常驻的标签不因一次预览打开而降级为预览。
    const existingTab = targetGroup?.tabs.find((t) => t.path === path);
    if (targetGroup && existingTab) {
      const needPin = !preview && existingTab.preview;
      const nextGroups = s.groups.map((g) => {
        if (g.id !== targetGroup.id) return g;
        const tabs = needPin
          ? g.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t))
          : g.tabs;
        return { ...g, tabs, activePath: path };
      });
      set({
        groups: nextGroups,
        activeGroupId: targetGroup.id,
        ...deriveActiveState(nextGroups, targetGroup.id),
      });
      return;
    }

    if (loadingPaths.has(path)) return;
    loadingPaths.add(path);
    try {
      const file = await readFile(path);
      const name = tabName(path);
      if (file.isBinary) {
        set({ error: `“${name}” 是二进制文件，暂不支持预览` });
        return;
      }
      if (file.size > MAX_BYTES) {
        set({ error: `“${name}” 超过 20MB，拒绝打开` });
        return;
      }
      const tab: EditorTab = {
        path,
        name,
        language: languageOf(path),
        readOnly: file.readonly,
      };

      // 全局共享同一个 Model：如果已存在直接复用，否则创建新 Model
      let model = models.get(path);
      if (!model) {
        const uri = monaco.Uri.file(path);
        model =
          monaco.editor.getModel(uri) ??
          monaco.editor.createModel(file.content, tab.language, uri);
        models.set(path, model);
        if (!/\r\n/.test(model.getValue())) {
          model.setEOL(monaco.editor.EndOfLineSequence.LF);
        } else {
          model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
        }
        fallbackDrafts.set(path, model.getValue());
        savedVersionIds.set(path, model.getAlternativeVersionId());
        model.onDidChangeContent(() => {
          if (reloadingPaths.has(path)) return;
          const m = models.get(path);
          if (!m) return;
          const dirty = m.getAlternativeVersionId() !== savedVersionIds.get(path);
          const dirtyPaths = new Set(get().dirtyPaths);
          if (dirty) dirtyPaths.add(path);
          else dirtyPaths.delete(path);
          set({ dirtyPaths });
          // 变脏的预览标签自动转常驻（VS Code 行为：编辑即固定）
          if (dirty) pinPreviewTabs(path);
        });
      }

      const curState = get();
      const currentGId = targetGroupId ?? curState.activeGroupId;
      const newTab: EditorTab = { ...tab, preview };
      // 被替换的预览标签（对象持有者避开闭包赋值的类型收窄问题）
      const replaced: { groupId: string; path: string } = { groupId: "", path: "" };

      const nextGroups = curState.groups.map((g) => {
        if (g.id !== currentGId) return g;
        // 预览打开：原位替换组内未变脏的既有预览标签（VS Code enablePreview 行为）
        if (preview) {
          const idx = g.tabs.findIndex((t) => t.preview && !curState.dirtyPaths.has(t.path));
          if (idx >= 0) {
            const oldTab = g.tabs[idx];
            replaced.groupId = g.id;
            replaced.path = oldTab.path;
            const tabs = [...g.tabs];
            tabs[idx] = newTab;
            return { ...g, tabs, activePath: path };
          }
        }
        return { ...g, tabs: [...g.tabs, newTab], activePath: path };
      });

      // 被替换的预览标签：清理视图态；不再被任何组打开时释放 Model
      if (replaced.path) {
        const oldPath = replaced.path;
        viewStates.delete(`${replaced.groupId}:${oldPath}`);
        if (!isPathOpenInAnyGroup(nextGroups, oldPath)) {
          models.get(oldPath)?.dispose();
          models.delete(oldPath);
          savedVersionIds.delete(oldPath);
          viewStates.delete(oldPath);
        }
      }

      set({
        groups: nextGroups,
        activeGroupId: currentGId,
        ...deriveActiveState(nextGroups, currentGId),
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      loadingPaths.delete(path);
    }
  },

  openDiff: (path, original, modified, title, targetGroupId) => {
    const s = get();
    const gId = targetGroupId ?? s.activeGroupId;
    const targetGroup = s.groups.find((g) => g.id === gId) ?? s.groups[0];
    const diffPath = `diff:${path}`;
    const diffName = title ?? `${baseName(path)} (差异对比)`;
    const lang = languageOf(path);

    const existingTab = targetGroup?.tabs.find((t) => t.path === diffPath);
    let nextTabs: EditorTab[];
    if (existingTab) {
      nextTabs = (targetGroup?.tabs ?? []).map((t) =>
        t.path === diffPath ? { ...t, diffOriginal: original, diffModified: modified } : t,
      );
    } else {
      const newTab: EditorTab = {
        path: diffPath,
        name: diffName,
        language: lang,
        readOnly: true,
        isDiff: true,
        diffOriginal: original,
        diffModified: modified,
      };
      nextTabs = [...(targetGroup?.tabs ?? []), newTab];
    }

    const nextGroups = s.groups.map((g) =>
      g.id === (targetGroup?.id ?? gId) ? { ...g, tabs: nextTabs, activePath: diffPath } : g,
    );
    set({
      groups: nextGroups,
      activeGroupId: targetGroup?.id ?? gId,
      ...deriveActiveState(nextGroups, targetGroup?.id ?? gId),
    });
  },

  closeTab: (path, groupId) => {
    const s = get();
    const gId = groupId ?? s.activeGroupId;
    // 如果此文件是脏文件，并且在该组被关闭，弹窗确认
    if (s.dirtyPaths.has(path)) {
      set({ closePrompt: { path, groupId: gId }, closePromptPath: path });
      return false;
    }
    get().forceClose(path, gId);
    return true;
  },

  resolveClose: async (arg) => {
    const prompt = get().closePrompt;
    set({ closePrompt: null, closePromptPath: null });
    const choice = typeof arg === "string" ? arg : arg.choice;
    if (!prompt || choice === "cancel") return;
    if (choice === "save") await get().save(prompt.path);
    get().forceClose(prompt.path, prompt.groupId);
  },

  resolveExternalChange: async (choice) => {
    const prompt = get().externalChangePrompt;
    set({ externalChangePrompt: null });
    if (!prompt) return;
    const { path, diskContent, readonly } = prompt;
    if (choice === "keep") return;
    if (choice === "close") {
      for (const g of [...get().groups]) get().forceClose(path, g.id);
      return;
    }
    if (diskContent === null) return;
    if (choice === "overwrite") {
      await get().save(path);
      return;
    }
    // choice === "reload"：以磁盘内容覆盖编辑器，并清掉脏标记
    replaceModelContent(path, diskContent);
    fallbackDrafts.set(path, diskContent);
    bumpFallbackVersion(path);
    const s = get();
    const dirtyPaths = new Set(s.dirtyPaths);
    dirtyPaths.delete(path);
    const groups = s.groups.map((g) =>
      g.tabs.some((t) => t.path === path)
        ? { ...g, tabs: g.tabs.map((t) => (t.path === path ? { ...t, readOnly: readonly } : t)) }
        : g,
    );
    set({ dirtyPaths, groups, ...deriveActiveState(groups, s.activeGroupId) });
  },

  setActiveTab: (path, groupId) => {
    const s = get();
    const gId = groupId ?? s.activeGroupId;
    const nextGroups = s.groups.map((g) => (g.id === gId ? { ...g, activePath: path } : g));
    set({
      groups: nextGroups,
      activeGroupId: gId,
      ...deriveActiveState(nextGroups, gId),
    });
  },

  setActive: (path) => {
    get().setActiveTab(path);
  },

  setActiveGroup: (groupId) => {
    const s = get();
    if (s.activeGroupId === groupId) return;
    if (!s.groups.some((g) => g.id === groupId)) return;
    set({
      activeGroupId: groupId,
      ...deriveActiveState(s.groups, groupId),
    });
  },

  splitGroup: (direction, sourceGroupId) => {
    const s = get();
    const srcGId = sourceGroupId ?? s.activeGroupId;
    const srcGroup = s.groups.find((g) => g.id === srcGId) ?? s.groups[0];

    // 如果当前已经是两个组，仅切换方向或将焦点切到第二组
    if (s.groups.length >= 2) {
      if (s.layoutDirection !== direction) {
        set({ layoutDirection: direction });
      } else {
        const nextId = s.groups.find((g) => g.id !== s.activeGroupId)?.id ?? s.groups[0].id;
        get().setActiveGroup(nextId);
      }
      return;
    }

    // 从单个组拆分成两个组
    const newGroupId = "group-2";
    // 把当前活动 tab 复制一份到新组
    const activeTab = srcGroup.tabs.find((t) => t.path === srcGroup.activePath);
    const newGroup: EditorGroup = {
      id: newGroupId,
      tabs: activeTab ? [activeTab] : [],
      activePath: activeTab?.path ?? null,
    };

    const nextGroups = [srcGroup, newGroup];
    set({
      groups: nextGroups,
      layoutDirection: direction,
      splitRatio: 0.5,
      activeGroupId: newGroupId,
      ...deriveActiveState(nextGroups, newGroupId),
    });
  },

  closeGroup: (groupId) => {
    const s = get();
    if (s.groups.length <= 1) return;
    const remainingGroups = s.groups.filter((g) => g.id !== groupId);
    const nextActiveId = remainingGroups[0].id;

    // 清理仅在被关闭组打开且未保存的 model / viewStates
    const closingGroup = s.groups.find((g) => g.id === groupId);
    if (closingGroup) {
      for (const tab of closingGroup.tabs) {
        if (!isPathOpenInAnyGroup(remainingGroups, tab.path)) {
          const model = models.get(tab.path);
          model?.dispose();
          models.delete(tab.path);
          savedVersionIds.delete(tab.path);
          viewStates.delete(`${groupId}:${tab.path}`);
          viewStates.delete(tab.path);
        }
      }
    }

    set({
      groups: remainingGroups,
      layoutDirection: "single",
      activeGroupId: nextActiveId,
      ...deriveActiveState(remainingGroups, nextActiveId),
    });
  },

  setSplitRatio: (ratio) => {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    set({ splitRatio: clamped });
  },

  setSplitDirection: (direction) => {
    if (direction === "single") {
      const s = get();
      if (s.groups.length > 1) {
        get().closeGroup(s.groups[1].id);
      } else {
        set({ layoutDirection: "single" });
      }
    } else {
      set({ layoutDirection: direction });
    }
  },

  save: async (path) => {
    const model = models.get(path);
    const content = model ? model.getValue() : (fallbackDrafts.get(path) ?? null);
    if (content === null) return;
    try {
      await writeFile(path, content);
      if (model) savedVersionIds.set(path, model.getAlternativeVersionId());
      const dirtyPaths = new Set(get().dirtyPaths);
      dirtyPaths.delete(path);
      set({ dirtyPaths });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveAllDirty: async () => {
    const dirty = [...get().dirtyPaths];
    if (dirty.length === 0) return;
    const items: { path: string; content: string }[] = [];
    for (const p of dirty) {
      const model = models.get(p);
      const content = model ? model.getValue() : fallbackDrafts.get(p);
      if (content === undefined) continue;
      items.push({ path: p, content });
    }
    if (items.length === 0) return;
    try {
      await saveAll(items);
      for (const it of items) {
        const model = models.get(it.path);
        if (model) savedVersionIds.set(it.path, model.getAlternativeVersionId());
      }
      set({ dirtyPaths: new Set() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setError: (msg) => set({ error: msg }),

  /** 关闭全部编辑器：脏文件沿用三选确认弹窗（首个脏文件弹窗后中断，用户处理后可再次执行） */
  closeAllTabs: () => {
    const s = get();
    for (const g of s.groups) {
      for (const t of [...g.tabs]) {
        if (!get().closeTab(t.path, g.id)) return;
      }
    }
  },

  forceClose: (path, targetGroupId) => {
    const s = get();
    const gId = targetGroupId ?? s.activeGroupId;
    let nextGroups = s.groups.map((g) => {
      if (g.id !== gId) return g;
      const idx = g.tabs.findIndex((t) => t.path === path);
      const newTabs = g.tabs.filter((t) => t.path !== path);
      let newActive = g.activePath;
      if (newActive === path) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null;
      }
      return {
        ...g,
        tabs: newTabs,
        activePath: newActive,
      };
    });

    // 如果处于分屏且被关闭组的 tabs 已全部清空，自动关闭该分屏组
    const closingGroup = nextGroups.find((g) => g.id === gId);
    let layoutDirection = s.layoutDirection;
    let activeGroupId = s.activeGroupId;
    if (nextGroups.length > 1 && closingGroup && closingGroup.tabs.length === 0) {
      nextGroups = nextGroups.filter((g) => g.id !== gId);
      layoutDirection = "single";
      activeGroupId = nextGroups[0].id;
    }

    // 视图状态清理
    viewStates.delete(`${gId}:${path}`);

    // 如果所有组都不再打开此文件，释放 Model
    if (!isPathOpenInAnyGroup(nextGroups, path)) {
      const model = models.get(path);
      model?.dispose();
      models.delete(path);
      savedVersionIds.delete(path);
      viewStates.delete(path);
      const dirtyPaths = new Set(s.dirtyPaths);
      dirtyPaths.delete(path);
      set({
        groups: nextGroups,
        layoutDirection,
        activeGroupId,
        dirtyPaths,
        ...deriveActiveState(nextGroups, activeGroupId),
      });
    } else {
      set({
        groups: nextGroups,
        layoutDirection,
        activeGroupId,
        ...deriveActiveState(nextGroups, activeGroupId),
      });
    }
  },

  pinTab: (path, groupId) => {
    const s = get();
    const gId = groupId ?? s.activeGroupId;
    if (!s.groups.some((g) => g.id === gId && g.tabs.some((t) => t.path === path && t.preview))) {
      return;
    }
    const groups = s.groups.map((g) =>
      g.id === gId
        ? { ...g, tabs: g.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)) }
        : g,
    );
    set({ groups });
  },

  togglePreview: (path) => {
    if (!isMarkdownFile(path)) return;
    const next = new Set(get().previewPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ previewPaths: next });
  },

  isMarkdownPath: (path) => (path ? isMarkdownFile(path) : false),
}));

/** 用磁盘内容覆盖已打开的编辑器（外部变更自动刷新 / 用户选择重新加载共用） */
function applyReload(path: string, content: string, readOnly: boolean): void {
  replaceModelContent(path, content);
  fallbackDrafts.set(path, content);
  bumpFallbackVersion(path);
  const s = useEditorStore.getState();
  const dirtyPaths = new Set(s.dirtyPaths);
  dirtyPaths.delete(path);
  const groups = s.groups.map((g) =>
    g.tabs.some((t) => t.path === path)
      ? { ...g, tabs: g.tabs.map((t) => (t.path === path ? { ...t, readOnly } : t)) }
      : g,
  );
  useEditorStore.setState({ dirtyPaths, groups, ...deriveActiveState(groups, s.activeGroupId) });
}

/**
 * 磁盘变更 → 编辑器刷新（App 在 workspace:changed 中调用；也可作手动「从磁盘重新载入」）。
 * 未变脏且内容不同时自动重载；已变脏弹冲突提示；文件被外部删除时弹删除提示。
 */
export async function reloadFile(path: string): Promise<void> {
  const s = useEditorStore.getState();
  const model = models.get(path);
  const draft = fallbackDrafts.get(path);
  const isOpen = s.groups.some((g) => g.tabs.some((t) => t.path === path));
  if (!model && draft === undefined && !isOpen) return;
  if (s.externalChangePrompt?.path === path || loadingPaths.has(path)) return;

  loadingPaths.add(path);
  try {
    const file = await readFile(path);
    const current = model ? model.getValue() : draft;
    // 仅 EOL 不同的文本视为未变，避免 setValue 不改变 EOL 导致的重复刷新
    if (file.content.replace(/\r\n/g, "\n") === (current ?? "").replace(/\r\n/g, "\n")) {
      const tab = useEditorStore
        .getState()
        .groups.flatMap((g) => g.tabs)
        .find((t) => t.path === path);
      if (tab && tab.readOnly !== file.readonly) {
        const st = useEditorStore.getState();
        const groups = st.groups.map((g) =>
          g.tabs.some((t) => t.path === path)
            ? { ...g, tabs: g.tabs.map((t) => (t.path === path ? { ...t, readOnly: file.readonly } : t)) }
            : g,
        );
        useEditorStore.setState({ groups, ...deriveActiveState(groups, st.activeGroupId) });
      }
      return;
    }
    if (file.isBinary) {
      useEditorStore.setState({
        error: `“${baseName(path)}” 已在外部变为二进制文件，未自动刷新`,
      });
      return;
    }
    const cur = useEditorStore.getState();
    if (cur.externalChangePrompt?.path === path) return;
    if (cur.dirtyPaths.has(path)) {
      if (!cur.externalChangePrompt) {
        useEditorStore.setState({
          externalChangePrompt: { path, diskContent: file.content, readonly: file.readonly },
        });
      }
      return;
    }
    applyReload(path, file.content, file.readonly);
  } catch (e) {
    const msg = String(e);
    const deleted = msg.startsWith("路径不是文件");
    if (deleted && isOpen) {
      // 文件已被外部删除/移走：已打开的标签给出保留或关闭的选择
      if (!useEditorStore.getState().externalChangePrompt) {
        useEditorStore.setState({
          externalChangePrompt: { path, diskContent: null, readonly: false },
        });
      }
    } else if (isOpen) {
      useEditorStore.setState({ error: `刷新“${baseName(path)}”失败：${msg}` });
    }
  } finally {
    loadingPaths.delete(path);
  }
}

/** 是否为 Markdown 文件（按扩展名判定） */
function isMarkdownFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return ext === "md" || ext === "markdown";
}

