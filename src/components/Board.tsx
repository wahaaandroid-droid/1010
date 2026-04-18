import { useDroppable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import { useLayoutEffect, useRef } from "react";
import type { GridCell, ShapeKind } from "../hooks/useGameLogic";
import { KIND_TO_COLOR } from "../hooks/useGameLogic";

const BOARD_GAP = "0.35rem";

export interface CellMetrics {
  cellSizePx: number;
  gapPx: number;
}

function BoardCell({
  r,
  c,
  cell,
  clearingKeys,
  previewTint,
  dragPreviewActive,
}: {
  r: number;
  c: number;
  cell: GridCell;
  clearingKeys: Set<string> | null;
  previewTint: "valid" | "invalid" | null;
  /** When true, only cells that are part of the piece preview get pointer hover (avoids cyan frame on T “hole” / anchor gap) */
  dragPreviewActive: boolean;
}) {
  const id = `cell-${r}-${c}`;
  const { isOver, setNodeRef } = useDroppable({ id });
  const key = `${r}-${c}`;
  const isClearing = clearingKeys?.has(key) ?? false;
  const filled = cell !== 0;
  const color = filled ? KIND_TO_COLOR[cell as ShapeKind] : "";

  const showPointerHover =
    isOver && (!dragPreviewActive || previewTint != null);

  const borderClass =
    previewTint === "valid"
      ? "border-emerald-400 ring-2 ring-emerald-400/50 bg-emerald-500/20"
      : previewTint === "invalid"
        ? "border-red-400 ring-2 ring-red-400/50 bg-red-500/20"
        : showPointerHover
          ? "border-cyan-300 bg-slate-600/70 ring-1 ring-cyan-400/40"
          : "border-slate-500/90 bg-slate-800/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

  const placedBlockClass = [
    "absolute inset-[2px] rounded-md",
    "shadow-[0_4px_16px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.35)]",
    "ring-2 ring-white/45 border border-slate-950/50",
    color,
  ].join(" ");

  return (
    <div
      ref={setNodeRef}
      className={`relative aspect-square rounded-lg border-2 transition-colors ${borderClass}`}
    >
      {filled ? (
        <motion.div
          className={placedBlockClass}
          animate={
            isClearing
              ? { opacity: 0, scale: 0.35 }
              : { opacity: 1, scale: 1 }
          }
          transition={{ duration: 0.35, ease: "easeInOut" }}
        />
      ) : null}
      {previewTint === "valid" && !filled ? (
        <div
          className="pointer-events-none absolute inset-[2px] rounded-md bg-emerald-400/55 shadow-[inset_0_0_0_2px_rgba(16,185,129,1),0_0_12px_rgba(52,211,153,0.35)]"
          aria-hidden
        />
      ) : null}
      {previewTint === "invalid" ? (
        <div
          className={`pointer-events-none absolute inset-0 rounded-lg bg-red-500/35 ring-2 ring-red-400/90 ${
            filled ? "mix-blend-screen" : ""
          }`}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

export interface BoardProps {
  grid: GridCell[][];
  clearingKeys: Set<string> | null;
  previewTint: Map<string, "valid" | "invalid"> | null;
  /** True while a piece placement preview is shown (including stale anchor between cells) */
  dragPreviewActive?: boolean;
  onCellMetrics?: (m: CellMetrics) => void;
}

export function Board({
  grid,
  clearingKeys,
  previewTint,
  dragPreviewActive = false,
  onCellMetrics,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || !onCellMetrics) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const gapStr = cs.rowGap || cs.columnGap || cs.gap || "0";
      const gapPx = parseFloat(gapStr) || 0;
      const w = rect.width;
      const cell = (w - 9 * gapPx) / 10;
      if (cell > 2) onCellMetrics({ cellSizePx: cell, gapPx });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCellMetrics]);

  return (
    <div
      className="w-full max-w-[min(100vw-2rem,100svh-14rem)]"
      style={{ touchAction: "none" }}
    >
      <div
        ref={gridRef}
        className="aspect-square w-full rounded-3xl border-2 border-slate-600 bg-slate-900 p-3 shadow-2xl shadow-black/50 ring-1 ring-white/10"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(10, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(10, minmax(0, 1fr))`,
          gap: BOARD_GAP,
        }}
      >
        {grid.map((row, r) =>
          row.map((cell, c) => {
            const pk = `${r}-${c}`;
            const tint = previewTint?.get(pk) ?? null;
            return (
              <BoardCell
                key={pk}
                r={r}
                c={c}
                cell={cell}
                clearingKeys={clearingKeys}
                previewTint={tint}
                dragPreviewActive={dragPreviewActive}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
