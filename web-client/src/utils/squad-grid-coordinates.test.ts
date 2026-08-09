import { describe, expect, it } from "vitest";
import {
  buildSquadMajorGridCells,
  formatSquadGridCoordinate,
  squadGridColumnLabel,
} from "./squad-grid-coordinates";

describe("Squad map grid coordinates", () => {
  it("uses the PC numeric keypad orientation recursively", () => {
    expect(formatSquadGridCoordinate(0, 0, 600, 600)?.label).toBe("A1-7-7");
    expect(formatSquadGridCoordinate(0.25, 0.25, 600, 600)?.label).toBe("A1-5-5");
    expect(formatSquadGridCoordinate(0.0001, 0.4999, 600, 600)?.label).toBe("A1-1-1");
  });

  it("advances the alphanumeric main grid at each 300 metre boundary", () => {
    expect(formatSquadGridCoordinate(0.5, 0, 600, 600)?.label).toBe("B1-7-7");
    expect(formatSquadGridCoordinate(0, 0.5, 600, 600)?.label).toBe("A2-7-7");
  });

  it("advances to the next keypad at an exact 100 metre boundary", () => {
    expect(formatSquadGridCoordinate(1 / 6, 0, 600, 600)?.label).toBe("A1-8-7");
  });

  it("keeps positions on the bottom and right edges inside the final cell", () => {
    expect(formatSquadGridCoordinate(1, 1, 600, 600)?.label).toBe("B2-3-3");
  });

  it("supports column names beyond Z", () => {
    expect(squadGridColumnLabel(0)).toBe("A");
    expect(squadGridColumnLabel(25)).toBe("Z");
    expect(squadGridColumnLabel(26)).toBe("AA");
  });

  it("keeps a partial final 300 metre cell", () => {
    const cells = buildSquadMajorGridCells(650, "column");
    expect(cells.map((cell) => cell.label)).toEqual(["A", "B", "C"]);
    expect(cells[2]?.endPercent).toBe(100);
    expect(cells[2]?.centerPercent).toBeCloseTo(96.1538, 3);
  });

  it("rejects maps without usable physical dimensions", () => {
    expect(formatSquadGridCoordinate(0.5, 0.5, 0, 600)).toBeNull();
  });
});
