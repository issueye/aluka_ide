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

/**
 * 编辑器状态：标签页与脏标记。
 * Monaco model 按文件路径（Uri）缓存于模块级 Map——
 * 切换标签只换 model，天然保留脏状态与撤销栈；视图态单独存 viewStates。
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

interface EditorStore {
  tabs: EditorTab[];
  activePath: string | null;
  dirtyPaths: Set<string>;
  error: string | null;
  /** 待确认关闭的脏文件路径（弹"保存/不保存/取消"） */
  closePromptPath: string | null;
  openFile: (path: string) => Promise<void>;
  /** 返回 false 表示文件有未保存修改，已弹确认等待 resolveClose */
  closeTab: (path: string) => boolean;
  resolveClose: (path: string, choice: "save" | "discard" | "cancel") => Promise<void>;
  setActive: (path: string) => void;
  save: (path: string) => Promise<void>;
  setError: (msg: string | null) => void;
  /** 直接关闭（不弹确认），内部与确认弹窗回调使用 */
  forceClose: (path: string) => void;
  /** 全部保存：一次性落盘所有脏标签（Ctrl+Shift+S / 自动保存） */
  saveAllDirty: () => Promise<void>;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activePath: null,
  dirtyPaths: new Set(),
  error: null,
  closePromptPath: null,

  openFile: async (path) => {
    if (get().tabs.some((t) => t.path === path)) {
      set({ activePath: path });
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
      // 同一 Uri 可能已有 model（如快速重复打开），优先复用
      const uri = monaco.Uri.file(path);
      const model =
        monaco.editor.getModel(uri) ??
        monaco.editor.createModel(file.content, tab.language, uri);
      // 登记到路径 → model 缓存：CodeEditor 换 model 与 save 都依赖此 Map，
      // 缺失会导致编辑器拿不到 model（空白）且保存误读降级草稿（丢改动）。
      models.set(path, model);
      // 保留 Windows 文件的 CRLF 行尾，避免保存时被改写
      if (!/\r\n/.test(model.getValue())) {
        model.setEOL(monaco.editor.EndOfLineSequence.LF);
      } else {
        model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
      }
      // 降级编辑模式的初始草稿
      fallbackDrafts.set(path, model.getValue());
      savedVersionIds.set(path, model.getAlternativeVersionId());
      model.onDidChangeContent(() => {
        const dirty = model.getAlternativeVersionId() !== savedVersionIds.get(path);
        const dirtyPaths = new Set(get().dirtyPaths);
        if (dirty) dirtyPaths.add(path);
        else dirtyPaths.delete(path);
        set({ dirtyPaths });
      });
      set({ tabs: [...get().tabs, tab], activePath: path });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      loadingPaths.delete(path);
    }
  },

  closeTab: (path) => {
    if (get().dirtyPaths.has(path)) {
      set({ closePromptPath: path });
      return false;
    }
    get().forceClose(path);
    return true;
  },

  resolveClose: async (path, choice) => {
    set({ closePromptPath: null });
    if (choice === "cancel") return;
    if (choice === "save") await get().save(path);
    get().forceClose(path);
  },

  setActive: (path) => set({ activePath: path }),

  save: async (path) => {
    const model = models.get(path);
    const content = model
      ? model.getValue()
      : (fallbackDrafts.get(path) ?? null);
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

  forceClose: (path) => {
    const model = models.get(path);
    model?.dispose();
    models.delete(path);
    savedVersionIds.delete(path);
    viewStates.delete(path);
    const oldTabs = get().tabs;
    const idx = oldTabs.findIndex((t) => t.path === path);
    const tabs = oldTabs.filter((t) => t.path !== path);
    let activePath = get().activePath;
    if (activePath === path) {
      activePath = tabs[Math.min(idx, tabs.length - 1)]?.path ?? null;
    }
    const dirtyPaths = new Set(get().dirtyPaths);
    dirtyPaths.delete(path);
    set({ tabs, activePath, dirtyPaths });
  },
}));
