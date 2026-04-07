import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Vertex, Edge } from '../App';
import {
  getPolygonVerts, firstCrossing, wrapPos, wrapDir, tracePath,
  edgeColor, edgeLabel, insidePolygon,
  add, sub, scale, norm, len, dot,
  type Vec2,
} from '../geometry';

interface PolygonCanvasProps {
  vertices: Vertex[];
  edges: Edge[];
  genus: number;
  currentTool: 'vertex' | 'edge' | 'eraser';
  onAddVertex: (x: number, y: number) => void;
  onAddEdge: (fromId: string, toId: string, vx: number, vy: number) => void;
  onRemoveVertex: (id: string) => void;
  onRemoveEdge: (id: string) => void;
  onMoveVertex: (id: string, dx: number, dy: number) => void;
  onStartMove: () => void;
  onEndMove: () => void;
  crossingInfo: null | { fromId: string; toId: string };
  duplicateEdgeInfo: null | { fromId: string; toId: string };
  maxClique: Set<string>;
}

// Draw an edge path with wrapping, collecting moveTo/lineTo segments
function drawEdgePath(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  vx: number,
  vy: number,
  g: number,
  verts: Vec2[],
  toScreen: (p: Vec2) => { x: number; y: number }
) {
  let pos: Vec2 = { x: fromX, y: fromY };
  let rem: Vec2 = { x: vx, y: vy };
  ctx.beginPath();
  const s0 = toScreen(pos);
  ctx.moveTo(s0.x, s0.y);
  for (let iter = 0; iter < 6; iter++) {
    const cross = firstCrossing(pos, rem, verts);
    if (!cross) {
      const s = toScreen(add(pos, rem));
      ctx.lineTo(s.x, s.y);
      break;
    }
    const crossPt = add(pos, scale(rem, cross.t));
    const sc = toScreen(crossPt);
    ctx.lineTo(sc.x, sc.y);
    const remLen = len(rem) * (1 - cross.t);
    const newDir = wrapDir(norm(rem), cross.edgeIndex, g, verts);
    pos = wrapPos(crossPt, cross.edgeIndex, g, verts);
    rem = scale(newDir, remLen);
    const sp = toScreen(pos);
    ctx.moveTo(sp.x, sp.y);
  }
  ctx.stroke();
}

// Collect segment endpoints for edge path (for hit testing)
function getEdgeSegments(
  fromX: number, fromY: number, vx: number, vy: number,
  g: number, verts: Vec2[]
): Array<[Vec2, Vec2]> {
  const segs: Array<[Vec2, Vec2]> = [];
  let pos: Vec2 = { x: fromX, y: fromY };
  let rem: Vec2 = { x: vx, y: vy };
  for (let iter = 0; iter < 6; iter++) {
    const cross = firstCrossing(pos, rem, verts);
    if (!cross) {
      segs.push([pos, add(pos, rem)]);
      break;
    }
    const crossPt = add(pos, scale(rem, cross.t));
    segs.push([pos, crossPt]);
    const remLen = len(rem) * (1 - cross.t);
    const newDir = wrapDir(norm(rem), cross.edgeIndex, g, verts);
    pos = wrapPos(crossPt, cross.edgeIndex, g, verts);
    rem = scale(newDir, remLen);
  }
  return segs;
}

function pointToSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-12) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, scale(ab, t))));
}

