import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { readFile } from "../tauri";
import { peekPreviewOf } from "../navigation";
import type { JumpItem } from "../navigationStore";

/**
 * Peek 浮层（FR-20 / M9 增强，VS Code Peek References/Definitions 语义）：
 * 锚定在来源编辑器光标行下方，左侧按文件分组列出候选，右侧预览选中条目的代码上下文；
 * 过滤输入框承载键盘：↑/↓ 选择、Enter 跳转、Esc 关闭。
 * Monaco standalone 无公开 Peek Zone Widget API，此处为轻量自绘实现。
 */
export const PEEK_HEIGHT = 300;

interface Props {
  title: string;
  items: JumpItem[];
  /** 浮层顶部相对编辑器容器的像素偏移（调用方已按高度收拢） */
  anchorTop: number;
  onClose: () => void;
  onJump: (item: JumpItem) => void;
}

/** 预览上下文行数（目标行上下各 N 行） */
const PREVIEW_CONTEXT = 8;

export default function PeekView({ title, items, anchorTop, onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());

  // 打开时聚焦过滤框
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // 过滤（label/detail 子串，大小写不敏感）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.label.toLowerCase().includes(q) || (it.detail ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  // 按文件分组（保持首现顺序），扁平化后的顺序即键盘导航顺序
  const groups = useMemo(() => {
    const map = new Map<string, JumpItem[]>();
    for (const it of filtered) {
      const list = map.get(it.path);
      if (list) list.push(it);
      else map.set(it.path, [it]);
    }
    return [...map.entries()].map(([path, list]) => ({ path, items: list }));
  }, [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const sel = flat[Math.min(active, flat.length - 1)] ?? null;

  // 结果集变化时收敛高亮项；选中项滚动到可见
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);
  useEffect(() => {
    rowRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // 预览文本：打开中的文件读 Monaco model（含未保存内容），否则读磁盘
  const [lines, setLines] = useState<string[] | null>(null);
  const selPath = sel?.path ?? null;
  const selLine = sel?.line ?? 0;
  useEffect(() => {
    if (!selPath) {
      setLines(null);
      return;
    }
    const cached = peekPreviewOf(selPath);
    if (cached) {
      setLines(cached);
      return;
    }
    setLines(null);
    let cancelled = false;
    void readFile(selPath)
      .then((f) => {
        if (!cancelled) setLines(f.content.split(/\r\n|\n/));
      })
      .catch(() => {
        if (!cancelled) setLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selPath]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length > 0 ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length > 0 ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel) onJump(sel);
    }
  };

  // 预览窗口（目标行上下各 PREVIEW_CONTEXT 行）
  const start = Math.max(1, selLine - PREVIEW_CONTEXT);
  const end = Math.min(lines?.length ?? 0, selLine + PREVIEW_CONTEXT);

  let flatIdx = -1;

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      style={{ top: anchorTop, height: PEEK_HEIGHT }}
      className="absolute left-2 right-2 z-30 flex min-w-0 flex-col overflow-hidden rounded border border-[#0078d4] bg-[var(--aluka-overlay-bg)] shadow-2xl"
    >
      {/* 头部：标题 + 关闭 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--aluka-border)] px-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--aluka-text)]">
          {title}
        </span>
        <button
          title="关闭 (Esc)"
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text-active)]"
        >
          <X size={14} />
        </button>
      </div>
      {/* 过滤输入框 */}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        placeholder="输入以过滤候选…"
        className="h-8 shrink-0 border-b border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-3 text-[12px] text-[var(--aluka-text)] outline-none"
      />
      <div className="flex min-h-0 flex-1">
        {/* 左：按文件分组的候选列表 */}
        <div className="w-[300px] min-w-0 shrink-0 overflow-y-auto border-r border-[var(--aluka-border)] py-1">
          {flat.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--aluka-text-dim)]">无匹配候选</div>
          )}
          {groups.map(({ path, items: groupItems }) => {
            const name = path.split(/[\\/]/).pop() ?? path;
            return (
              <div key={path}>
                <div
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[var(--aluka-text-dim)]"
                  title={path}
                >
                  <span className="truncate font-semibold">{name}</span>
                  <span className="shrink-0">({groupItems.length})</span>
                </div>
                {groupItems.map((it) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  return (
                    <button
                      key={`${it.path}:${it.line}:${it.col}:${it.label}`}
                      ref={(el) => {
                        if (el) rowRefs.current.set(idx, el);
                        else rowRefs.current.delete(idx);
                      }}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => onJump(it)}
                      className={`flex w-full items-center gap-2 py-0.5 pl-4 pr-2 text-left text-[12px] ${
                        idx === active
                          ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]"
                          : "text-[var(--aluka-text)]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.detail && (
                        <span className="shrink-0 text-[11px] text-[var(--aluka-text-dim)]">
                          {it.detail}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {/* 右：选中条目的代码上下文预览 */}
        <div className="min-w-0 flex-1 overflow-auto bg-[var(--aluka-bg)] py-1">
          {!sel ? (
            <div className="px-3 py-2 text-[12px] text-[var(--aluka-text-dim)]">无选中候选</div>
          ) : !lines ? (
            <div className="px-3 py-2 text-[12px] text-[var(--aluka-text-dim)]">无法读取预览</div>
          ) : (
            Array.from({ length: end - start + 1 }, (_, i) => start + i).map((ln) => (
              <div
                key={ln}
                className={`flex gap-3 px-2 text-[12px] leading-5 ${
                  ln === selLine
                    ? "bg-[#264f78] text-[var(--aluka-text-active)]"
                    : "text-[var(--aluka-text-dim)]"
                }`}
              >
                <span className="w-10 shrink-0 select-none text-right tabular-nums">{ln}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono">
                  {lines[ln - 1] ?? ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
