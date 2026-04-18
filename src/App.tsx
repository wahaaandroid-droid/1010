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

/** Extra vertical offset while dragging on touch so the piece clears the finger. */
const DRAG_TOUCH_LIFT_PX = 96;

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
  /** Drives the board-only placement ghost (same anchor as preview / drop). */
  const [ghostAnchor, setGhostAnchor] = useState<{ r: number; c: number } | null>(null);

  /** Last board anchor while dragging — touch often clears `over` on release before `onDragEnd` */
  const lastBoardAnchorRef = useRef<{ r: number; c: number } | null>(null);

  /** Touch-only lift applied to drag transform (visual only — not used for hit-testing). */
  const dragTouchLiftPxRef = useRef(0);

  /** Touch sometimes omits `pointerCoordinates`; keep last screen point for collision. */
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null);

  const liftTouchPieces: Modifier = useMemo(
    () => (args) => {
      const lift = dragTouchLiftPxRef.current;
      if (!lift) return args.transform;
      return { ...args.transform, y: args.transform.y - lift };
    },
    [],
  );

  /**
   * Prefer the real pointer for which cell is active. (Do not subtract touch lift here: the
   * overlay is snapped on the board, so a lifted test point often sits above the grid and
   * freezes `over`.) If the runtime omits coordinates, reuse the last known point.
   */
  const cellCollisionPointerFirst = useMemo<CollisionDetection>(
    () => (args) => {
      const pc = args.pointerCoordinates;
      if (pc) {
        lastPointerScreenRef.current = { x: pc.x, y: pc.y };
      }
      const pt = pc ?? lastPointerScreenRef.current;

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
    const p = event.active.data.current?.piece as PieceDef | undefined;
    setDragPiece(p ?? null);
    setPlacementPreview(null);
    setGhostAnchor(null);
    lastBoardAnchorRef.current = null;
    lastPointerScreenRef.current = null;
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (interactionLocked) {
        setPlacementPreview(null);
        setGhostAnchor(null);
        lastBoardAnchorRef.current = null;
        lastPointerScreenRef.current = null;
        return;
      }
      const piece = event.active.data.current?.piece as PieceDef | undefined;
      if (!piece) {
        setPlacementPreview(null);
        setGhostAnchor(null);
        lastBoardAnchorRef.current = null;
        lastPointerScreenRef.current = null;
        return;
      }

      const overId = event.over?.id?.toString();
      const pos = parseCellId(overId);

      if (pos) {
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
        setGhostAnchor(pos);
        lastBoardAnchorRef.current = pos;
        return;
      }

      if (overId?.startsWith("hand-")) {
        setPlacementPreview(null);
        setGhostAnchor(null);
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
      lastPointerScreenRef.current = null;
      setGhostAnchor(null);
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
    lastPointerScreenRef.current = null;
    setGhostAnchor(null);
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
            cellSizePx={cellMetrics.cellSizePx}
            gapPx={cellMetrics.gapPx}
            placementGhost={
              dragPiece && ghostAnchor
                ? { piece: dragPiece, anchor: ghostAnchor }
                : null
            }
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

      <DragOverlay dropAnimation={null} zIndex={500}>
        {/*
          Over the board the visible piece is drawn on the grid (placementGhost); keep an invisible
          overlay so dnd-kit still measures a stable drag rect and collision tracks the pointer.
        */}
        {dragPiece ? (
          <PiecePreview
            piece={dragPiece}
            cellSizePx={cellMetrics.cellSizePx}
            gapPx={cellMetrics.gapPx}
            className={
              placementPreview != null
                ? "pointer-events-none opacity-0"
                : "drop-shadow-2xl"
            }
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
