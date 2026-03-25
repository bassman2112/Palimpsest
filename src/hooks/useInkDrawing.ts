import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationTool, PageDimension } from "../types";

interface UseInkDrawingOptions {
  activeTool: AnnotationTool;
  highlightColor: string;
  strokeWidth: number;
  dimension: PageDimension;
  zoom: number;
  pageNumber: number;
  onAddAnnotation: (annotation: Annotation) => void;
}

export function useInkDrawing({
  activeTool,
  highlightColor,
  strokeWidth,
  dimension,
  zoom,
  pageNumber,
  onAddAnnotation,
}: UseInkDrawingOptions) {
  const inkDrawingRef = useRef(false);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const inkStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const [, setInkVersion] = useState(0);

  const inkStartStroke = useCallback((x: number, y: number) => {
    inkDrawingRef.current = true;
    inkPointsRef.current = [{ x, y }];

    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
  }, [highlightColor, strokeWidth]);

  const inkAddPoint = useCallback((x: number, y: number) => {
    inkPointsRef.current.push({ x, y });
    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }, []);

  const inkEndStroke = useCallback(() => {
    inkDrawingRef.current = false;
    const points = inkPointsRef.current;
    if (points.length < 2) return;

    inkStrokesRef.current.push([...points]);
    inkPointsRef.current = [];

    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (canvas && inkStrokesRef.current.length > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const stroke of inkStrokesRef.current) {
          ctx.beginPath();
          ctx.moveTo(stroke[0].x, stroke[0].y);
          for (let i = 1; i < stroke.length; i++) {
            ctx.lineTo(stroke[i].x, stroke[i].y);
          }
          ctx.stroke();
        }
      }
    }

    setInkVersion((v) => v + 1);
  }, [highlightColor, strokeWidth]);

  // Commit all accumulated ink strokes when tool changes away from ink
  const prevToolRef = useRef(activeTool);
  useEffect(() => {
    if (prevToolRef.current === "ink" && activeTool !== "ink") {
      const strokes = inkStrokesRef.current;
      if (strokes.length > 0) {
        const pageW = dimension.width * zoom;
        const pageH = dimension.height * zoom;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
          for (const pt of stroke) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          }
        }

        const normPaths = strokes.map((stroke) =>
          stroke.map((pt) => ({
            x: pt.x / pageW,
            y: pt.y / pageH,
          }))
        );

        onAddAnnotation({
          id: crypto.randomUUID(),
          type: "ink",
          pageNumber,
          x: minX / pageW,
          y: minY / pageH,
          width: (maxX - minX) / pageW,
          height: (maxY - minY) / pageH,
          paths: normPaths,
          color: highlightColor,
          strokeWidth,
        });

        inkStrokesRef.current = [];
        const canvas = inkCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    prevToolRef.current = activeTool;
  }, [activeTool, dimension, zoom, pageNumber, highlightColor, strokeWidth, onAddAnnotation]);

  return {
    inkDrawingRef,
    inkCanvasRef,
    inkStartStroke,
    inkAddPoint,
    inkEndStroke,
  };
}
