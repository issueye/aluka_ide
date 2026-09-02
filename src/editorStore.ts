import { create } from "zustand";
import monaco, { languageOf } from "./monaco-setup";
import { readFile, writeFile, saveAll } from "./tauri";

/** 拒绝打开阈值（与 Rust 端 READ_MAX_BYTES 对齐，双保险） */
const MAX_BYTES = 20 * 1024 * 1024;

/** 行跳转信号（搜索结果点击 → 打开/定位）：seq 变化驱动 CodeEditor 副作用 */
interface RevealState {
  seq: number;
  path: string | null;
  line: number;
}
export const useRevealStore = create<RevealState>(() => ({ seq: 0, path: null, line: 0 }));

/** 请求把某文件定位到某行（文件需已 openFile；由 CodeEditor 消费） */
export function requestReveal(path: string, line: number): void {
  useRevealStore.setState((s) => ({ seq: s.seq + 1, path, line }));
}

export interface EditorTab {
  path: string;
  name: string;
  language: string;
  readOnly: boolean;
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

export function getDraft(path: string): string {
  return fallbackDrafts.get(path) ?? "";
}

export function setDraft(path: string, value: string): void {
  fallbackDrafts.set(path, value);
}

/** 标记脏状态（降级模式由 textarea onChange 调用） */
export function markDirty(path: string, dirty: boolean): void {
  const s = useEditorStore.getState();
  if (s.dirtyPaths.has(path) === dirty) return;
  const dirtyPaths = new Set(s.dirtyPaths);
  if (dirty) dirtyPaths.add(path);
  else dirtyPaths.delete(path);
  useEditorStore.setState({ dirtyPaths });
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

  // 向后兼容当前活动组状态
  tabs: EditorTab[];
  activePath: string | null;

  openFile: (path: string, groupId?: string) => Promise<void>;
  closeTab: (path: string, groupId?: string) => boolean;
  resolveClose: (choice: "save" | "discard" | "cancel" | { path: string; choice: "save" | "discard" | "cancel" }) => Promise<void>;
  setActiveTab: (path: string, groupId?: string) => void;
  setActive: (path: string) => void;
  setActiveGroup: (groupId: string) => void;
  splitGroup: (direction: "horizontal" | "vertical", sourceGroupId?: string) => void;
  closeGroup: (groupId: string) => void;
  setSplitRatio: (ratio: number) => void;
  setSplitDirection: (direction: SplitDirection) => void;
  save: (path: string) => Promise<void>;
  saveAllDirty: () => Promise<void>;
  setError: (msg: string | null) => void;
  forceClose: (path: string, groupId?: string) => void;
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

  tabs: [],
  activePath: null,

  openFile: async (path, targetGroupId) => {
    const s = get();
    const gId = targetGroupId ?? s.activeGroupId;
    const targetGroup = s.groups.find((g) => g.id === gId) ?? s.groups[0];

    // 如果已经在目标组打开，直接设为目标组的 activePath 并聚焦该组
    if (targetGroup && targetGroup.tabs.some((t) => t.path === path)) {
      const nextGroups = s.groups.map((g) =>
        g.id === targetGroup.id ? { ...g, activePath: path } : g,
      );
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
          const m = models.get(path);
          if (!m) return;
          const dirty = m.getAlternativeVersionId() !== savedVersionIds.get(path);
          const dirtyPaths = new Set(get().dirtyPaths);
          if (dirty) dirtyPaths.add(path);
          else dirtyPaths.delete(path);
          set({ dirtyPaths });
        });
      }

      const curState = get();
      const currentGId = targetGroupId ?? curState.activeGroupId;
      const nextGroups = curState.groups.map((g) => {
        if (g.id === currentGId) {
          return {
            ...g,
            tabs: [...g.tabs, tab],
            activePath: path,
          };
        }
        return g;
      });

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
}));

