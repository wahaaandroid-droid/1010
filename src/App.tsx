import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useState } from "react";
import { Board } from "./components/Board";
import { HandPiece, PiecePreview } from "./components/Piece";
import type { PieceDef } from "./hooks/useGameLogic";
import { useGameLogic } from "./hooks/useGameLogic";

function parseCellId(id: string | undefined): { r: number; c: number } | null {
  if (!id || !id.startsWith("cell-")) return null;
  const rest = id.slice("cell-".length);
  const parts = rest.split("-");
  if (parts.length !== 2) return null;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  if (Number.isNaN(r) || Number.isNaN(c)) return null;
  return { r, c };
}

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

  const [activePiece, setActivePiece] = useState<PieceDef | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );

  const interactionLocked = gameOver || clearingKeys != null;

  const onDragStart = useCallback((event: DragStartEvent) => {
    const p = event.active.data.current?.piece as PieceDef | undefined;
    setActivePiece(p ?? null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActivePiece(null);
      if (interactionLocked) return;
      const handIndex = event.active.data.current?.handIndex as number | undefined;
      const overId = event.over?.id?.toString();
      const pos = parseCellId(overId);
      if (handIndex == null || pos == null) return;
      placePiece(handIndex, pos.r, pos.c);
    },
    [interactionLocked, placePiece],
  );

  const onDragCancel = useCallback(() => setActivePiece(null), []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
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
          <Board grid={grid} clearingKeys={clearingKeys} />

          <section
            className="flex w-full max-w-md items-end justify-center gap-3"
            aria-label="Hand"
          >
            {Array.from({ length: handSize }, (_, i) => (
              <HandPiece
                key={i}
                handIndex={i}
                piece={hand[i] ?? null}
                disabled={interactionLocked}
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

      <DragOverlay dropAnimation={null}>
        {activePiece ? <PiecePreview piece={activePiece} dragLift /> : null}
      </DragOverlay>
    </DndContext>
  );
}
