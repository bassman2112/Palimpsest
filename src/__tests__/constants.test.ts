import { describe, it, expect } from "vitest";
import {
  HIGHLIGHT_COLORS,
  DRAG_THRESHOLD,
  MIN_RESIZE_DIM,
  MIN_SIGNATURE_WIDTH,
  MIN_SIGNATURE_HEIGHT,
  MIN_TEXT_WIDTH,
  MIN_TEXT_HEIGHT,
  INK_STROKE_PADDING,
  SHAPE_PADDING,
  DEFAULT_STROKE_WIDTH,
  FIT_ZOOM_PADDING,
  DEFAULT_SIGNATURE_SIZE,
  DEFAULT_TEXT_SIZE,
} from "../constants";

describe("HIGHLIGHT_COLORS", () => {
  it("has exactly 7 entries", () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(7);
  });

  it("each entry has a valid hex color and label", () => {
    for (const entry of HIGHLIGHT_COLORS) {
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe("numeric constants", () => {
  it("all thresholds and sizes are positive", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThan(0);
    expect(MIN_RESIZE_DIM).toBeGreaterThan(0);
    expect(MIN_SIGNATURE_WIDTH).toBeGreaterThan(0);
    expect(MIN_SIGNATURE_HEIGHT).toBeGreaterThan(0);
    expect(MIN_TEXT_WIDTH).toBeGreaterThan(0);
    expect(MIN_TEXT_HEIGHT).toBeGreaterThan(0);
    expect(INK_STROKE_PADDING).toBeGreaterThan(0);
    expect(SHAPE_PADDING).toBeGreaterThan(0);
    expect(DEFAULT_STROKE_WIDTH).toBeGreaterThan(0);
    expect(FIT_ZOOM_PADDING).toBeGreaterThan(0);
  });
});

describe("default sizes", () => {
  it("DEFAULT_SIGNATURE_SIZE has positive dimensions", () => {
    expect(DEFAULT_SIGNATURE_SIZE.width).toBeGreaterThan(0);
    expect(DEFAULT_SIGNATURE_SIZE.height).toBeGreaterThan(0);
  });

  it("DEFAULT_TEXT_SIZE has positive dimensions", () => {
    expect(DEFAULT_TEXT_SIZE.width).toBeGreaterThan(0);
    expect(DEFAULT_TEXT_SIZE.height).toBeGreaterThan(0);
  });
});
