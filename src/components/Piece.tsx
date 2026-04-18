import type { PieceDef, ShapeKind } from "../hooks/useGameLogic";
import { KIND_TO_COLOR } from "../hooks/useGameLogic";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

function bounds(cells: [number, number][]) {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  return { rows: maxR + 1, cols: maxC + 1 };
}

/** Matches board cells: inset-[2px] each side on the inner block */
const BOARD_INSET_TOTAL = 4;

export interface PiecePreviewProps {
  piece: PieceDef;
  className?: string;
  /** Measured from board grid — same as placed blocks */
  cellSizePx?: number;
  gapPx?: number;
}

/** Mini-grid preview of a piece (no DnD). */
export function PiecePreview({
  piece,
  className = "",
  cellSizePx = 28,
  gapPx = 5,
}: PiecePreviewProps) {
  const { rows, cols } = bounds(piece.cells);
  const color = KIND_TO_COLOR[piece.kind as ShapeKind];
  const occupied = new Set(piece.cells.map(([r, c]) => `${r}-${c}`));
  const inner = Math.max(2, cellSizePx - BOARD_INSET_TOTAL);

  return (
    <div
      className={`relative select-none ${className}`}
      style={{
        width: cols * cellSizePx + (cols - 1) * gapPx,
        height: rows * cellSizePx + (rows - 1) * gapPx,
      }}
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellSizePx}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellSizePx}px)`,
          gap: gapPx,
        }}
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          const on = occupied.has(`${r}-${c}`);
          return (
            <div
              key={`${r}-${c}`}
              className="flex items-center justify-center"
              style={{ width: cellSizePx, height: cellSizePx }}
            >
              {on ? (
                <div
                  className={`rounded-md shadow-[0_3px_10px_rgba(0,0,0,0.5)] ring-1 ring-white/35 ${color}`}
                  style={{ width: inner, height: inner }}
                />
              ) : (
                <div
                  className="rounded-sm border border-slate-600/50 bg-slate-800/80"
                  style={{ width: inner, height: inner }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface HandPieceProps {
  piece: PieceDef | null;
  handIndex: number;
  disabled?: boolean;
  cellSizePx?: number;
  gapPx?: number;
}

export function HandPiece({
  piece,
  handIndex,
  disabled,
  cellSizePx = 28,
  gapPx = 5,
}: HandPieceProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `hand-${handIndex}`,
      disabled: disabled || piece == null,
      data: { handIndex, piece },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    touchAction: "none" as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="flex items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-900/80 p-3 shadow-lg"
    >
      {piece ? (
        <PiecePreview piece={piece} cellSizePx={cellSizePx} gapPx={gapPx} />
      ) : (
        <span className="text-slate-500">—</span>
      )}
    </div>
  );
}
