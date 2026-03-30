import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Vertex, Edge } from '../App';

const MARGIN = 0.2;

interface Canvas2DProps {
  vertices: Vertex[];
  edges: Edge[];
  currentTool: 'vertex' | 'edge' | 'eraser';
  onAddVertex: (x: number, y: number) => void;
  onAddEdge: (fromId: string, toId: string, dx: number, dy: number) => void;
  onRemoveVertex: (id: string) => void;
  onRemoveEdge: (id: string) => void;
  onMoveVertex: (id: string, dx: number, dy: number) => void;
  onStartMove: () => void;
  onEndMove: () => void;
  crossingInfo: { x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number } | null;
  duplicateEdgeInfo: { x1: number, y1: number, x2: number, y2: number } | null;
  maxClique: Set<string>;
}

export const Canvas2D: React.FC<Canvas2DProps> = ({
  vertices, edges, currentTool, onAddVertex, onAddEdge, onRemoveVertex, onRemoveEdge, onMoveVertex, onStartMove, onEndMove, crossingInfo, duplicateEdgeInfo, maxClique
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Pending edge state for segmented dragging
  const [activeDrag, setActiveDrag] = useState<{
    fromId: string;
    fromX: number;
    fromY: number;
    dx: number;
    dy: number;
    isDragging: boolean;
  } | null>(null);

  const [vertexDragId, setVertexDragId] = useState<string | null>(null);
  const [isPointerOutside, setIsPointerOutside] = useState(false);

  const lastTouchPos = useRef<{ x: number, y: number } | null>(null);
  const lastMousePos = useRef<{ x: number, y: number } | null>(null);

  const getCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: (x - MARGIN) / (1 - 2 * MARGIN),
      y: (y - MARGIN) / (1 - 2 * MARGIN)
    };
  }, []);

  const handleStart = (clientX: number, clientY: number, isTouch: boolean = false) => {
    const coords = getCanvasCoords(clientX, clientY);
    const radius = isTouch ? 0.08 : 0.06;

    // Eraser Mode logic
    if (currentTool === 'eraser') {
      const clickedVertex = vertices.find(v =>
        Math.sqrt(Math.pow(v.x - coords.x, 2) + Math.pow(v.y - coords.y, 2)) < radius
      );
      if (clickedVertex) {
        onRemoveVertex(clickedVertex.id);
        return;
      }
      const clickedEdge = edges.find(edge => {
        const from = vertices.find(v => v.id === edge.fromId);
        if (!from) return false;
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const x1 = from.x - ox, y1 = from.y - oy, x2 = from.x + edge.dx - ox, y2 = from.y + edge.dy - oy;
            const l2 = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
            if (l2 === 0) continue;
            const t = Math.max(0, Math.min(1, ((coords.x - x1) * (x2 - x1) + (coords.y - y1) * (y2 - y1)) / l2));
            if (Math.sqrt(Math.pow(coords.x - (x1 + t * (x2 - x1)), 2) + Math.pow(coords.y - (y1 + t * (y2 - y1)), 2)) < 0.03) return true;
          }
        }
        return false;
      });
      if (clickedEdge) {
        onRemoveEdge(clickedEdge.id);
      }
      return;
    }

    // Edge Mode logic
    if (currentTool === 'edge') {
      // Check if clicking on a vertex to start new or finish
      const clickedVertex = vertices.find(v =>
        Math.sqrt(Math.pow(v.x - coords.x, 2) + Math.pow(v.y - coords.y, 2)) < radius
      );

      if (clickedVertex) {
        // If we have a pending drag and click a vertex, finish it
        if (activeDrag) {
          // Find nearest image of clickedVertex to current virtual pos
          const currentX = activeDrag.fromX + activeDrag.dx;
          const currentY = activeDrag.fromY + activeDrag.dy;

          let minD = 100;
          let bestDx = activeDrag.dx;
          let bestDy = activeDrag.dy;

          for (let ox = -5; ox <= 5; ox++) {
            for (let oy = -5; oy <= 5; oy++) {
              const tx = clickedVertex.x + ox;
              const ty = clickedVertex.y + oy;
              const d = Math.sqrt(Math.pow(tx - currentX, 2) + Math.pow(ty - currentY, 2));
              if (d < minD) {
                minD = d;
                bestDx = tx - activeDrag.fromX;
                bestDy = ty - activeDrag.fromY;
              }
            }
          }

          // Allow finishing if it's a different vertex OR if it's a loop with non-zero winding
          if (clickedVertex.id !== activeDrag.fromId || Math.abs(bestDx) > 0.1 || Math.abs(bestDy) > 0.1) {
            onAddEdge(activeDrag.fromId, clickedVertex.id, bestDx, bestDy);
            setActiveDrag(null);
            return;
          }
        }

        // Start new drag
        setActiveDrag({
          fromId: clickedVertex.id,
          fromX: clickedVertex.x,
          fromY: clickedVertex.y,
          dx: 0,
          dy: 0,
          isDragging: true
        });
      } else {
        // Clicked empty space: cancel pending
        if (activeDrag) {
          setActiveDrag(null);
        }
      }
      return;
    }

    // Vertex Mode logic
    if (currentTool === 'vertex') {
      const clickedVertex = vertices.find(v =>
        Math.sqrt(Math.pow(v.x - coords.x, 2) + Math.pow(v.y - coords.y, 2)) < radius
      );

      if (clickedVertex) {
        onStartMove();
        setVertexDragId(clickedVertex.id);
      } else {
        onAddVertex(coords.x, coords.y);
      }
      return;
    }
  };

  const handleMove = useCallback((moveX: number, moveY: number) => {
    const sw = canvasRef.current?.offsetWidth || 1;
    const sh = canvasRef.current?.offsetHeight || 1;
    const dx = moveX / (sw * (1 - 2 * MARGIN));
    const dy = moveY / (sh * (1 - 2 * MARGIN));

    if (vertexDragId) {
      onMoveVertex(vertexDragId, dx, dy);
    } else if (activeDrag && activeDrag.isDragging) {
      setActiveDrag(prev => {
        if (!prev) return null;
        return {
          ...prev,
          dx: prev.dx + dx,
          dy: prev.dy + dy
        };
      });
    }

    // Check if pointer is outside the main torus area (0 to 1)
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect && lastMousePos.current) {
      const currentMouseX = lastMousePos.current.x + moveX;
      const currentMouseY = lastMousePos.current.y + moveY;
      const relX = currentMouseX - rect.left;
      const relY = currentMouseY - rect.top;

      const paddingX = sw * MARGIN;
      const paddingY = sh * MARGIN;

      const isOutside = relX < paddingX || relX > sw - paddingX || relY < paddingY || relY > sh - paddingY;
      setIsPointerOutside(isOutside);
    }
  }, [activeDrag, vertexDragId, onMoveVertex]);

  const handleEnd = useCallback(() => {
    setIsPointerOutside(false);
    if (vertexDragId || (activeDrag && activeDrag.isDragging)) {
      onEndMove();
    }
    if (vertexDragId) {
      setVertexDragId(null);
      return;
    }

    if (activeDrag && activeDrag.isDragging) {
      // Check if we dropped on a vertex
      const currentX = activeDrag.fromX + activeDrag.dx;
      const currentY = activeDrag.fromY + activeDrag.dy;
      const vx = ((currentX % 1) + 1) % 1;
      const vy = ((currentY % 1) + 1) % 1;

      const targetV = vertices.find(v =>
        Math.sqrt(Math.pow(v.x - vx, 2) + Math.pow(v.y - vy, 2)) < 0.06
      );

      if (targetV) {
        // Snapping logic
        let minD = 0.15;
        let finalDx = activeDrag.dx;
        let finalDy = activeDrag.dy;
        let found = false;

        for (let ox = -5; ox <= 5; ox++) {
          for (let oy = -5; oy <= 5; oy++) {
            const tx = targetV.x + ox;
            const ty = targetV.y + oy;
            const d = Math.sqrt(Math.pow(tx - currentX, 2) + Math.pow(ty - currentY, 2));
            if (d < minD) {
              minD = d;
              finalDx = tx - activeDrag.fromX;
              finalDy = ty - activeDrag.fromY;
              found = true;
            }
          }
        }

        if (found && (targetV.id !== activeDrag.fromId || Math.abs(finalDx) > 0.1 || Math.abs(finalDy) > 0.1)) {
          onAddEdge(activeDrag.fromId, targetV.id, finalDx, finalDy);
          setActiveDrag(null);
        } else {
          setActiveDrag(null);
        }
      } else {
        // Clear if released on empty space
        setActiveDrag(null);
      }
    }
  }, [activeDrag, vertices, onAddEdge, vertexDragId]);

  // Event Listeners
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const toScreenX = (x: number, sw: number) => (x * (1 - 2 * MARGIN) + MARGIN) * sw;
    const toScreenY = (y: number, sh: number) => (y * (1 - 2 * MARGIN) + MARGIN) * sh;

    const drawWrappedLine = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, sw: number, sh: number) => {
      const minX = Math.floor(Math.min(x1, x2)) - 1;
      const maxX = Math.floor(Math.max(x1, x2)) + 1;
      const minY = Math.floor(Math.min(y1, y2)) - 1;
      const maxY = Math.floor(Math.max(y1, y2)) + 1;
      for (let ox = minX; ox <= maxX; ox++) {
        for (let oy = minY; oy <= maxY; oy++) {
          ctx.beginPath();
          ctx.moveTo(toScreenX(x1 - ox, sw), toScreenY(y1 - oy, sh));
          ctx.lineTo(toScreenX(x2 - ox, sw), toScreenY(y2 - oy, sh));
          ctx.stroke();
        }
      }
    };

    const render = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      const sw = canvas.offsetWidth;
      const sh = canvas.offsetHeight;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, sw, sh);

      // Clip to the central box
      ctx.save();
      ctx.beginPath();
      ctx.rect(toScreenX(0, sw), toScreenY(0, sh), toScreenX(1, sw) - toScreenX(0, sw), toScreenY(1, sh) - toScreenY(0, sh));
      ctx.clip();

      // Grid
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 20; i++) {
        ctx.beginPath(); ctx.moveTo(toScreenX(i / 20, sw), toScreenY(0, sh)); ctx.lineTo(toScreenX(i / 20, sw), toScreenY(1, sh)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(toScreenX(0, sw), toScreenY(i / 20, sh)); ctx.lineTo(toScreenX(1, sw), toScreenY(i / 20, sh)); ctx.stroke();
      }

      // Edges
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      edges.forEach(edge => {
        const from = vertices.find(v => v.id === edge.fromId);
        if (from) {
          const isHighlighted = maxClique.size >= 3 && maxClique.has(edge.fromId) && maxClique.has(edge.toId);
          ctx.strokeStyle = isHighlighted ? '#facc15' : '#818cf8';
          ctx.shadowBlur = isHighlighted ? 25 : 10;
          ctx.shadowColor = isHighlighted ? '#f59e0b' : '#4f46e5';
          ctx.lineWidth = isHighlighted ? 6 : 3;
          drawWrappedLine(ctx, from.x, from.y, from.x + edge.dx, from.y + edge.dy, sw, sh);
        }
      });
      ctx.shadowBlur = 0;

      // Pending Drag
      if (activeDrag) {
        ctx.strokeStyle = '#f472b6';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#db2777';
        if (activeDrag.isDragging) ctx.setLineDash([5, 5]);

        drawWrappedLine(ctx, activeDrag.fromX, activeDrag.fromY, activeDrag.fromX + activeDrag.dx, activeDrag.fromY + activeDrag.dy, sw, sh);
        ctx.setLineDash([]);

        const vx = (((activeDrag.fromX + activeDrag.dx) % 1) + 1) % 1;
        const vy = (((activeDrag.fromY + activeDrag.dy) % 1) + 1) % 1;

        // Virtual Cursor / Grab handle
        ctx.fillStyle = activeDrag.isDragging ? '#f472b6' : '#ffffff';
        ctx.beginPath(); ctx.arc(toScreenX(vx, sw), toScreenY(vy, sh), 8, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toScreenX(vx, sw) - 20, toScreenY(vy, sh)); ctx.lineTo(toScreenX(vx, sw) + 20, toScreenY(vy, sh));
        ctx.moveTo(toScreenX(vx, sw), toScreenY(vy, sh) - 20); ctx.lineTo(toScreenX(vx, sw), toScreenY(vy, sh) + 20);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Vertices
      vertices.forEach(v => {
        const isHighlighted = maxClique.size >= 3 && maxClique.has(v.id);
        ctx.shadowBlur = isHighlighted ? 30 : 15;
        ctx.shadowColor = isHighlighted ? '#fbbf24' : '#818cf8';
        ctx.fillStyle = isHighlighted ? '#facc15' : '#020617';
        ctx.strokeStyle = isHighlighted ? '#ffffff' : '#818cf8'; 
        ctx.lineWidth = isHighlighted ? 4 : 2.5;

        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const vx = v.x + ox;
            const vy = v.y + oy;
            if (vx > -0.2 && vx < 1.2 && vy > -0.2 && vy < 1.2) {
              ctx.beginPath();
              ctx.arc(toScreenX(vx, sw), toScreenY(vy, sh), isHighlighted ? 11 : 9, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
        ctx.shadowBlur = 0;
      });

      // Restore from clip for boundaries and global effects
      ctx.restore();

      // Boundaries
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#22c55e'; // Green
      ctx.beginPath(); ctx.moveTo(toScreenX(0, sw), toScreenY(0, sh)); ctx.lineTo(toScreenX(0, sw), toScreenY(1, sh)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toScreenX(1, sw), toScreenY(0, sh)); ctx.lineTo(toScreenX(1, sw), toScreenY(1, sh)); ctx.stroke();
      ctx.strokeStyle = '#ef4444'; // Red
      ctx.beginPath(); ctx.moveTo(toScreenX(0, sw), toScreenY(0, sh)); ctx.lineTo(toScreenX(1, sw), toScreenY(0, sh)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toScreenX(0, sw), toScreenY(1, sh)); ctx.lineTo(toScreenX(1, sw), toScreenY(1, sh)); ctx.stroke();

      // Electric Shock Animation
      if (crossingInfo) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(toScreenX(0, sw), toScreenY(0, sh), toScreenX(1, sw) - toScreenX(0, sw), toScreenY(1, sh) - toScreenY(0, sh));
        ctx.clip();

        const { x1, y1, x2, y2, x3, y3, x4, y4 } = crossingInfo;

        // Find intersection point (re-calculating for animation)
        const det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
        if (det !== 0) {
          const t = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
          const rawIx = x1 + t * (x2 - x1);
          const rawIy = y1 + t * (y2 - y1);

          // Draw lightning spikes on all images of the intersection point
          ctx.strokeStyle = '#fbbf24'; // Yellow
          ctx.shadowBlur = 20;
          ctx.shadowColor = '#f59e0b';
          ctx.lineWidth = 4;

          // Check images in a small range around the viewport
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const ix = ((rawIx - ox % 1) + 1) % 1; // Normalize to 0-1
              const iy = ((rawIy - oy % 1) + 1) % 1;

              // We actually want to draw at the visible coordinates
              const screenIx = toScreenX(ix, sw);
              const screenIy = toScreenY(iy, sh);

              for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
                const len = 0.05 + Math.random() * 0.1;
                ctx.beginPath();
                ctx.moveTo(screenIx, screenIy);

                let cx = ix, cy = iy;
                const segments = 3;
                for (let j = 0; j < segments; j++) {
                  cx += (Math.cos(angle) * len / segments) + (Math.random() - 0.5) * 0.05;
                  cy += (Math.sin(angle) * len / segments) + (Math.random() - 0.5) * 0.05;
                  ctx.lineTo(toScreenX(cx, sw), toScreenY(cy, sh));
                }
                ctx.stroke();
              }
            }
          }

          // Offending segments flash
          ctx.strokeStyle = '#ef4444';
          ctx.setLineDash([5, 5]);
          drawWrappedLine(ctx, x1, y1, x2, y2, sw, sh);
          drawWrappedLine(ctx, x3, y3, x4, y4, sw, sh);
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }

      // Duplicate edge flash animation
      if (duplicateEdgeInfo) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(toScreenX(0, sw), toScreenY(0, sh), toScreenX(1, sw) - toScreenX(0, sw), toScreenY(1, sh) - toScreenY(0, sh));
        ctx.clip();

        const { x1, y1, x2, y2 } = duplicateEdgeInfo;
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 6;
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ea580c';
        ctx.setLineDash([8, 4]);
        drawWrappedLine(ctx, x1, y1, x2, y2, sw, sh);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      requestAnimationFrame(render);
    };
    const animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [vertices, edges, activeDrag, crossingInfo, duplicateEdgeInfo]);

  return (
    <>
    <canvas
      ref={canvasRef}
      onMouseDown={(e) => {
        if (e.button === 0) {
          lastMousePos.current = { x: e.clientX, y: e.clientY };
          handleStart(e.clientX, e.clientY);
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
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      className={`w-full h-full outline-none ${(vertexDragId || activeDrag?.isDragging) && isPointerOutside ? 'cursor-none' :
        currentTool === 'eraser' ? 'cursor-cell' :
          currentTool === 'edge' ? 'cursor-crosshair' : 'cursor-copy'
        }`}
      style={{ touchAction: 'none' }}
    />
    {maxClique.size >= 3 && (
      <div className="absolute bottom-4 left-4 text-xs font-mono text-slate-500 pointer-events-none opacity-40">
        Largest Clique Found: {maxClique.size} vertices
      </div>
    )}
    </>
  );
};
