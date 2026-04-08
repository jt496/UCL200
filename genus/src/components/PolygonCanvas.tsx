import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Vertex, Edge } from '../App';
import {
  getPolygonVerts, getHyperbolicPolygonVerts, getDeckTransforms,
  firstCrossing, wrapPos, wrapDir, tracePath, snapDisplacementTo,
  hypTracePath, hypSnapTo, hypGeodesicCrossing, hypGetEdgeSegs, mobiusApply,
  geodesicArcParams,
  edgeColor, insidePolygon, isHyperbolic,
  add, sub, scale, norm, len, dot,
  type Vec2, type MobiusDisc, type GeodesicArcParams,
} from '../geometry';

interface PolygonCanvasProps {
  vertices: Vertex[];
  edges: Edge[];
  genus: number;
  currentTool: 'vertex' | 'edge' | 'eraser';
  onAddVertex: (x: number, y: number) => void;
  onAddEdge: (fromId: string, toId: string, tx: number, ty: number) => void;
  onRemoveVertex: (id: string) => void;
  onRemoveEdge: (id: string) => void;
  onMoveVertex: (id: string, dx: number, dy: number) => void;
  onStartMove: () => void;
  onEndMove: () => void;
  crossingInfo: null | { fromId: string; toId: string };
  duplicateEdgeInfo: null | { fromId: string; toId: string };
  maxClique: Set<string>;
}

// ---- Flat torus (g=1) drawing helpers ----

