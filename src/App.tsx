import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type CellMetrics } from "./components/Board";
import { HandPiece, PiecePreview } from "./components/Piece";
import { attachAudioUserGestureUnlock, resumeAudio } from "./audio/gameSounds";
import type { PieceDef } from "./hooks/useGameLogic";
import {
  GRID_SIZE,
  canPlacePieceAt,
  useGameLogic,
} from "./hooks/useGameLogic";

/** Droppable ids are `cell-${r}-${c}` with r,c in 0..GRID_SIZE-1 */
function parseCellId(id: string | undefined): { r: number; c: number } | null {
  if (!id || !id.startsWith("cell-")) return null;
  const rest = id.slice("cell-".length);
  const parts = rest.split("-");
  if (parts.length !== 2) return null;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  if (Number.isNaN(r) || Number.isNaN(c)) return null;
  if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return null;
  return { r, c };
}

/** Base vertical offset while dragging on touch (hand → board path). */
const DRAG_TOUCH_LIFT_PX = 108;
/**
 * Extra lift while `over` is a grid cell — smaller than before so the piece sits more toward the
 * lower-right of the thumb while green preview stays near the upper-left of the contact area.
 */
const DRAG_TOUCH_EXTRA_OVER_BOARD_PX = 28;
/**
 * Shift the floating piece right while over the board (visual only). Layout goal: piece visual
 * offset from the thumb while the hit-test point (below) drives preview above the finger.
 */
const DRAG_TOUCH_SIDE_NUDGE_OVER_BOARD_PX = 48;
/**
 * On touch, collision uses a point this many pixels **above** the raw finger position so the
 * green placement preview lands on grid cells north of the thumb (same anchor as drop).
 */
const DRAG_TOUCH_PREVIEW_HIT_OFFSET_Y_PX = 120;

/** Keep virtual hit-test inside the board rect so `closestCenter` does not latch to bottom rows. */
function clampPointToGridRect(
  gridEl: HTMLElement | null,
  pt: { x: number; y: number },
  pad: number,
): { x: number; y: number } {
  if (!gridEl) return pt;
  const r = gridEl.getBoundingClientRect();
  return {
    x: Math.min(Math.max(pt.x, r.left + pad), r.right - pad),
    y: Math.min(Math.max(pt.y, r.top + pad), r.bottom - pad),
  };
}

function isTouchLikeActivator(event: Event | null): boolean {
  if (!event) return false;
  if ("pointerType" in event && (event as PointerEvent).pointerType === "touch") {
    return true;
  }
  if ("touches" in event) {
    return true;
  }
  return false;
}

const DEFAULT_METRICS: CellMetrics = { cellSizePx: 28, gapPx: 5.6 };

