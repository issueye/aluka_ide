import { useEffect, useRef, useState } from "react";
import { getCommand, formatKeybinding, runCommand } from "../commands";

/**
 * 标题栏菜单栏（VS Code Dark+ 观感）：
 * 八个下拉菜单（文件/编辑/选择/查看/转到/运行/终端/帮助），
 * 菜单项以命令 id 引用命令注册表（commands.ts）——与命令面板、快捷键中枢共用同一执行入口。
 * 交互：点击展开/收起；菜单已展开时悬停切换；Escape/点击外部/执行命令后收起；支持方向键 + 回车导航。
 */
interface MenuEntry {
  label: string;
  /** 命令注册表 id（与 action 二选一） */
  commandId?: string;
  /** 直接动作（无需进命令注册表的场景） */
  action?: () => void;
  separatorBefore?: boolean;
}

const MENUS: { title: string; items: MenuEntry[] }[] = [
  {
    title: "文件",
    items: [
      { label: "新建文本文件", commandId: "workbench.action.files.new" },
      { label: "新建文件夹", commandId: "workbench.action.files.newFolder" },
      { label: "打开文件夹…", commandId: "workbench.action.files.openFolder", separatorBefore: true },
      { label: "关闭文件夹", commandId: "workbench.action.closeFolder" },
      { label: "保存", commandId: "workbench.action.files.save", separatorBefore: true },
      { label: "全部保存", commandId: "workbench.action.files.saveAll" },
      { label: "关闭编辑器", commandId: "workbench.action.closeActiveEditor", separatorBefore: true },
      { label: "关闭所有编辑器", commandId: "workbench.action.closeAllEditors" },
      { label: "退出", commandId: "workbench.action.quit", separatorBefore: true },
    ],
  },
  {
    title: "编辑",
    items: [
      { label: "撤销", commandId: "edit.undo" },
      { label: "重做", commandId: "edit.redo" },
      { label: "剪切", commandId: "edit.cut", separatorBefore: true },
      { label: "复制", commandId: "edit.copy" },
      { label: "粘贴", commandId: "edit.paste" },
      { label: "查找", commandId: "edit.find", separatorBefore: true },
      { label: "替换", commandId: "edit.replace" },
      { label: "切换行注释", commandId: "edit.commentLine", separatorBefore: true },
      { label: "切换块注释", commandId: "edit.blockComment" },
    ],
  },
  {
    title: "选择",
    items: [
      { label: "全选", commandId: "editor.action.selectAll" },
      { label: "扩大选择", commandId: "editor.action.smartSelect.expand", separatorBefore: true },
      { label: "在上面添加光标", commandId: "editor.action.insertCursorAbove" },
      { label: "在下面添加光标", commandId: "editor.action.insertCursorBelow" },
      { label: "添加下一个匹配项", commandId: "editor.action.addSelectionToNextFindMatch" },
    ],
  },
  {
    title: "查看",
    items: [
      { label: "命令面板…", commandId: "workbench.action.showCommands" },
      { label: "快速打开文件…", commandId: "workbench.action.quickOpen" },
      { label: "资源管理器", commandId: "workbench.view.explorer", separatorBefore: true },
      { label: "搜索", commandId: "workbench.view.search" },
      { label: "源代码管理", commandId: "workbench.view.scm" },
      { label: "扩展", commandId: "workbench.view.extensions" },
      { label: "切换侧边栏", commandId: "workbench.action.toggleSidebarVisibility", separatorBefore: true },
      { label: "切换底部面板", commandId: "workbench.action.togglePanel" },
      { label: "放大编辑器字体", commandId: "view.zoomIn", separatorBefore: true },
      { label: "缩小编辑器字体", commandId: "view.zoomOut" },
      { label: "重置编辑器字体", commandId: "view.zoomReset" },
      { label: "向右拆分编辑器", commandId: "workbench.action.splitEditorRight", separatorBefore: true },
      { label: "向下拆分编辑器", commandId: "workbench.action.splitEditorDown" },
      { label: "打开 Markdown 预览", commandId: "markdown.showPreview" },
    ],
  },
  {
    title: "转到",
    items: [
      { label: "转到文件…", commandId: "workbench.action.quickOpen" },
      { label: "转到行/列…", commandId: "workbench.action.gotoLine" },
      { label: "聚焦到第一编辑器组", commandId: "workbench.action.focusFirstEditorGroup", separatorBefore: true },
      { label: "聚焦到第二编辑器组", commandId: "workbench.action.focusSecondEditorGroup" },
      { label: "下一个编辑器", commandId: "workbench.action.nextEditor", separatorBefore: true },
      { label: "上一个编辑器", commandId: "workbench.action.previousEditor" },
    ],
  },
  {
    title: "运行",
    items: [{ label: "在终端中运行活动文件", commandId: "run.activeFile" }],
  },
  {
    title: "终端",
    items: [
      { label: "新建终端", commandId: "terminal.new" },
      { label: "关闭当前终端", commandId: "terminal.killActive" },
      { label: "清空终端", commandId: "terminal.clear" },
    ],
  },
  {
    title: "帮助",
    items: [{ label: "关于", commandId: "help.about" }],
  },
];

/** 菜单项快捷键提示：displayKeybinding 优先（原生绑定不进中枢），否则格式化注册快捷键 */
function hintOf(commandId: string): string | undefined {
  const cmd = getCommand(commandId);
  if (!cmd) return undefined;
  return cmd.displayKeybinding ?? (cmd.keybinding ? formatKeybinding(cmd.keybinding) : undefined);
}

export default function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLElement>(null);

  // 点击菜单区域外收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = (title: string) => {
    setOpen(title);
    setActiveIdx(0);
  };

  const execute = (entry: MenuEntry) => {
    setOpen(null);
    if (entry.commandId) void runCommand(entry.commandId);
    else entry.action?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const menu = MENUS.find((m) => m.title === open);
    if (!menu) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % menu.items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + menu.items.length) % menu.items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = menu.items[activeIdx];
      if (entry) execute(entry);
    }
  };

  return (
    <nav ref={rootRef} onKeyDown={onKeyDown} className="ml-4 flex shrink-0 items-center gap-0.5">
      {MENUS.map(({ title, items }) => (
        <div key={title} className="relative">
          <button
            onMouseDown={(e) => {
              // mousedown 即切换，避免 document 外点监听先把菜单关掉再触发 click 的抖动
              e.stopPropagation();
              if (open === title) setOpen(null);
              else openMenu(title);
            }}
            onMouseEnter={() => {
              if (open !== null && open !== title) openMenu(title);
            }}
            className={`rounded px-2 py-0.5 text-[13px] text-[var(--aluka-text)] ${
              open === title
                ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]"
                : "hover:bg-[var(--aluka-hover)]"
            }`}
          >
            {title}
          </button>
          {open === title && (
            <div className="absolute left-0 top-full z-50 mt-0.5 min-w-[240px] rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] py-1 shadow-2xl">
              {items.map((entry, i) => (
                <div key={entry.label}>
                  {entry.separatorBefore && (
                    <div className="my-1 border-t border-[var(--aluka-border)]" />
                  )}
                  <button
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => execute(entry)}
                    className={`flex w-full items-center gap-4 px-3 py-1 text-left text-[13px] ${
                      getCommand(entry.commandId ?? "")
                        ? i === activeIdx
                          ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]"
                          : "text-[var(--aluka-text)]"
                        : "cursor-default text-[var(--aluka-text-dim)]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 whitespace-nowrap">{entry.label}</span>
                    {entry.commandId && (
                      <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
                        {hintOf(entry.commandId) ?? ""}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
