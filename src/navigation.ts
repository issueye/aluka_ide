/**
 * 代码跳转流程单点（FR-20 / M9 增强，参考 VS Code 导航设计）。
 * 从 commands.ts 重构拆出，统一四类流程：
 * - 转到定义（F12 / Ctrl+点击）：零命中通知；单命中直跳；多命中在来源编辑器 Peek（gotoAndPeek 语义）
 * - 查看定义（Alt+F12）：强制 Peek
 * - 查找所有引用（Shift+F12）：整词搜索 → 按文件分组 Peek
 * - 后退/前进（Alt+←/→）：跳转历史栈导航
 * 所有导航型跳转（含符号面板/搜索结果/转到行）跳转前都经 pushCurrent 记录当前位置。
 */
import { getActiveEditor } from "./activeEditor";
import { showInfo } from "./notificationStore";
import { useAppStore } from "./store";
import { requestReveal, useEditorStore } from "./editorStore";
import { getModel } from "./editorStore";
import { useNavigationStore, type JumpItem, type NavLocation } from "./navigationStore";
import { useSymbolsStore } from "./symbolsStore";
import { searchWorkspace, type WorkspaceSymbol } from "./tauri";

/** 由路径构造 "相对路径:行号" 形式的辅助说明 */
export function relativeDetail(path: string, root: string, line: number): string {
  const rel = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, "") : path;
  return `${rel}:${line}`;
}

/** 当前活动编辑器的光标位置（无编辑器/无活动文件时为 null） */
function currentLocation(): NavLocation | null {
  const ed = getActiveEditor();
  const pos = ed?.getPosition();
  const path = useEditorStore.getState().activePath;
  if (!path) return null;
  return { path, line: pos?.lineNumber ?? 1, col: pos?.column ?? 1 };
}

/**
 * 跳转统一入口：记录当前位置入历史栈 → 打开文件 → 定位行列。
 * 若目标就是当前活动位置（同文件同行同列）不产生历史噪音。
 */
export async function jumpTo(path: string, line: number, col = 1): Promise<void> {
  const cur = currentLocation();
  const moving =
    !cur || cur.path !== path || cur.line !== line || cur.col !== col;
  if (moving && cur) useNavigationStore.getState().pushCurrent(cur);
  await useEditorStore.getState().openFile(path);
  requestReveal(path, line, col);
}

/** 显式记录当前活动编辑器位置入历史栈（转到行/列等原地定位型跳转前调用） */
export function recordNavigationLocation(): void {
  const cur = currentLocation();
  if (cur) useNavigationStore.getState().pushCurrent(cur);
}

/** 后退/前进型定位：不写历史栈（否则会破坏栈语义）；顺带关闭打开中的 Peek */
async function revealLocation(loc: NavLocation): Promise<void> {
  useNavigationStore.getState().closePeek();
  await useEditorStore.getState().openFile(loc.path);
  requestReveal(loc.path, loc.line, loc.col);
}

/** 后退（Alt+←）：回到上一个跳转来源位置 */
export function navigateBack(): void {
  const loc = useNavigationStore.getState().back();
  if (!loc) {
    showInfo("没有可后退的跳转位置");
    return;
  }
  void revealLocation(loc);
}

/** 前进（Alt+→）：回到被后退前的位置 */
export function navigateForward(): void {
  const loc = useNavigationStore.getState().forward();
  if (!loc) {
    showInfo("没有可前进的跳转位置");
    return;
  }
  void revealLocation(loc);
}

/** 确保工作区已打开且定义索引就绪；返回根路径（未打开时提示并返回 null） */
async function ensureIndexReady(): Promise<string | null> {
  const root = useAppStore.getState().workspaceRoot;
  if (!root) {
    showInfo("请先打开文件夹");
    return null;
  }
  await useSymbolsStore.getState().ensureIndex(root);
  return root;
}

/** WorkspaceSymbol 定义命中 → Peek 候选条目 */
function defToItem(d: WorkspaceSymbol, root: string): JumpItem {
  return {
    path: d.path,
    line: d.line,
    col: d.col,
    label: d.name,
    detail: `${d.kind} · ${relativeDetail(d.path, root, d.line)}`,
  };
}

