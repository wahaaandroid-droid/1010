import type { PieceDef, ShapeKind } from "../hooks/useGameLogic";
import { KIND_TO_COLOR } from "../hooks/useGameLogic";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const CELL_PX = 14;
const GAP_PX = 2;

function bounds(cells: [number, number][]) {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  return { rows: maxR + 1, cols: maxC + 1 };
}

export interface PiecePreviewProps {
  piece: PieceDef;
  /** When true (e.g. DragOverlay), lift preview above finger */
  dragLift?: boolean;
  className?: string;
}

/** Static mini-grid preview of a piece (no DnD). */
export function PiecePreview({
  piece,
  dragLift = false,
  className = "",
}: PiecePreviewProps) {
  const { rows, cols } = bounds(piece.cells);
  const color = KIND_TO_COLOR[piece.kind as ShapeKind];
  const occupied = new Set(piece.cells.map(([r, c]) => `${r}-${c}`));

  return (
    <div
      className={`relative select-none ${className}`}
      style={{
        width: cols * CELL_PX + (cols - 1) * GAP_PX,
        height: rows * CELL_PX + (rows - 1) * GAP_PX,
        transform: dragLift ? "translateY(-80px)" : undefined,
      }}
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${CELL_PX}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL_PX}px)`,
          gap: GAP_PX,
        }}
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          const on = occupied.has(`${r}-${c}`);
          return (
            <div
              key={`${r}-${c}`}
              className={
                on
                  ? `rounded-sm shadow-inner ${color}`
                  : "rounded-sm bg-slate-800/40"
              }
            />
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
}

export function HandPiece({ piece, handIndex, disabled }: HandPieceProps) {
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
      className="flex min-h-[88px] min-w-[88px] items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-900/80 px-2 py-3 shadow-lg"
    >
      {piece ? <PiecePreview piece={piece} /> : <span className="text-slate-500">—</span>}
    </div>
  );
}
