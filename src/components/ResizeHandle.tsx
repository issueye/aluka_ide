import { useEffect, useRef, useState } from "react";
import { clampSize } from "../store";

/**
 * 通用拖拽尺寸手柄（VS Code 工作台分隔条语义子集）：
 * - side="right"：拖目标元素右边缘调**宽度**（左侧栏）
 * - side="top"：拖目标元素上边缘调**高度**（底部面板）
 * 交互：按住拖动实时调整、双击重置默认、聚焦后方向键微调（Home 重置）。
 * 采用「按下时记录基准 + 位移增量」而非绝对坐标，避免目标边缘随拖拽移动而产生跳变。
 */

export type HandleSide = "right" | "top";

interface Props {
  /** 被调整尺寸的元素 */
  targetRef: React.RefObject<HTMLElement | null>;
  side: HandleSide;
  min: number;
  /** 上限：拖拽时动态求值（受当前窗口尺寸约束），须传稳定引用以免重挂监听 */
  max: () => number;
  /** 当前尺寸，仅用于 aria-valuenow */
  value: number;
  onSize: (px: number) => void;
  onReset: () => void;
  title: string;
}

/** 键盘微调步长（px） */
const KEY_STEP = 10;
/** 遮罩出现阈值：指针移动超过该像素才铺全屏遮罩，否则原地双击会被遮罩抢走命中目标 */
const OVERLAY_THRESHOLD = 4;

export default function ResizeHandle({
  targetRef,
  side,
  min,
  max,
  value,
  onSize,
  onReset,
  title,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [moved, setMoved] = useState(false);
  const originRef = useRef({ pos: 0, size: 0, x: 0, y: 0 });
  const byVertical = side === "top";

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const { pos, size, x, y } = originRef.current;
      if (!moved && Math.abs(e.clientX - x) + Math.abs(e.clientY - y) < OVERLAY_THRESHOLD) return;
      if (!moved) setMoved(true);
      const at = byVertical ? e.clientY : e.clientX;
      // 向上拖增大高度、向右拖增大宽度，故 top 侧取反
      const delta = byVertical ? pos - at : at - pos;
      onSize(clampSize(size + delta, min, max()));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // 拖拽中失焦（如切窗口）时收尾，避免手柄卡在 dragging 态
    const onBlur = () => setDragging(false);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [dragging, moved, byVertical, min, max, onSize]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 让开带修饰键的组合：Alt+←/→ 是「后退/前进」全局命令，不能被手柄吃掉
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const el = targetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const current = byVertical ? rect.height : rect.width;
    if (e.key === "Home") {
      e.preventDefault();
      onReset();
    } else if (e.key === (byVertical ? "ArrowUp" : "ArrowRight")) {
      e.preventDefault();
      onSize(clampSize(current + KEY_STEP, min, max()));
    } else if (e.key === (byVertical ? "ArrowDown" : "ArrowLeft")) {
      e.preventDefault();
      onSize(clampSize(current - KEY_STEP, min, max()));
    } else {
      return;
    }
    e.stopPropagation();
  };

  return (
    <>
      {dragging && moved && (
        // 遮罩：吞掉 Monaco/xterm 的 mousemove 与文本选中；仅在真正拖起来后才铺，
        // 以免原地双击时 mouseup 落在遮罩上导致 click 序列不认手柄、双击重置失效
        <div
          className={`fixed inset-0 z-50 ${byVertical ? "cursor-row-resize" : "cursor-col-resize"}`}
        />
      )}
      <div
        role="separator"
        aria-orientation={byVertical ? "horizontal" : "vertical"}
        aria-label={title}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max()}
        tabIndex={0}
        title={title}
        onMouseDown={(e) => {
          e.preventDefault();
          // preventDefault 会抑制 mousedown 的默认聚焦，这里显式聚焦以保住键盘微调入口
          e.currentTarget.focus();
          const el = targetRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          originRef.current = {
            pos: byVertical ? rect.top : rect.right,
            size: byVertical ? rect.height : rect.width,
            x: e.clientX,
            y: e.clientY,
          };
          setMoved(false);
          setDragging(true);
        }}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        // 尺寸固定 4px：hover 只变色不改盒尺寸，否则划入手柄就触发一次编辑器重排
        className={`shrink-0 select-none bg-[var(--aluka-border)] outline-none transition-colors hover:bg-[var(--aluka-btn-hover)] focus-visible:bg-[var(--aluka-btn-hover)] ${
          byVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize"
        }`}
      />
    </>
  );
}
