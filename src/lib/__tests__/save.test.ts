import { describe, it, expect, vi } from "vitest";
import type { Annotation } from "../../types";
import {
  toSaveData,
  toInkSaveData,
  toShapeSaveData,
  toTextSaveData,
  toSignatureData,
} from "../save";

// Mock htmlToPlainText since it uses DOM APIs (document.createElement)
vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, ""),
  };
});

const highlight: Annotation = {
  id: "h1",
  type: "highlight",
  pageNumber: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.04,
  color: "#ffff00",
};

const stickyNote: Annotation = {
  id: "sn1",
  type: "sticky-note",
  pageNumber: 2,
  x: 0.5,
  y: 0.5,
  text: "Hello note",
  color: "#ffeb3b",
};

const underline: Annotation = {
  id: "u1",
  type: "underline",
  pageNumber: 1,
  x: 0.1,
  y: 0.3,
  width: 0.4,
  height: 0.02,
  color: "#000000",
};

const strikethrough: Annotation = {
  id: "st1",
  type: "strikethrough",
  pageNumber: 1,
  x: 0.1,
  y: 0.35,
  width: 0.4,
  height: 0.02,
  color: "#ff0000",
};

const ink: Annotation = {
  id: "ink1",
  type: "ink",
  pageNumber: 1,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  paths: [
    [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ],
  ],
  color: "#0000ff",
  strokeWidth: 2,
};

const shape: Annotation = {
  id: "sh1",
  type: "shape",
  shape: "rectangle",
  pageNumber: 3,
  x1: 0.1,
  y1: 0.2,
  x2: 0.5,
  y2: 0.6,
  color: "#ff0000",
  strokeWidth: 3,
};

const text: Annotation = {
  id: "t1",
  type: "text",
  pageNumber: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
  text: "<b>Bold</b> text",
  color: "#000000",
  fontSize: 14,
  fontFamily: "sans-serif",
  bold: true,
  italic: false,
  underline: false,
  backgroundColor: "transparent",
};

const signature: Annotation = {
  id: "sig1",
  type: "signature",
  pageNumber: 1,
  x: 0.2,
  y: 0.3,
  width: 0.15,
  height: 0.06,
  imageData: "data:image/jpeg;base64,AAABBBCCC",
};

describe("toSaveData", () => {
  it("returns empty array for empty input", () => {
    expect(toSaveData([])).toEqual([]);
  });

  it("filters out ink, shape, text, signature types", () => {
    const result = toSaveData([ink, shape, text, signature]);
    expect(result).toEqual([]);
  });

  it("converts highlight annotation", () => {
    const [result] = toSaveData([highlight]);
    expect(result.annotation_type).toBe("highlight");
    expect(result.page_number).toBe(1);
    expect(result.x).toBe(0.1);
    expect(result.y).toBe(0.2);
    expect(result.width).toBe(0.3);
    expect(result.height).toBe(0.04);
    expect(result.color).toEqual([1, 1, 0]);
    expect(result.text).toBe("");
  });

  it("converts sticky note with width/height = 0", () => {
    const [result] = toSaveData([stickyNote]);
    expect(result.annotation_type).toBe("sticky-note");
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.text).toBe("Hello note");
  });

  it("converts underline annotation", () => {
    const [result] = toSaveData([underline]);
    expect(result.annotation_type).toBe("underline");
  });

  it("converts strikethrough annotation", () => {
    const [result] = toSaveData([strikethrough]);
    expect(result.annotation_type).toBe("strikethrough");
  });

  it("handles mixed types, keeping only highlight/note/underline/strikethrough", () => {
    const all = [highlight, stickyNote, underline, strikethrough, ink, shape, text, signature];
    const result = toSaveData(all);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.annotation_type)).toEqual([
      "highlight",
      "sticky-note",
      "underline",
      "strikethrough",
    ]);
  });
});

describe("toInkSaveData", () => {
  it("returns empty array for empty input", () => {
    expect(toInkSaveData([])).toEqual([]);
  });

  it("filters to only ink annotations", () => {
    expect(toInkSaveData([highlight, shape, text])).toEqual([]);
  });

  it("flattens path points to [x1, y1, x2, y2, ...]", () => {
    const [result] = toInkSaveData([ink]);
    expect(result.paths).toEqual([[0.1, 0.2, 0.3, 0.4]]);
    expect(result.color).toEqual([0, 0, 1]);
    expect(result.stroke_width).toBe(2);
  });

  it("handles multiple strokes", () => {
    const multiStroke: Annotation = {
      ...ink,
      paths: [
        [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ],
        [
          { x: 0.5, y: 0.6 },
          { x: 0.7, y: 0.8 },
        ],
      ],
    };
    const [result] = toInkSaveData([multiStroke]);
    expect(result.paths).toEqual([
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.6, 0.7, 0.8],
    ]);
  });
});

describe("toShapeSaveData", () => {
  it("returns empty array for empty input", () => {
    expect(toShapeSaveData([])).toEqual([]);
  });

  it("filters to only shape annotations", () => {
    expect(toShapeSaveData([highlight, ink, text])).toEqual([]);
  });

  it("preserves shape kind and coordinates", () => {
    const [result] = toShapeSaveData([shape]);
    expect(result.shape).toBe("rectangle");
    expect(result.x1).toBe(0.1);
    expect(result.y1).toBe(0.2);
    expect(result.x2).toBe(0.5);
    expect(result.y2).toBe(0.6);
    expect(result.color).toEqual([1, 0, 0]);
    expect(result.stroke_width).toBe(3);
  });
});

describe("toTextSaveData", () => {
  it("returns empty array for empty input", () => {
    expect(toTextSaveData([])).toEqual([]);
  });

  it("filters to only text annotations", () => {
    expect(toTextSaveData([highlight, ink, shape])).toEqual([]);
  });

  it("strips HTML from text and preserves formatting fields", () => {
    const [result] = toTextSaveData([text]);
    expect(result.text).toBe("Bold text");
    expect(result.font_size).toBe(14);
    expect(result.font_family).toBe("sans-serif");
    expect(result.bold).toBe(true);
    expect(result.italic).toBe(false);
    expect(result.underline).toBe(false);
    expect(result.background_color).toBe("transparent");
  });
});

describe("toSignatureData", () => {
  it("returns empty array for empty input", () => {
    expect(toSignatureData([])).toEqual([]);
  });

  it("filters to only signature annotations", () => {
    expect(toSignatureData([highlight, ink, shape, text])).toEqual([]);
  });

  it("strips data URL prefix from JPEG", () => {
    const [result] = toSignatureData([signature]);
    expect(result.image_base64).toBe("AAABBBCCC");
    expect(result.page_number).toBe(1);
    expect(result.x).toBe(0.2);
    expect(result.y).toBe(0.3);
    expect(result.width).toBe(0.15);
    expect(result.height).toBe(0.06);
  });

  it("strips data URL prefix from PNG", () => {
    const pngSig: Annotation = {
      ...signature,
      imageData: "data:image/png;base64,XXYYZZ",
    };
    const [result] = toSignatureData([pngSig]);
    expect(result.image_base64).toBe("XXYYZZ");
  });
});
