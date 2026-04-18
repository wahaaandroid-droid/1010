import { useCallback, useEffect, useState } from "react";

export type ShapeKind =
  | "dot"
  | "line_h"
  | "line_v"
  | "square"
  | "l"
  | "t"
  | "s"
  | "z";

export interface PieceDef {
  id: string;
  kind: ShapeKind;
  /** Relative cells [row, col] from anchor; normalized to min 0 */
  cells: [number, number][];
}

const GRID_SIZE = 10;
const HAND_SIZE = 3;
const BEST_KEY = "1010-best-score";

export const KIND_TO_COLOR: Record<ShapeKind, string> = {
  dot: "bg-blue-500",
  line_h: "bg-purple-500",
  line_v: "bg-indigo-500",
  square: "bg-emerald-500",
  l: "bg-amber-500",
  t: "bg-rose-500",
  s: "bg-cyan-500",
  z: "bg-fuchsia-500",
};

/** 0 = empty; otherwise shape kind for coloring */
export type GridCell = 0 | ShapeKind;

type Preset = { kind: ShapeKind; cells: [number, number][] };

const PRESETS: Preset[] = [
  { kind: "dot", cells: [[0, 0]] },
  { kind: "line_h", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { kind: "line_v", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { kind: "square", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { kind: "l", cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { kind: "l", cells: [[0, 1], [1, 1], [2, 0], [2, 1]] },
  { kind: "l", cells: [[0, 0], [0, 1], [0, 2], [1, 0]] },
  { kind: "l", cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  { kind: "t", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { kind: "t", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { kind: "t", cells: [[1, 0], [1, 1], [1, 2], [0, 1]] },
  { kind: "t", cells: [[0, 1], [1, 0], [1, 1], [2, 1]] },
  { kind: "s", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { kind: "z", cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
];

function normalizeCells(cells: [number, number][]): [number, number][] {
  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of cells) {
    minR = Math.min(minR, r);
    minC = Math.min(minC, c);
  }
  return cells.map(([r, c]) => [r - minR, c - minC] as [number, number]);
}

function randomPiece(): PieceDef {
  const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)]!;
  return {
    id: crypto.randomUUID(),
    kind: preset.kind,
    cells: normalizeCells(preset.cells),
  };
}

function dealHand(): (PieceDef | null)[] {
  return [randomPiece(), randomPiece(), randomPiece()];
}

function emptyGrid(): GridCell[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, (): GridCell => 0),
  );
}

function canPlaceAt(
  piece: PieceDef,
  grid: GridCell[][],
  anchorR: number,
  anchorC: number,
): boolean {
  for (const [dr, dc] of piece.cells) {
    const r = anchorR + dr;
    const c = anchorC + dc;
    if (r < 0 || c < 0 || r >= GRID_SIZE || c >= GRID_SIZE) return false;
    if (grid[r]![c] !== 0) return false;
  }
  return true;
}

function hasAnyPlacement(piece: PieceDef, grid: GridCell[][]): boolean {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (canPlaceAt(piece, grid, r, c)) return true;
    }
  }
  return false;
}

function handHasAnyMove(hand: (PieceDef | null)[], grid: GridCell[][]): boolean {
  for (const p of hand) {
    if (p && hasAnyPlacement(p, grid)) return true;
  }
  return false;
}

function cloneGrid(g: GridCell[][]): GridCell[][] {
  return g.map((row) => row.slice());
}

function collectLinesToClear(grid: GridCell[][]): {
  rows: number[];
  cols: number[];
} {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    if (grid[r]!.every((cell) => cell !== 0)) rows.push(r);
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    let full = true;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (grid[r]![c] === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

function cellsFromLines(rows: number[], cols: number[]): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    for (let c = 0; c < GRID_SIZE; c++) set.add(`${r}-${c}`);
  }
  for (const c of cols) {
    for (let r = 0; r < GRID_SIZE; r++) set.add(`${r}-${c}`);
  }
  return set;
}

function applyClear(grid: GridCell[][], rows: number[], cols: number[]): GridCell[][] {
  const next = cloneGrid(grid);
  for (const r of rows) {
    for (let c = 0; c < GRID_SIZE; c++) next[r]![c] = 0;
  }
  for (const c of cols) {
    for (let r = 0; r < GRID_SIZE; r++) next[r]![c] = 0;
  }
  return next;
}

function readBestFromStorage(): number {
  const raw = localStorage.getItem(BEST_KEY);
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

export function useGameLogic() {
  const [grid, setGrid] = useState<GridCell[][]>(() => emptyGrid());
  const [hand, setHand] = useState<(PieceDef | null)[]>(() => dealHand());
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => readBestFromStorage());
  const [gameOver, setGameOver] = useState(false);
  const [clearingKeys, setClearingKeys] = useState<Set<string> | null>(null);

  useEffect(() => {
    setBestScore((prev) => {
      if (score > prev) {
        localStorage.setItem(BEST_KEY, String(score));
        return score;
      }
      return prev;
    });
  }, [score]);

  const tryFinishClear = useCallback(
    (nextGrid: GridCell[][], gained: number, nextHand: (PieceDef | null)[]) => {
      setGrid(nextGrid);
      setScore((s) => s + gained);
      setHand(nextHand);
      setClearingKeys(null);

      const filledHand = nextHand.some((p) => p !== null);
      if (filledHand && !handHasAnyMove(nextHand, nextGrid)) {
        setGameOver(true);
      }
    },
    [],
  );

  const placePiece = useCallback(
    (handIndex: number, anchorR: number, anchorC: number): boolean => {
      if (gameOver || clearingKeys) return false;
      const piece = hand[handIndex];
      if (!piece) return false;
      if (!canPlaceAt(piece, grid, anchorR, anchorC)) return false;

      const placed = cloneGrid(grid);
      for (const [dr, dc] of piece.cells) {
        const r = anchorR + dr;
        const c = anchorC + dc;
        placed[r]![c] = piece.kind;
      }

      const nextHand = hand.slice() as (PieceDef | null)[];
      nextHand[handIndex] = null;

      let handAfter = nextHand;
      if (nextHand.every((p) => p === null)) {
        handAfter = dealHand();
      }

      const { rows, cols } = collectLinesToClear(placed);
      if (rows.length > 0 || cols.length > 0) {
        const keys = cellsFromLines(rows, cols);
        const cellCount = keys.size;
        const lineCount = rows.length + cols.length;
        const gained = cellCount * 10 + lineCount * 25;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(50);
        }
        setGrid(placed);
        setHand(handAfter);
        setClearingKeys(keys);
        window.setTimeout(() => {
          const cleared = applyClear(placed, rows, cols);
          tryFinishClear(cleared, gained, handAfter);
        }, 420);
      } else {
        setGrid(placed);
        setHand(handAfter);
        const filledHand = handAfter.some((p) => p !== null);
        if (filledHand && !handHasAnyMove(handAfter, placed)) {
          setGameOver(true);
        }
      }

      return true;
    },
    [clearingKeys, gameOver, grid, hand, tryFinishClear],
  );

  const resetGame = useCallback(() => {
    setGrid(emptyGrid());
    setHand(dealHand());
    setScore(0);
    setGameOver(false);
    setClearingKeys(null);
  }, []);

  return {
    grid,
    hand,
    score,
    bestScore,
    gameOver,
    clearingKeys,
    placePiece,
    resetGame,
    gridSize: GRID_SIZE,
    handSize: HAND_SIZE,
  };
}