export default function App() {
  const {
    grid,
    hand,
    score,
    bestScore,
    gameOver,
    clearingKeys,
    placePiece,
    resetGame,
    handSize,
  } = useGameLogic();

  const [cellMetrics, setCellMetrics] = useState<CellMetrics>(DEFAULT_METRICS);
  const [dragPiece, setDragPiece] = useState<PieceDef | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{
    cells: [number, number][];
    valid: boolean;
  } | null>(null);
  /** Last board anchor while dragging — touch often clears `over` on release before `onDragEnd` */
  const lastBoardAnchorRef = useRef<{ r: number; c: number } | null>(null);

  const boardGridRef = useRef<HTMLDivElement | null>(null);

  /** Touch-only lift applied to drag transform (visual only — not used for hit-testing). */
  const dragTouchLiftPxRef = useRef(0);
  /** True while `over` is a grid cell — adds extra vertical lift so the overlay clears the finger on the board. */
  const dragTouchOverBoardRef = useRef(false);

  /** Touch sometimes omits `pointerCoordinates`; keep last screen point for collision. */
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null);

  const liftTouchPieces: Modifier = useMemo(
    () => (args) => {
      const baseLift = dragTouchLiftPxRef.current;
      if (!baseLift) return args.transform;
      let lift = baseLift;
      let dx = 0;
      if (dragTouchOverBoardRef.current) {
        lift += DRAG_TOUCH_EXTRA_OVER_BOARD_PX;
        dx += DRAG_TOUCH_SIDE_NUDGE_OVER_BOARD_PX;
      }
      return {
        ...args.transform,
        x: args.transform.x + dx,
        y: args.transform.y - lift,
      };
    },
    [],
  );

  /**
   * Mouse: real pointer. Touch: same X, Y shifted up so preview/drop anchor sits above the thumb.
   * Raw coordinates are still stored for `lastPointerScreenRef` when frames omit `pointerCoordinates`.
   */
  const cellCollisionPointerFirst = useMemo<CollisionDetection>(
    () => (args) => {
      const pc = args.pointerCoordinates;
      if (pc) {
        lastPointerScreenRef.current = { x: pc.x, y: pc.y };
      }
      const raw = pc ?? lastPointerScreenRef.current;
      const touch = dragTouchLiftPxRef.current > 0;
      const pt =
        raw != null
          ? touch
            ? clampPointToGridRect(boardGridRef.current, {
                x: raw.x,
                y: raw.y - DRAG_TOUCH_PREVIEW_HIT_OFFSET_Y_PX,
              }, 10)
            : raw
          : null;

      if (pt) {
        const fromPointer = pointerWithin({
          ...args,
          pointerCoordinates: pt,
        });
        if (fromPointer.length > 0) return fromPointer;

        const pointRect: ClientRect = {
          width: 1,
          height: 1,
          top: pt.y,
          left: pt.x,
          bottom: pt.y + 1,
          right: pt.x + 1,
        };
        const fromClosest = closestCenter({
          ...args,
          collisionRect: pointRect,
          pointerCoordinates: pt,
        });
        if (fromClosest.length > 0) return fromClosest;
      }

      return rectIntersection(args);
    },
    [],
  );

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 0, tolerance: 12 },
    }),
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  useEffect(() => attachAudioUserGestureUnlock(document), []);

  const interactionLocked = gameOver || clearingKeys != null;

  const previewTint = useMemo(() => {
    if (!placementPreview) return null;
    const m = new Map<string, "valid" | "invalid">();
    const tint = placementPreview.valid ? "valid" : "invalid";
    for (const [r, c] of placementPreview.cells) {
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        m.set(`${r}-${c}`, tint);
      }
    }
    return m;
  }, [placementPreview]);

  const handleCellMetrics = useCallback((m: CellMetrics) => {
    setCellMetrics((prev) =>
      Math.abs(prev.cellSizePx - m.cellSizePx) < 0.25 &&
      Math.abs(prev.gapPx - m.gapPx) < 0.05
        ? prev
        : m,
    );
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    resumeAudio();
    dragTouchLiftPxRef.current = isTouchLikeActivator(event.activatorEvent)
      ? DRAG_TOUCH_LIFT_PX
      : 0;
    dragTouchOverBoardRef.current = false;
    const p = event.active.data.current?.piece as PieceDef | undefined;
    setDragPiece(p ?? null);
    setPlacementPreview(null);
    lastBoardAnchorRef.current = null;
    lastPointerScreenRef.current = null;
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (interactionLocked) {
        setPlacementPreview(null);
        dragTouchOverBoardRef.current = false;
        lastBoardAnchorRef.current = null;
        lastPointerScreenRef.current = null;
        return;
      }
      const piece = event.active.data.current?.piece as PieceDef | undefined;
      if (!piece) {
        setPlacementPreview(null);
        dragTouchOverBoardRef.current = false;
        lastBoardAnchorRef.current = null;
        lastPointerScreenRef.current = null;
        return;
      }

      const overId = event.over?.id?.toString();
      const pos = parseCellId(overId);

      if (pos) {
        dragTouchOverBoardRef.current = true;
        const valid = canPlacePieceAt(piece, grid, pos.r, pos.c);
        const seen = new Set<string>();
        const cells: [number, number][] = [];
        for (const [dr, dc] of piece.cells) {
          const r = pos.r + dr;
          const c = pos.c + dc;
          const key = `${r}-${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cells.push([r, c]);
        }
        setPlacementPreview({ cells, valid });
        lastBoardAnchorRef.current = pos;
        return;
      }

      if (overId?.startsWith("hand-")) {
        setPlacementPreview(null);
        dragTouchOverBoardRef.current = false;
        lastBoardAnchorRef.current = null;
        return;
      }

      /* `over` null (finger between cells / iOS): keep last preview & anchor */
    },
    [grid, interactionLocked],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      dragTouchLiftPxRef.current = 0;
      dragTouchOverBoardRef.current = false;
      lastPointerScreenRef.current = null;
      const handIndex = event.active.data.current?.handIndex as number | undefined;
      const overId = event.over?.id?.toString();
      let pos = parseCellId(overId);
      if (pos == null && !overId && lastBoardAnchorRef.current != null) {
        pos = lastBoardAnchorRef.current;
      }

      setPlacementPreview(null);
      lastBoardAnchorRef.current = null;
      setDragPiece(null);

      if (interactionLocked) return;
      if (handIndex == null || pos == null) return;
      placePiece(handIndex, pos.r, pos.c);
    },
    [interactionLocked, placePiece],
  );

  const onDragCancel = useCallback(() => {
    dragTouchLiftPxRef.current = 0;
    dragTouchOverBoardRef.current = false;
    lastPointerScreenRef.current = null;
    setPlacementPreview(null);
    lastBoardAnchorRef.current = null;
    setDragPiece(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      modifiers={[snapCenterToCursor, liftTouchPieces]}
      collisionDetection={cellCollisionPointerFirst}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        className="flex min-h-[100svh] flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ touchAction: "none" }}
      >
        <header className="flex flex-shrink-0 items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              1010!
            </h1>
            <p className="text-xs text-slate-400">Drag pieces onto the grid</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-right shadow-inner">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Score
              </div>
              <div className="text-lg font-semibold tabular-nums text-cyan-300">
                {score}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-right shadow-inner">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Best
              </div>
              <div className="text-lg font-semibold tabular-nums text-amber-200">
                {bestScore}
              </div>
            </div>
            <button
              type="button"
              onClick={resetGame}
              className="rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow active:scale-[0.98]"
            >
              Reset
            </button>
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-5">
          <Board
            grid={grid}
            clearingKeys={clearingKeys}
            previewTint={previewTint}
            dragPreviewActive={placementPreview != null}
            onCellMetrics={handleCellMetrics}
            boardGridRef={boardGridRef}
          />

          <section
            className="flex w-full max-w-md flex-wrap items-end justify-center gap-3"
            aria-label="Hand"
          >
            {Array.from({ length: handSize }, (_, i) => (
              <HandPiece
                key={i}
                handIndex={i}
                piece={hand[i] ?? null}
                disabled={interactionLocked}
                cellSizePx={cellMetrics.cellSizePx}
                gapPx={cellMetrics.gapPx}
              />
            ))}
          </section>
        </main>

        {gameOver ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
              <h2 className="text-2xl font-bold text-white">Game Over</h2>
              <p className="mt-2 text-sm text-slate-400">
                No valid moves left for your pieces.
              </p>
              <p className="mt-4 text-lg tabular-nums text-cyan-300">
                Score: {score}
              </p>
              <button
                type="button"
                onClick={resetGame}
                className="mt-6 w-full rounded-2xl bg-cyan-500 py-3 text-base font-semibold text-slate-950 shadow-lg active:scale-[0.99]"
              >
                Play again
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <DragOverlay dropAnimation={null} zIndex={10000}>
        {dragPiece ? (
          <PiecePreview
            piece={dragPiece}
            cellSizePx={cellMetrics.cellSizePx}
            gapPx={cellMetrics.gapPx}
            className="pointer-events-none relative z-[10001] opacity-70"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