/**
 * 转到定义核心：由编辑器事件（Ctrl+点击）或命令入口调用。
 * @param groupId 来源编辑器组（Peek 渲染位置）
 * @param word 光标处符号名（空串提示）
 * @param anchorLine 光标行（Peek 锚定行）
 * @param peekAlways true = 单命中也以 Peek 呈现（Alt+F12 查看定义）
 */
export async function gotoDefinition(
  groupId: string,
  word: string,
  anchorLine: number,
  peekAlways = false,
): Promise<void> {
  if (!word) {
    showInfo("光标处没有符号");
    return;
  }
  const root = await ensureIndexReady();
  if (!root) return;
  const defs = useSymbolsStore.getState().index?.get(word.toLowerCase()) ?? [];
  if (defs.length === 0) {
    showInfo(`未找到 “${word}” 的定义`);
    return;
  }
  if (defs.length === 1 && !peekAlways) {
    await jumpTo(defs[0].path, defs[0].line, defs[0].col);
    return;
  }
  useNavigationStore.getState().openPeek({
    groupId,
    title: `“${word}” 的定义`,
    items: defs.map((d) => defToItem(d, root)),
    anchorLine,
  });
}

/** 命令入口（F12 / 菜单 / 命令面板）：从活动编辑器取光标符号后转到定义 */
export async function gotoDefinitionCommand(peekAlways = false): Promise<void> {
  const ed = getActiveEditor();
  const pos = ed?.getPosition();
  const word = ed && pos ? (ed.getModel()?.getWordAtPosition(pos)?.word ?? "") : "";
  const groupId = useEditorStore.getState().activeGroupId;
  await gotoDefinition(groupId, word, pos?.lineNumber ?? 1, peekAlways);
}

/** 查找所有引用（Shift+F12）：整词搜索 → 来源编辑器 Peek，按文件分组呈现 */
export async function findReferencesCommand(): Promise<void> {
  const ed = getActiveEditor();
  const pos = ed?.getPosition();
  const word = ed && pos ? (ed.getModel()?.getWordAtPosition(pos)?.word ?? "") : "";
  if (!word) {
    showInfo("光标处没有符号");
    return;
  }
  const root = useAppStore.getState().workspaceRoot;
  if (!root) {
    showInfo("请先打开文件夹");
    return;
  }
  try {
    const res = await searchWorkspace({
      root,
      query: word,
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
    const items: JumpItem[] = [];
    for (const file of res.results) {
      for (const m of file.matches) {
        // 列级定位：取行内首个整词命中的 1-based 字符列（搜不到时退回行首）
        const idx = m.lineText.toLowerCase().indexOf(word.toLowerCase());
        items.push({
          path: file.path,
          line: m.lineNumber,
          col: idx >= 0 ? idx + 1 : 1,
          label: m.lineText.trim().slice(0, 120) || word,
          detail: relativeDetail(file.path, root, m.lineNumber),
        });
      }
    }
    if (items.length === 0) {
      showInfo(`未找到 “${word}” 的引用`);
      return;
    }
    const fileCount = new Set(items.map((i) => i.path)).size;
    useNavigationStore.getState().openPeek({
      groupId: useEditorStore.getState().activeGroupId,
      title: `“${word}” 的引用（${items.length}${res.truncated ? "+" : ""} 个结果 · ${fileCount} 个文件）`,
      items: items.slice(0, 500),
      anchorLine: pos?.lineNumber ?? 1,
    });
  } catch (e) {
    useEditorStore.getState().setError(String(e));
  }
}

/** 工作区符号面板（Ctrl+T）：确保索引就绪后打开 symbols 模式的命令面板 */
export async function showWorkspaceSymbols(): Promise<void> {
  const root = await ensureIndexReady();
  if (!root) return;
  useAppStore.getState().setPalette("symbols");
}

/** Peek 候选的预览文本：打开中的文件读 Model（含未保存内容），否则读磁盘；失败为 null */
export function peekPreviewOf(path: string): string[] | null {
  const model = getModel(path);
  if (model) return model.getValue().split(/\r\n|\n/);
  return null;
}