export const PolygonCanvas: React.FC<PolygonCanvasProps> = ({
  vertices, edges, genus, currentTool,
  onAddVertex, onAddEdge, onRemoveVertex, onRemoveEdge,
  onMoveVertex, onStartMove, onEndMove,
  crossingInfo, duplicateEdgeInfo, maxClique,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeDrag, setActiveDrag] = useState<{
    fromId: string;
    fromX: number;
    fromY: number;
    vx: number;
    vy: number;
    isDragging: boolean;
  } | null>(null);

  const [vertexDragId, setVertexDragId] = useState<string | null>(null);
  const [isPointerOutside, setIsPointerOutside] = useState(false);

  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  const lastTouchPos = useRef<{ x: number; y: number } | null>(null);

  // Refs for values needed in closures without re-registering listeners
  const verticesRef = useRef(vertices);
  const edgesRef = useRef(edges);
  const genusRef = useRef(genus);
  const currentToolRef = useRef(currentTool);
  const activeDragRef = useRef(activeDrag);
  const vertexDragIdRef = useRef(vertexDragId);

  useEffect(() => { verticesRef.current = vertices; }, [vertices]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { genusRef.current = genus; }, [genus]);
  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { activeDragRef.current = activeDrag; }, [activeDrag]);
  useEffect(() => { vertexDragIdRef.current = vertexDragId; }, [vertexDragId]);

  const getTransforms = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const cx = w / 2;
    const cy = h / 2;
    const sc = Math.min(cx, cy) * 0.85;
    const toScreen = (p: Vec2) => ({ x: cx + p.x * sc, y: cy - p.y * sc });
    const toMath = (sx: number, sy: number): Vec2 => ({ x: (sx - cx) / sc, y: -(sy - cy) / sc });
    return { cx, cy, sc, toScreen, toMath };
  }, []);

  const getCanvasCoords = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = getTransforms();
    if (!t) return null;
    return t.toMath(clientX - rect.left, clientY - rect.top);
  }, [getTransforms]);

  const handleStart = useCallback((clientX: number, clientY: number, isTouch: boolean = false) => {
    const coords = getCanvasCoords(clientX, clientY);
    if (!coords) return;
    const g = genusRef.current;
    const verts = getPolygonVerts(g);
    const vList = verticesRef.current;
    const tool = currentToolRef.current;
    const radius = isTouch ? 0.08 : 0.06;

    if (tool === 'eraser') {
      const clicked = vList.find(v =>
        Math.sqrt((v.x - coords.x) ** 2 + (v.y - coords.y) ** 2) < radius
      );
      if (clicked) { onRemoveVertex(clicked.id); return; }

      const eList = edgesRef.current;
      const clickedEdge = eList.find(edge => {
        const from = vList.find(v => v.id === edge.fromId);
        if (!from) return false;
        const segs = getEdgeSegments(from.x, from.y, edge.vx, edge.vy, g, verts);
        return segs.some(([a, b]) => pointToSegDist(coords, a, b) < 0.04);
      });
      if (clickedEdge) { onRemoveEdge(clickedEdge.id); }
      return;
    }

    if (tool === 'edge') {
      const clickedVertex = vList.find(v =>
        Math.sqrt((v.x - coords.x) ** 2 + (v.y - coords.y) ** 2) < radius
      );
      const drag = activeDragRef.current;

      if (clickedVertex) {
        if (drag) {
          // Finish edge: trace to actual endpoint and check if clickedVertex is nearby
          const actualEnd = tracePath({ x: drag.fromX, y: drag.fromY }, { x: drag.vx, y: drag.vy }, g, verts);
          const dist = Math.sqrt((clickedVertex.x - actualEnd.x) ** 2 + (clickedVertex.y - actualEnd.y) ** 2);
          if (dist < radius * 2 &&
              (clickedVertex.id !== drag.fromId || Math.sqrt(drag.vx ** 2 + drag.vy ** 2) > 0.1)) {
            onAddEdge(drag.fromId, clickedVertex.id, drag.vx, drag.vy);
            setActiveDrag(null);
          } else {
            // Start new drag from this vertex
            setActiveDrag({
              fromId: clickedVertex.id,
              fromX: clickedVertex.x,
              fromY: clickedVertex.y,
              vx: 0, vy: 0,
              isDragging: true,
            });
          }
        } else {
          setActiveDrag({
            fromId: clickedVertex.id,
            fromX: clickedVertex.x,
            fromY: clickedVertex.y,
            vx: 0, vy: 0,
            isDragging: true,
          });
        }
      } else {
        // Cancel
        setActiveDrag(null);
      }
      return;
    }

    if (tool === 'vertex') {
      const clickedVertex = vList.find(v =>
        Math.sqrt((v.x - coords.x) ** 2 + (v.y - coords.y) ** 2) < radius
      );
      if (clickedVertex) {
        onStartMove();
        setVertexDragId(clickedVertex.id);
      } else {
        // Only add if inside polygon
        if (insidePolygon(coords, verts)) {
          onAddVertex(coords.x, coords.y);
        }
      }
    }
  }, [getCanvasCoords, onAddVertex, onAddEdge, onRemoveVertex, onRemoveEdge, onStartMove]);

  const handleMove = useCallback((movePxX: number, movePxY: number) => {
    const t = getTransforms();
    if (!t) return;
    const dmx = movePxX / t.sc;
    const dmy = -movePxY / t.sc;

    const vdid = vertexDragIdRef.current;
    if (vdid) {
      onMoveVertex(vdid, dmx, dmy);
    } else {
      const drag = activeDragRef.current;
      if (drag && drag.isDragging) {
        setActiveDrag(prev => {
          if (!prev) return null;
          return { ...prev, vx: prev.vx + dmx, vy: prev.vy + dmy };
        });
      }
    }

    // Check pointer outside polygon
    const canvas = canvasRef.current;
    if (canvas && lastMousePos.current) {
      const rect = canvas.getBoundingClientRect();
      const relX = lastMousePos.current.x - rect.left;
      const relY = lastMousePos.current.y - rect.top;
      const math = t.toMath(relX, relY);
      const verts = getPolygonVerts(genusRef.current);
      setIsPointerOutside(!insidePolygon(math, verts));
    }
  }, [getTransforms, onMoveVertex]);

  const handleEnd = useCallback(() => {
    setIsPointerOutside(false);
    const vdid = vertexDragIdRef.current;
    const drag = activeDragRef.current;
    if (vdid || (drag && drag.isDragging)) {
      onEndMove();
    }
    if (vdid) {
      setVertexDragId(null);
      return;
    }
    if (drag && drag.isDragging) {
      const g = genusRef.current;
      const verts = getPolygonVerts(g);
      const vList = verticesRef.current;
      // Check if endpoint snaps to a vertex
      const actualEnd = tracePath(
        { x: drag.fromX, y: drag.fromY },
        { x: drag.vx, y: drag.vy },
        g, verts
      );
      const snapRadius = 0.06;
      const targetV = vList.find(v =>
        Math.sqrt((v.x - actualEnd.x) ** 2 + (v.y - actualEnd.y) ** 2) < snapRadius
      );
      if (targetV && (targetV.id !== drag.fromId || Math.sqrt(drag.vx ** 2 + drag.vy ** 2) > 0.1)) {
        onAddEdge(drag.fromId, targetV.id, drag.vx, drag.vy);
      }
      setActiveDrag(null);
    }
  }, [onEndMove, onAddEdge]);

  // Global mouse/touch events
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (lastMousePos.current) {
        handleMove(e.clientX - lastMousePos.current.x, e.clientY - lastMousePos.current.y);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onMouseUp = () => {
      if (lastMousePos.current) {
        handleEnd();
        lastMousePos.current = null;
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleMove, handleEnd]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const cx = w / 2;
      const cy = h / 2;
      const sc = Math.min(cx, cy) * 0.85;

      const toScreen = (p: Vec2) => ({ x: cx + p.x * sc, y: cy - p.y * sc });

      const g = genus;
      const verts = getPolygonVerts(g);
      const n = verts.length;

      // Background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // Build polygon path
      const buildPolyPath = () => {
        ctx.beginPath();
        const s0 = toScreen(verts[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < n; i++) {
          const s = toScreen(verts[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
      };

      // Polygon fill
      buildPolyPath();
      ctx.fillStyle = '#0a0a12';
      ctx.fill();

      // Clip to polygon for grid and edges
      ctx.save();
      buildPolyPath();
      ctx.clip();

      // Grid (every 0.1 units in math space)
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 0.5;
      const gridStep = 0.1;
      const gridMin = -1.2, gridMax = 1.2;
      for (let gv = gridMin; gv <= gridMax + 1e-9; gv += gridStep) {
        const gvr = Math.round(gv * 100) / 100;
        // vertical line x=gvr
        const p1 = toScreen({ x: gvr, y: gridMin });
        const p2 = toScreen({ x: gvr, y: gridMax });
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        // horizontal line y=gvr
        const p3 = toScreen({ x: gridMin, y: gvr });
        const p4 = toScreen({ x: gridMax, y: gvr });
        ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
      }

      // Graph edges
      ctx.shadowBlur = 10;
      edges.forEach(edge => {
        const from = vertices.find(v => v.id === edge.fromId);
        if (!from) return;
        const isClique = maxClique.size >= 3 && maxClique.has(edge.fromId) && maxClique.has(edge.toId);
        ctx.strokeStyle = isClique ? '#facc15' : '#818cf8';
        ctx.lineWidth = isClique ? 6 : 3;
        ctx.shadowBlur = isClique ? 25 : 10;
        ctx.shadowColor = isClique ? '#f59e0b' : '#4f46e5';
        drawEdgePath(ctx, from.x, from.y, edge.vx, edge.vy, g, verts, toScreen);
      });
      ctx.shadowBlur = 0;

      // Pending drag edge
      if (activeDrag) {
        ctx.strokeStyle = '#f472b6';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#db2777';
        if (activeDrag.isDragging) ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        drawEdgePath(ctx, activeDrag.fromX, activeDrag.fromY, activeDrag.vx, activeDrag.vy, g, verts, toScreen);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Show actual endpoint
        const actualEnd = tracePath(
          { x: activeDrag.fromX, y: activeDrag.fromY },
          { x: activeDrag.vx, y: activeDrag.vy },
          g, verts
        );
        const sp = toScreen(actualEnd);
        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.fill();
        // Crosshair
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - 14, sp.y); ctx.lineTo(sp.x + 14, sp.y);
        ctx.moveTo(sp.x, sp.y - 14); ctx.lineTo(sp.x, sp.y + 14);
        ctx.stroke();
      }

      // Crossing animation
      if (crossingInfo) {
        const fromEdge = edges.find(e => e.fromId === crossingInfo.fromId && e.toId === crossingInfo.toId);
        if (fromEdge) {
          const from = vertices.find(v => v.id === fromEdge.fromId);
          if (from) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.setLineDash([5, 5]);
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ef4444';
            drawEdgePath(ctx, from.x, from.y, fromEdge.vx, fromEdge.vy, g, verts, toScreen);
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
          }
        }
      }

      // Duplicate edge animation
      if (duplicateEdgeInfo) {
        const dup = edges.find(e =>
          (e.fromId === duplicateEdgeInfo.fromId && e.toId === duplicateEdgeInfo.toId) ||
          (e.fromId === duplicateEdgeInfo.toId && e.toId === duplicateEdgeInfo.fromId)
        );
        if (dup) {
          const from = vertices.find(v => v.id === dup.fromId);
          if (from) {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 6;
            ctx.setLineDash([8, 4]);
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ea580c';
            drawEdgePath(ctx, from.x, from.y, dup.vx, dup.vy, g, verts, toScreen);
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
          }
        }
      }

      ctx.restore(); // end polygon clip

      // Polygon boundary edges (drawn on top, outside clip)
      for (let i = 0; i < n; i++) {
        const A = verts[i];
        const B = verts[(i + 1) % n];
        const sA = toScreen(A);
        const sB = toScreen(B);
        const color = edgeColor(i);

        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(sA.x, sA.y);
        ctx.lineTo(sB.x, sB.y);
        ctx.stroke();

        // Arrow at midpoint
        const mid = { x: (sA.x + sB.x) / 2, y: (sA.y + sB.y) / 2 };
        const dx = sB.x - sA.x, dy = sB.y - sA.y;
        const dl = Math.sqrt(dx * dx + dy * dy);
        if (dl > 0) {
          const ux = dx / dl, uy = dy / dl;
          const arrowLen = 14, arrowW = 6;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(mid.x + ux * arrowLen / 2, mid.y + uy * arrowLen / 2);
          ctx.lineTo(mid.x - ux * arrowLen / 2 - uy * arrowW, mid.y - uy * arrowLen / 2 + ux * arrowW);
          ctx.lineTo(mid.x - ux * arrowLen / 2 + uy * arrowW, mid.y - uy * arrowLen / 2 - ux * arrowW);
          ctx.closePath();
          ctx.fill();
        }

        // Label just outside midpoint (outward = away from center)
        const mx = (sA.x + sB.x) / 2, my = (sA.y + sB.y) / 2;
        const outX = mx - cx, outY = my - cy;
        const outL = Math.sqrt(outX * outX + outY * outY) || 1;
        const labelOffset = 18;
        const lx = mx + (outX / outL) * labelOffset;
        const ly = my + (outY / outL) * labelOffset;
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.max(10, Math.min(14, sc * 0.12))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(edgeLabel(i), lx, ly);
      }

      // Graph vertices
      vertices.forEach(v => {
        const sv = toScreen(v);
        const isCliqueV = maxClique.size >= 3 && maxClique.has(v.id);
        ctx.shadowBlur = 15;
        ctx.shadowColor = isCliqueV ? '#f59e0b' : '#818cf8';
        ctx.fillStyle = '#020617';
        ctx.strokeStyle = isCliqueV ? '#facc15' : '#818cf8';
        ctx.lineWidth = isCliqueV ? 3 : 2.5;
        ctx.beginPath();
        ctx.arc(sv.x, sv.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [vertices, edges, genus, activeDrag, crossingInfo, duplicateEdgeInfo, maxClique]);

  const cursorClass = (vertexDragId || activeDrag?.isDragging) && isPointerOutside
    ? 'cursor-none'
    : currentTool === 'eraser'
      ? 'cursor-cell'
      : currentTool === 'edge'
        ? 'cursor-crosshair'
        : 'cursor-copy';

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`w-full h-full outline-none ${cursorClass}`}
        style={{ touchAction: 'none' }}
        onMouseDown={(e) => {
          if (e.button === 0) {
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            handleStart(e.clientX, e.clientY, false);
          }
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          lastTouchPos.current = { x: touch.clientX, y: touch.clientY };
          lastMousePos.current = { x: touch.clientX, y: touch.clientY };
          handleStart(touch.clientX, touch.clientY, true);
          if (e.cancelable) e.preventDefault();
        }}
        onTouchMove={(e) => {
          if ((!activeDrag?.isDragging && !vertexDragId) || !lastTouchPos.current) return;
          const touch = e.touches[0];
          const dx = touch.clientX - lastTouchPos.current.x;
          const dy = touch.clientY - lastTouchPos.current.y;
          handleMove(dx, dy);
          lastTouchPos.current = { x: touch.clientX, y: touch.clientY };
          lastMousePos.current = { x: touch.clientX, y: touch.clientY };
          if (e.cancelable) e.preventDefault();
        }}
        onTouchEnd={handleEnd}
        onContextMenu={(e) => e.preventDefault()}
      />
      {maxClique.size >= 3 && (
        <div className="absolute bottom-4 left-4 text-xs font-mono text-slate-500 pointer-events-none opacity-40">
          Largest Clique: {maxClique.size} vertices
        </div>
      )}
    </>
  );
};
