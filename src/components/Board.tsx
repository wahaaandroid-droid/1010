import { useDroppable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import type { GridCell, ShapeKind } from "../hooks/useGameLogic";
import { KIND_TO_COLOR } from "../hooks/useGameLogic";

const BOARD_GAP = "0.35rem";

function BoardCell({
  r,
  c,
  cell,
  clearingKeys,
}: {
  r: number;
  c: number;
  cell: GridCell;
  clearingKeys: Set<string> | null;
}) {
  const id = `cell-${r}-${c}`;
  const { isOver, setNodeRef } = useDroppable({ id });
  const key = `${r}-${c}`;
  const isClearing = clearingKeys?.has(key) ?? false;
  const filled = cell !== 0;
  const color = filled ? KIND_TO_COLOR[cell as ShapeKind] : "";

  return (
    <div
      ref={setNodeRef}
      className={`relative aspect-square rounded-lg border transition-colors ${
        isOver
          ? "border-cyan-400/80 bg-slate-700/50"
          : "border-slate-800 bg-slate-900/60"
      }`}
    >
      {filled ? (
        <motion.div
          className={`absolute inset-[3px] rounded-md shadow-md ${color}`}
          animate={
            isClearing
              ? { opacity: 0, scale: 0.35 }
              : { opacity: 1, scale: 1 }
          }
          transition={{ duration: 0.35, ease: "easeInOut" }}
        />
      ) : null}
    </div>
  );
}

export interface BoardProps {
  grid: GridCell[][];
  clearingKeys: Set<string> | null;
}

export function Board({ grid, clearingKeys }: BoardProps) {
  return (
    <div
      className="w-full max-w-[min(100vw-2rem,100svh-14rem)]"
      style={{ touchAction: "none" }}
    >
      <div
        className="aspect-square w-full rounded-3xl border border-slate-800 bg-slate-950/80 p-3 shadow-2xl ring-1 ring-white/5"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(10, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(10, minmax(0, 1fr))`,
          gap: BOARD_GAP,
        }}
      >
        {grid.map((row, r) =>
          row.map((cell, c) => (
            <BoardCell
              key={`${r}-${c}`}
              r={r}
              c={c}
              cell={cell}
              clearingKeys={clearingKeys}
            />
          )),
        )}
      </div>
    </div>
  );
}