function drawEdgePath(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  tx: number, ty: number,
  g: number, verts: Vec2[],
  toScreen: (p: Vec2) => { x: number; y: number }
) {
  // tx,ty is absolute endpoint; displacement = (tx-fromX, ty-fromY)
  let pos: Vec2 = { x: fromX, y: fromY };
  let rem: Vec2 = { x: tx - fromX, y: ty - fromY };
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

function getEdgeSegmentsFlat(
  fromX: number, fromY: number, tx: number, ty: number,
  g: number, verts: Vec2[]
): Array<[Vec2, Vec2]> {
  const segs: Array<[Vec2, Vec2]> = [];
  let pos: Vec2 = { x: fromX, y: fromY };
  let rem: Vec2 = { x: tx - fromX, y: ty - fromY };
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

// ---- Hyperbolic (g>=2) drawing helpers ----

// Draw a geodesic arc in screen space, continuing the current canvas path.
// Assumes ctx.moveTo was already called or path is in progress.
function drawGeodesicSegment(
  ctx: CanvasRenderingContext2D,
  arc: GeodesicArcParams,
  toScreen: (p: Vec2) => { x: number; y: number },
  sc: number
) {
  if (arc.isLine) {
    const s2 = toScreen(arc.z2);
    ctx.lineTo(s2.x, s2.y);
  } else {
    const { cx, cy, r, z1, z2 } = arc;
    const scx = toScreen({ x: cx, y: cy }).x;
    const scy = toScreen({ x: cx, y: cy }).y;
    const sr = r * sc;

    const s1 = toScreen(z1);
    const s2 = toScreen(z2);

    const a1 = Math.atan2(s1.y - scy, s1.x - scx);
    const a2 = Math.atan2(s2.y - scy, s2.x - scx);

    // Determine which arc direction (CCW in screen = CW in math due to y-flip)
    // stays inside the disc. Test the midpoint of the CCW screen arc.
    const normAng = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const aMidCCW = a1 + normAng(a2 - a1) / 2;
    const midSx = scx + sr * Math.cos(aMidCCW);
    const midSy = scy + sr * Math.sin(aMidCCW);
    // Convert mid back to math coords
    const midMathX = (midSx - toScreen({ x: 0, y: 0 }).x) / sc;
    const midMathY = -(midSy - toScreen({ x: 0, y: 0 }).y) / sc;
    const midInsideDisc = midMathX * midMathX + midMathY * midMathY < 1;

    // If CCW arc in screen is inside disc, draw CCW (anticlockwise=false in canvas)
    // Otherwise draw CW (anticlockwise=true)
    ctx.arc(scx, scy, Math.max(sr, 0.1), a1, a2, !midInsideDisc);
  }
}

// Draw a hyperbolic edge path (geodesic arcs with Möbius wrapping)
function drawHypEdgePath(
  ctx: CanvasRenderingContext2D,
  fromPos: Vec2, target: Vec2,
  verts: Vec2[], decks: MobiusDisc[],
  toScreen: (p: Vec2) => { x: number; y: number },
  sc: number
) {
  const n = verts.length;
  let curPos = fromPos;
  let curTarget = target;

  ctx.beginPath();
  const s0 = toScreen(curPos);
  ctx.moveTo(s0.x, s0.y);

  for (let iter = 0; iter < 8; iter++) {
    let best: { t: number; point: Vec2; edgeIndex: number } | null = null;
    for (let i = 0; i < n; i++) {
      const cross = hypGeodesicCrossing(curPos, curTarget, verts[i], verts[(i + 1) % n]);
      if (cross && (best === null || cross.t < best.t)) {
        best = { t: cross.t, point: cross.point, edgeIndex: i };
      }
    }
    if (!best) {
      const arc = geodesicArcParams(curPos, curTarget);
      drawGeodesicSegment(ctx, arc, toScreen, sc);
      break;
    }
    // Draw arc from curPos to crossing point
    const arc = geodesicArcParams(curPos, best.point);
    drawGeodesicSegment(ctx, arc, toScreen, sc);
    // Wrap
    const d = decks[best.edgeIndex];
    curPos = mobiusApply(d, best.point);
    curTarget = mobiusApply(d, curTarget);
    const sp = toScreen(curPos);
    ctx.moveTo(sp.x, sp.y);
  }
  ctx.stroke();
}

// ---- Point-to-segment distance ----
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
    vx: number; // accumulated Euclidean displacement in math coords
    vy: number;
    isDragging: boolean;
  } | null>(null);

  const [vertexDragId, setVertexDragId] = useState<string | null>(null);
  const [isPointerOutside, setIsPointerOutside] = useState(false);

  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  const lastTouchPos = useRef<{ x: number; y: number } | null>(null);

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

  // Compute the actual endpoint from drag state for a given genus
  const getDragActualEnd = useCallback((drag: { fromX: number; fromY: number; vx: number; vy: number }, g: number): Vec2 => {
    const verts = getPolygonVerts(g);
    if (isHyperbolic(g)) {
      const decks = getDeckTransforms(verts);
      const approxTarget: Vec2 = { x: drag.fromX + drag.vx, y: drag.fromY + drag.vy };
      return hypTracePath({ x: drag.fromX, y: drag.fromY }, approxTarget, verts, decks);
    } else {
      return tracePath({ x: drag.fromX, y: drag.fromY }, { x: drag.vx, y: drag.vy }, g, verts);
    }
  }, []);

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
      let clickedEdge: Edge | undefined;
      if (isHyperbolic(g)) {
        const hypVerts = getHyperbolicPolygonVerts(g);
        const decks = getDeckTransforms(hypVerts);
        clickedEdge = eList.find(edge => {
          const from = vList.find(v => v.id === edge.fromId);
          if (!from) return false;
          const segs = hypGetEdgeSegs(
            { x: from.x, y: from.y }, { x: edge.tx, y: edge.ty }, hypVerts, decks
          );
          return segs.some(([a, b]: [Vec2, Vec2]) => pointToSegDist(coords, a, b) < 0.04);
        });
      } else {
        clickedEdge = eList.find(edge => {
          const from = vList.find(v => v.id === edge.fromId);
          if (!from) return false;
          const segs = getEdgeSegmentsFlat(from.x, from.y, edge.tx, edge.ty, g, verts);
          return segs.some(([a, b]) => pointToSegDist(coords, a, b) < 0.04);
        });
      }
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
          const actualEnd = getDragActualEnd(drag, g);
          const dist = Math.sqrt((clickedVertex.x - actualEnd.x) ** 2 + (clickedVertex.y - actualEnd.y) ** 2);
          if (dist < radius * 2 &&
              (clickedVertex.id !== drag.fromId || Math.sqrt(drag.vx ** 2 + drag.vy ** 2) > 0.1)) {
            // Finalize edge
            if (isHyperbolic(g)) {
              const hypVerts = getHyperbolicPolygonVerts(g);
              const decks = getDeckTransforms(hypVerts);
              const approxTarget: Vec2 = { x: drag.fromX + drag.vx, y: drag.fromY + drag.vy };
              const snapped = hypSnapTo(
                { x: drag.fromX, y: drag.fromY }, approxTarget,
                { x: clickedVertex.x, y: clickedVertex.y },
                hypVerts, decks
              );
              onAddEdge(drag.fromId, clickedVertex.id, snapped.x, snapped.y);
            } else {
              const snapped = snapDisplacementTo(
                drag.fromX, drag.fromY, drag.vx, drag.vy,
                clickedVertex.x, clickedVertex.y, g, verts
              );
              // For g=1: tx = fromX + snapped.x, ty = fromY + snapped.y
              onAddEdge(drag.fromId, clickedVertex.id, drag.fromX + snapped.x, drag.fromY + snapped.y);
            }
            setActiveDrag(null);
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
          setActiveDrag({
            fromId: clickedVertex.id,
            fromX: clickedVertex.x,
            fromY: clickedVertex.y,
            vx: 0, vy: 0,
            isDragging: true,
          });
        }
      } else {
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
        if (insidePolygon(coords, verts)) {
          onAddVertex(coords.x, coords.y);
        }
      }
    }
  }, [getCanvasCoords, onAddVertex, onAddEdge, onRemoveVertex, onRemoveEdge, onStartMove, getDragActualEnd]);

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
      const vList = verticesRef.current;
      const snapRadius = 0.06;

      const actualEnd = getDragActualEnd(drag, g);
      const targetV = vList.find(v =>
        Math.sqrt((v.x - actualEnd.x) ** 2 + (v.y - actualEnd.y) ** 2) < snapRadius
      );

      if (targetV && (targetV.id !== drag.fromId || Math.sqrt(drag.vx ** 2 + drag.vy ** 2) > 0.1)) {
        if (isHyperbolic(g)) {
          const hypVerts = getHyperbolicPolygonVerts(g);
          const decks = getDeckTransforms(hypVerts);
          const approxTarget: Vec2 = { x: drag.fromX + drag.vx, y: drag.fromY + drag.vy };
          const snapped = hypSnapTo(
            { x: drag.fromX, y: drag.fromY }, approxTarget,
            { x: targetV.x, y: targetV.y },
            hypVerts, decks
          );
          onAddEdge(drag.fromId, targetV.id, snapped.x, snapped.y);
        } else {
          const verts = getPolygonVerts(g);
          const snapped = snapDisplacementTo(
            drag.fromX, drag.fromY, drag.vx, drag.vy,
            targetV.x, targetV.y, g, verts
          );
          onAddEdge(drag.fromId, targetV.id, drag.fromX + snapped.x, drag.fromY + snapped.y);
        }
      }
      setActiveDrag(null);
    }
  }, [onEndMove, onAddEdge, getDragActualEnd]);

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
      const hyp = isHyperbolic(g);
      const verts = getPolygonVerts(g);
      const hypVerts = hyp ? getHyperbolicPolygonVerts(g) : verts;
      const decks = hyp ? getDeckTransforms(hypVerts) : [];
      const n = verts.length;

      // Background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // For hyperbolic: draw unit disc boundary
      if (hyp) {
        const discCenter = toScreen({ x: 0, y: 0 });
        ctx.beginPath();
        ctx.arc(discCenter.x, discCenter.y, sc, 0, 2 * Math.PI);
        ctx.fillStyle = '#0a0a12';
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Build polygon path (straight lines between vertices)
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
      if (!hyp) {
        buildPolyPath();
        ctx.fillStyle = '#0a0a12';
        ctx.fill();
      }

      // Clip to polygon (or disc for hyperbolic)
      ctx.save();
      if (hyp) {
        const discCenter = toScreen({ x: 0, y: 0 });
        ctx.beginPath();
        ctx.arc(discCenter.x, discCenter.y, sc - 1, 0, 2 * Math.PI);
        ctx.clip();
      } else {
        buildPolyPath();
        ctx.clip();
      }

      // Grid
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 0.5;
      if (!hyp) {
        const gridStep = 0.1;
        const gridMin = -1.2, gridMax = 1.2;
        for (let gv = gridMin; gv <= gridMax + 1e-9; gv += gridStep) {
          const gvr = Math.round(gv * 100) / 100;
          const p1 = toScreen({ x: gvr, y: gridMin });
          const p2 = toScreen({ x: gvr, y: gridMax });
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          const p3 = toScreen({ x: gridMin, y: gvr });
          const p4 = toScreen({ x: gridMax, y: gvr });
          ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
        }
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

        if (hyp) {
          drawHypEdgePath(ctx, { x: from.x, y: from.y }, { x: edge.tx, y: edge.ty },
            hypVerts, decks, toScreen, sc);
        } else {
          drawEdgePath(ctx, from.x, from.y, edge.tx, edge.ty, g, verts, toScreen);
        }
      });
      ctx.shadowBlur = 0;

      // Pending drag edge
      if (activeDrag) {
        const actualEnd = getDragActualEnd(activeDrag, g);
        const snapR = 0.06;
        const snapTarget = vertices.find(v =>
          Math.sqrt((v.x - actualEnd.x) ** 2 + (v.y - actualEnd.y) ** 2) < snapR
        );
        const displayEnd = snapTarget ? { x: snapTarget.x, y: snapTarget.y } : actualEnd;

        ctx.strokeStyle = '#f472b6';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#db2777';
        if (activeDrag.isDragging) ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;

        if (hyp) {
          const approxTarget: Vec2 = { x: activeDrag.fromX + activeDrag.vx, y: activeDrag.fromY + activeDrag.vy };
          if (snapTarget) {
            const snapped = hypSnapTo(
              { x: activeDrag.fromX, y: activeDrag.fromY }, approxTarget,
              { x: snapTarget.x, y: snapTarget.y },
              hypVerts, decks
            );
            drawHypEdgePath(ctx, { x: activeDrag.fromX, y: activeDrag.fromY }, snapped,
              hypVerts, decks, toScreen, sc);
          } else {
            drawHypEdgePath(ctx, { x: activeDrag.fromX, y: activeDrag.fromY }, approxTarget,
              hypVerts, decks, toScreen, sc);
          }
        } else {
          if (snapTarget) {
            const snappedD = snapDisplacementTo(
              activeDrag.fromX, activeDrag.fromY, activeDrag.vx, activeDrag.vy,
              snapTarget.x, snapTarget.y, g, verts
            );
            drawEdgePath(ctx, activeDrag.fromX, activeDrag.fromY,
              activeDrag.fromX + snappedD.x, activeDrag.fromY + snappedD.y,
              g, verts, toScreen);
          } else {
            drawEdgePath(ctx, activeDrag.fromX, activeDrag.fromY,
              activeDrag.fromX + activeDrag.vx, activeDrag.fromY + activeDrag.vy,
              g, verts, toScreen);
          }
        }

        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        const sp = toScreen(displayEnd);
        ctx.fillStyle = snapTarget ? '#facc15' : '#f472b6';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, snapTarget ? 11 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = snapTarget ? '#facc15' : '#f472b6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - 16, sp.y); ctx.lineTo(sp.x + 16, sp.y);
        ctx.moveTo(sp.x, sp.y - 16); ctx.lineTo(sp.x, sp.y + 16);
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
            if (hyp) {
              drawHypEdgePath(ctx, { x: from.x, y: from.y }, { x: fromEdge.tx, y: fromEdge.ty },
                hypVerts, decks, toScreen, sc);
            } else {
              drawEdgePath(ctx, from.x, from.y, fromEdge.tx, fromEdge.ty, g, verts, toScreen);
            }
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
            if (hyp) {
              drawHypEdgePath(ctx, { x: from.x, y: from.y }, { x: dup.tx, y: dup.ty },
                hypVerts, decks, toScreen, sc);
            } else {
              drawEdgePath(ctx, from.x, from.y, dup.tx, dup.ty, g, verts, toScreen);
            }
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
          }
        }
      }

      ctx.restore(); // end clip

      // Polygon boundary edges (drawn on top, outside clip)
      for (let i = 0; i < n; i++) {
        const A = verts[i];
        const B = verts[(i + 1) % n];
        const color = edgeColor(i);

        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 0;
        ctx.beginPath();

        if (hyp) {
          // Draw as geodesic arc
          const arc = geodesicArcParams(A, B);
          const sA = toScreen(A);
          ctx.moveTo(sA.x, sA.y);
          drawGeodesicSegment(ctx, arc, toScreen, sc);
        } else {
          const sA = toScreen(A);
          const sB = toScreen(B);
          ctx.moveTo(sA.x, sA.y);
          ctx.lineTo(sB.x, sB.y);
        }
        ctx.stroke();

        // Arrow at midpoint
        const r = i % 4;
        const reversed = r === 2 || r === 3;

        let midMath: Vec2;
        let tangentScreen: { dx: number; dy: number };

        if (hyp) {
          // Midpoint of geodesic arc in screen space
          const arc = geodesicArcParams(A, B);
          if (arc.isLine) {
            midMath = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
            const sA2 = toScreen(A), sB2 = toScreen(B);
            tangentScreen = { dx: sB2.x - sA2.x, dy: sB2.y - sA2.y };
          } else {
            const { cx: gcx, cy: gcy, r: gr } = arc;
            const sA2 = toScreen(A);
            const sCenter = toScreen({ x: gcx, y: gcy });
            const sr = gr * sc;
            const a1 = Math.atan2(sA2.y - sCenter.y, sA2.x - sCenter.x);
            const sB2 = toScreen(B);
            const a2 = Math.atan2(sB2.y - sCenter.y, sB2.x - sCenter.x);
            const normAng2 = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const aMidCCW2 = a1 + normAng2(a2 - a1) / 2;
            const midSx = sCenter.x + sr * Math.cos(aMidCCW2);
            const midSy = sCenter.y + sr * Math.sin(aMidCCW2);
            const midMathX = (midSx - cx) / sc;
            const midMathY = -(midSy - cy) / sc;
            const midInsideDisc2 = midMathX * midMathX + midMathY * midMathY < 1;
            let aMid: number;
            if (midInsideDisc2) {
              aMid = aMidCCW2;
            } else {
              aMid = a1 + normAng2(a2 - a1) / 2 + Math.PI;
            }
            const msx = sCenter.x + sr * Math.cos(aMid);
            const msy = sCenter.y + sr * Math.sin(aMid);
            midMath = { x: (msx - cx) / sc, y: -(msy - cy) / sc };
            // Tangent at aMid in CCW screen direction
            const tangDx = -Math.sin(aMid);
            const tangDy = Math.cos(aMid);
            tangentScreen = midInsideDisc2 ? { dx: tangDx, dy: tangDy } : { dx: -tangDx, dy: -tangDy };
          }
          void midMath; // used below
          const rawDx = reversed ? -tangentScreen.dx : tangentScreen.dx;
          const rawDy = reversed ? -tangentScreen.dy : tangentScreen.dy;
          const dl = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
          const mid = toScreen(midMath);
          if (dl > 0) {
            const ux = rawDx / dl, uy = rawDy / dl;
            const arrowLen = 22, arrowW = 9;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(mid.x + ux * arrowLen / 2, mid.y + uy * arrowLen / 2);
            ctx.lineTo(mid.x - ux * arrowLen / 2 - uy * arrowW, mid.y - uy * arrowLen / 2 + ux * arrowW);
            ctx.lineTo(mid.x - ux * arrowLen / 2 + uy * arrowW, mid.y - uy * arrowLen / 2 - ux * arrowW);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          const sA = toScreen(A);
          const sB = toScreen(B);
          const mid = { x: (sA.x + sB.x) / 2, y: (sA.y + sB.y) / 2 };
          const rawDx = sB.x - sA.x, rawDy = sB.y - sA.y;
          const dx = reversed ? -rawDx : rawDx;
          const dy = reversed ? -rawDy : rawDy;
          const dl = Math.sqrt(dx * dx + dy * dy);
          if (dl > 0) {
            const ux = dx / dl, uy = dy / dl;
            const arrowLen = 22, arrowW = 9;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(mid.x + ux * arrowLen / 2, mid.y + uy * arrowLen / 2);
            ctx.lineTo(mid.x - ux * arrowLen / 2 - uy * arrowW, mid.y - uy * arrowLen / 2 + ux * arrowW);
            ctx.lineTo(mid.x - ux * arrowLen / 2 + uy * arrowW, mid.y - uy * arrowLen / 2 - ux * arrowW);
            ctx.closePath();
            ctx.fill();
          }
        }
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
  }, [vertices, edges, genus, activeDrag, crossingInfo, duplicateEdgeInfo, maxClique, getDragActualEnd]);

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
