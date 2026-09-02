import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import { useEditorStore, requestReveal } from "../editorStore";
import { listWorkspaceFiles } from "../tauri";
import {
  fuzzyScore,
  getRecentCommands,
  listCommands,
  runCommand,
  formatKeybinding,
} from "../commands";

/**
 * 全局浮层面板：命令面板（Ctrl+Shift+P）/ 快速打开（Ctrl+P）/ 转到行（菜单）共用一套 UI。
 * 命令模式：模糊匹配 title/category/id，最近使用命令置顶。
 * 文件模式：加载工作区文件清单，模糊匹配相对路径，回车打开。
 * 转到行模式：解析行号（可带列号），回车定位活动文件。
 */
interface Row {
  key: string;
  main: string;
  hint?: string;
  group?: string;
  run: () => void;
}

export default function CommandPalette() {
  const palette = useAppStore((s) => s.palette);
  const setPalette = useAppStore((s) => s.setPalette);
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const openFile = useEditorStore((s) => s.openFile);
  const activePath = useEditorStore((s) => s.activePath);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = palette !== null;

  // 打开时重置查询并聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActive(0);
      // 等待渲染后聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, palette]);

  // 文件模式：加载工作区文件清单（每次打开重新拉取，跟随最新磁盘）
  useEffect(() => {
    if (palette === "files" && workspaceRoot) {
      void listWorkspaceFiles(workspaceRoot)
        .then(setFiles)
        .catch(() => setFiles([]));
    }
  }, [palette, workspaceRoot]);

  const rows = useMemo<Row[]>(() => {
    if (palette === "goto") {
      // 转到行：解析「行号」或「行:列」；列号仅展示（定位以行为单位）
      const m = query.trim().match(/^(\d+)(?:\s*[:：,]\s*(\d+))?$/);
      if (!m || !activePath) return [];
      const line = Number(m[1]);
      if (line < 1) return [];
      const col = m[2] !== undefined ? Number(m[2]) : null;
      return [
        {
          key: "goto-line",
          main: `转到第 ${line} 行${col !== null && col > 0 ? ` 第 ${col} 列` : ""}`,
          hint: activePath.split(/[\\/]/).pop(),
          run: () => {
            setPalette(null);
            requestReveal(activePath, line);
          },
        },
      ];
    }
    if (palette === "files") {
      if (!workspaceRoot) return [];
      const q = query.trim();
      const scored = files
        .map((f) => {
          const rel = f.slice(workspaceRoot.length).replace(/^[\\/]/, "");
          const name = rel.split(/[\\/]/).pop() ?? rel;
          if (!q) return { f, rel, name, s: 0 };
          const sr = fuzzyScore(q, rel);
          const sn = fuzzyScore(q, name);
          const s = Math.max(sr ?? -1, sn === null ? -1 : sn + 2);
          return { f, rel, name, s };
        })
        .filter((x) => !q || x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 100);
      return scored.map((x) => ({
        key: x.f,
        main: x.name,
        hint: x.rel,
        run: () => {
          setPalette(null);
          void openFile(x.f);
        },
      }));
    }
    // 命令模式
    const cmds = listCommands();
    const recent = getRecentCommands();
    const recentPos = new Map(recent.map((id, i) => [id, i]));
    const q = query.trim();
    const scored = cmds
      .map((c) => {
        const hay = c.category ? `${c.category}: ${c.title}` : c.title;
        if (!q) return { c, hay, s: 0 };
        // 各字段独立判命中：null（不匹配）不可参与加分，否则过滤失效
        const sh = fuzzyScore(q, hay);
        const st = fuzzyScore(q, c.title);
        const si = fuzzyScore(q, c.id);
        const s = Math.max(sh ?? -1, st === null ? -1 : st + 1, si === null ? -1 : si - 5);
        return { c, hay, s };
      })
      .filter((x) => !q || x.s >= 0);
    // 无查询时最近使用置顶（按最近顺序），其余按注册顺序
    if (!q) {
      scored.sort(
        (a, b) =>
          (recentPos.get(a.c.id) ?? 999) - (recentPos.get(b.c.id) ?? 999),
      );
    } else {
      scored.sort((a, b) => b.s - a.s);
    }
    return scored.slice(0, 100).map((x) => ({
      key: x.c.id,
      main: x.hay,
      hint: x.c.keybinding
        ? formatKeybinding(x.c.keybinding)
        : x.c.displayKeybinding,
      group: !q && recentPos.has(x.c.id) ? "最近使用" : undefined,
      run: () => {
        setPalette(null);
        void runCommand(x.c.id);
      },
    }));
  }, [palette, query, files, workspaceRoot, openFile, setPalette, activePath]);

  // 结果集变化时收敛高亮项
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPalette(null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(1, rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + rows.length) % Math.max(1, rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[active]?.run();
    }
  };

  if (!isOpen) return null;

  const placeholder =
    palette === "files"
      ? "输入以按文件名快速打开…"
      : palette === "goto"
        ? "输入行号（如 42 或 42:8），回车定位…"
        : "> 输入命令…";
  const emptyHint =
    palette === "files" && !workspaceRoot
      ? "尚未打开工作区"
      : palette === "goto" && !activePath
        ? "没有活动的编辑器文件"
        : palette === "goto"
          ? "请输入有效行号"
          : "无匹配项";

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/30"
      onMouseDown={(e) => {
        // 点击遮罩关闭（输入框/列表内不触发）
        if (e.target === e.currentTarget) setPalette(null);
      }}
    >
      <div
        className="mt-[10vh] flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-sidebar-bg)] shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder={placeholder}
          className="h-9 shrink-0 border-b border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-3 text-[13px] text-[var(--aluka-text)] outline-none"
        />
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--aluka-text-dim)]">{emptyHint}</div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.key}
              onMouseEnter={() => setActive(i)}
              onClick={r.run}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                i === active
                  ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]"
                  : "text-[var(--aluka-text)]"
              }`}
            >
              {r.group && (
                <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
                  {r.group}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{r.main}</span>
              {r.hint && (
                <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
                  {r.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
