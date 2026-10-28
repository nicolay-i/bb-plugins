import { describe, expect, it } from "vitest";
import { DRAWING_JS, strokeBounds, strokeKept, strokePath } from "./drawing";
import type { Stroke } from "./types";

const pen: Stroke = { tool: "pen", points: [10, 20, 30, 25, 50, 60] };
const arrow: Stroke = { tool: "arrow", points: [0, 0, 100, 0] };
const dot: Stroke = { tool: "pen", points: [5, 5] };
const line: Stroke = { tool: "line", points: [10, 10, 40, 30] };
const box: Stroke = { tool: "rect", points: [40, 30, 10, 10] };

const js = new Function(`${DRAWING_JS}; return { drawingBounds, drawingPath, drawingKept };`)() as {
  drawingBounds: (strokes: Stroke[]) => unknown;
  drawingPath: (stroke: Stroke, sx: number, sy: number, head: number) => string;
  drawingKept: (stroke: Stroke, w: number, h: number) => boolean;
};

describe("drawing geometry", () => {
  it("bounds every point of every stroke", () => {
    expect(strokeBounds([pen, arrow])).toEqual({ x0: 0, y0: 0, x1: 100, y1: 60 });
    expect(strokeBounds([])).toBeNull();
  });

  it("draws a pen stroke as a polyline, scaled", () => {
    expect(strokePath(pen, 2, 1, 10)).toBe("M20 20L60 25L100 60");
  });

  it("gives an arrow a head at its last point", () => {
    const d = strokePath(arrow, 1, 1, 10);
    expect(d).toBe("M0 0L100 0M90.99 4.34L100 0L90.99 -4.34");
  });

  it("keeps a tap visible", () => {
    expect(strokePath(dot, 1, 1, 10)).toBe("M5 5l0.01 0");
  });

  it("draws a line and a box from their two points", () => {
    expect(strokePath(line, 2, 1, 10)).toBe("M20 10L80 30");
    expect(strokePath(box, 1, 1, 10)).toBe("M40 30L10 30L10 10L40 10Z");
    expect(strokeBounds([box])).toEqual({ x0: 10, y0: 10, x1: 40, y1: 30 });
  });

  it("drops a click with a shape tool and keeps a pen tap", () => {
    expect(strokeKept(dot, 1, 1)).toBe(true);
    expect(strokeKept({ tool: "line", points: [5, 5, 5, 5] }, 1, 1)).toBe(false);
    expect(strokeKept({ tool: "arrow", points: [0, 0, 0.01, 0] }, 100, 100)).toBe(false);
    expect(strokeKept({ tool: "arrow", points: [0, 0, 0.1, 0] }, 100, 100)).toBe(true);
    // A box needs room both ways: a flat one is a line, not a frame.
    expect(strokeKept({ tool: "rect", points: [0, 0, 50, 2] }, 1, 1)).toBe(false);
    expect(strokeKept(box, 1, 1)).toBe(true);
  });

  it("matches the copy that runs in pages", () => {
    for (const stroke of [pen, arrow, dot, line, box]) {
      expect(js.drawingPath(stroke, 1.5, 0.5, 12)).toBe(strokePath(stroke, 1.5, 0.5, 12));
      expect(js.drawingKept(stroke, 3, 2)).toBe(strokeKept(stroke, 3, 2));
    }
    expect(js.drawingBounds([pen, arrow])).toEqual(strokeBounds([pen, arrow]));
  });
});
