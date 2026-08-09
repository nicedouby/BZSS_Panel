export const SQUAD_MAJOR_GRID_METERS = 300;

const MAX_NORMALIZED_POSITION = 1 - Number.EPSILON;

export interface SquadGridCoordinate {
  columnIndex: number;
  rowIndex: number;
  grid: string;
  keypads: number[];
  label: string;
}

export interface SquadGridCell {
  index: number;
  label: string;
  startPercent: number;
  endPercent: number;
  centerPercent: number;
}

function clampNormalized(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_NORMALIZED_POSITION, Math.max(0, value));
}

export function squadGridColumnLabel(index: number) {
  let remaining = Math.max(0, Math.floor(index));
  let label = "";

  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return label;
}

function keypadDigit(xFraction: number, yFraction: number) {
  const normalizedX = clampNormalized(xFraction);
  const normalizedY = clampNormalized(yFraction);
  const column = Math.min(2, Math.floor(normalizedX * 3));
  const rowFromTop = Math.min(2, Math.floor(normalizedY * 3));
  return {
    digit: (2 - rowFromTop) * 3 + column + 1,
    xFraction: normalizedX * 3 - column,
    yFraction: normalizedY * 3 - rowFromTop,
  };
}

/**
 * Convert a position on a Squad minimap into its radio-callout coordinate.
 * The first 300 m cell is A1. Each requested precision level recursively uses
 * a PC numeric keypad layout (7-8-9 at the top, 1-2-3 at the bottom).
 */
export function formatSquadGridCoordinate(
  normalizedX: number,
  normalizedY: number,
  widthMeters: number,
  heightMeters: number,
  precision = 2,
): SquadGridCoordinate | null {
  if (!(widthMeters > 0) || !(heightMeters > 0)) return null;

  const xMeters = clampNormalized(normalizedX) * widthMeters;
  const yMeters = clampNormalized(normalizedY) * heightMeters;
  const columnIndex = Math.floor(xMeters / SQUAD_MAJOR_GRID_METERS);
  const rowIndex = Math.floor(yMeters / SQUAD_MAJOR_GRID_METERS);
  const grid = `${squadGridColumnLabel(columnIndex)}${rowIndex + 1}`;

  let localX = (xMeters % SQUAD_MAJOR_GRID_METERS) / SQUAD_MAJOR_GRID_METERS;
  let localY = (yMeters % SQUAD_MAJOR_GRID_METERS) / SQUAD_MAJOR_GRID_METERS;
  const keypads: number[] = [];

  for (let level = 0; level < Math.max(0, Math.floor(precision)); level += 1) {
    const keypad = keypadDigit(localX, localY);
    keypads.push(keypad.digit);
    localX = keypad.xFraction;
    localY = keypad.yFraction;
  }

  return {
    columnIndex,
    rowIndex,
    grid,
    keypads,
    label: [grid, ...keypads].join("-"),
  };
}

export function buildSquadMajorGridCells(
  lengthMeters: number,
  axis: "column" | "row",
): SquadGridCell[] {
  if (!(lengthMeters > 0)) return [];
  const count = Math.ceil(lengthMeters / SQUAD_MAJOR_GRID_METERS);

  return Array.from({ length: count }, (_, index) => {
    const startMeters = index * SQUAD_MAJOR_GRID_METERS;
    const endMeters = Math.min(lengthMeters, startMeters + SQUAD_MAJOR_GRID_METERS);
    const startPercent = (startMeters / lengthMeters) * 100;
    const endPercent = (endMeters / lengthMeters) * 100;
    return {
      index,
      label: axis === "column" ? squadGridColumnLabel(index) : String(index + 1),
      startPercent,
      endPercent,
      centerPercent: (startPercent + endPercent) / 2,
    };
  });
}

export function buildSquadMajorGridLines(lengthMeters: number) {
  if (!(lengthMeters > 0)) return [];
  const cells = buildSquadMajorGridCells(lengthMeters, "row");
  return [
    ...cells.map((cell) => cell.startPercent),
    100,
  ];
}
