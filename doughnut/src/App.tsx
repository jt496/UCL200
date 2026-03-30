import { useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas2D } from './components/Canvas2D';
import { Torus3D } from './components/Torus3D';
import { Layout, Donut, Trash2, HelpCircle, Save, FolderOpen, Undo2, CircleDot, ArrowRight, Lock, Unlock, Eraser } from 'lucide-react';

export type Vertex = {
  id: string;
  x: number; // 0 to 1
  y: number; // 0 to 1
};

export type Edge = {
  id: string;
  fromId: string;
  toId: string;
  dx: number; // Displacement in normalized coordinates
  dy: number;
};

type GraphState = {
  vertices: Vertex[];
  edges: Edge[];
};

type Tool = 'vertex' | 'edge' | 'eraser';

// Helper for segment intersection
function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
  id1: string, id2: string, id3: string, id4: string
): boolean {
  const sharedVertex = (id1 === id3 || id1 === id4 || id2 === id3 || id2 === id4);
  const det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (det === 0) return false;
  const lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
  const gamma = ((y1 - y2) * (x4 - x1) + (x2 - x1) * (y4 - y1)) / det;
  const epsilon = 1e-9;
  if (sharedVertex) {
    return (epsilon < lambda && lambda < 1 - epsilon) && (epsilon < gamma && gamma < 1 - epsilon);
  }
  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(Math.pow(px - (x1 + t * (x2 - x1)), 2) + Math.pow(py - (y1 + t * (y2 - y1)), 2));
}

function isGraphValid(vList: Vertex[], eList: Edge[]): boolean {
  for (let i = 0; i < eList.length; i++) {
    const edge = eList[i];
    const fromV = vList.find(v => v.id === edge.fromId);
    if (!fromV) continue;
    const x1 = fromV.x, y1 = fromV.y, x2 = fromV.x + edge.dx, y2 = fromV.y + edge.dy;
    for (let j = i + 1; j < eList.length; j++) {
      const other = eList[j];
      const ev1 = vList.find(v => v.id === other.fromId);
      if (!ev1) continue;
      const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + other.dx, ey2 = ev1.y + other.dy;
      const minX = Math.floor(Math.min(x1, x2)) - Math.ceil(Math.max(ex1, ex2));
      const maxX = Math.ceil(Math.max(x1, x2)) - Math.floor(Math.min(ex1, ex2));
      const minY = Math.floor(Math.min(y1, y2)) - Math.ceil(Math.max(ey1, ey2));
      const maxY = Math.ceil(Math.max(y1, y2)) - Math.floor(Math.min(ey1, ey2));
      for (let ox = minX; ox <= maxX; ox++) {
        for (let oy = minY; oy <= maxY; oy++) {
          if (segmentsIntersect(x1, y1, x2, y2, ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy, edge.fromId, edge.toId, other.fromId, other.toId)) return false;
        }
      }
    }
  }
  for (const v of vList) {
    for (const otherV of vList) {
      if (v.id === otherV.id) continue;
      if (Math.sqrt(Math.pow(v.x - otherV.x, 2) + Math.pow(v.y - otherV.y, 2)) < 0.05) return false;
    }
    for (const edge of eList) {
      if (edge.fromId === v.id || edge.toId === v.id) continue;
      const ev1 = vList.find(ve => ve.id === edge.fromId);
      if (!ev1) continue;
      const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + edge.dx, ey2 = ev1.y + edge.dy;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          if (pointToSegmentDistance(v.x, v.y, ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy) < 0.03) return false;
        }
      }
    }
  }
  return true;
}

function getMaxClique(vertices: Vertex[], edges: Edge[]): Set<string> {
  if (vertices.length === 0) return new Set();
  
  const adj = new Map<string, Set<string>>();
  vertices.forEach(v => adj.set(v.id, new Set()));
  
  edges.forEach(e => {
    adj.get(e.fromId)?.add(e.toId);
    adj.get(e.toId)?.add(e.fromId);
  });

  let maxClique = new Set<string>();

  function bronKerbosch(r: Set<string>, p: Set<string>, x: Set<string>) {
    if (p.size === 0 && x.size === 0) {
      if (r.size > maxClique.size) {
        maxClique = new Set(r);
      }
      return;
    }
    
    const pivot = Array.from(new Set([...p, ...x]))[0];
    const neighborsOfPivot = adj.get(pivot) || new Set();
    const candidates = Array.from(p).filter(v => !neighborsOfPivot.has(v));
    
    for (const v of candidates) {
      const neighborsOfV = adj.get(v) || new Set();
      bronKerbosch(
        new Set([...r, v]),
        new Set(Array.from(p).filter(node => neighborsOfV.has(node))),
        new Set(Array.from(x).filter(node => neighborsOfV.has(node)))
      );
      p.delete(v);
      x.add(v);
    }
  }

  bronKerbosch(new Set(), new Set(vertices.map(v => v.id)), new Set());
  return maxClique;
}

function App() {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [history, setHistory] = useState<GraphState[]>([]);
  const [is3D, setIs3D] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>('vertex');
  const [showHelp, setShowHelp] = useState(false);
  const [preventCrossings, setPreventCrossings] = useState(true);
  const [crossingInfo, setCrossingInfo] = useState<{
    x1: number; y1: number; x2: number; y2: number;
    x3: number; y3: number; x4: number; y4: number;
  } | null>(null);
  const [duplicateEdgeInfo, setDuplicateEdgeInfo] = useState<{
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null);

  const maxClique = useMemo(() => getMaxClique(vertices, edges), [vertices, edges]);

  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, { vertices, edges }].slice(-50)); // Keep last 50 steps
  }, [vertices, edges]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setVertices(lastState.vertices);
    setEdges(lastState.edges);
  }, [history]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  // Auto-load on mount
  useEffect(() => {
    const saved = localStorage.getItem('torus-graph');
    if (saved) {
      try {
        const { v, e } = JSON.parse(saved);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVertices(v);
        setEdges(e);
      } catch (err) {
        console.error("Failed to load graph", err);
      }
    }
  }, []);

  const saveGraph = () => {
    const data = JSON.stringify({ v: vertices, e: edges });
    localStorage.setItem('torus-graph', data);
    alert("Graph saved!");
  };

  const loadGraph = () => {
    const saved = localStorage.getItem('torus-graph');
    if (saved) {
      const { v, e } = JSON.parse(saved);
      setVertices(v);
      setEdges(e);
    }
  };

  const addVertex = (x: number, y: number) => {
    if (preventCrossings) {
      // Check proximity to other vertices
      for (const v of vertices) {
        if (Math.sqrt(Math.pow(v.x - x, 2) + Math.pow(v.y - y, 2)) < 0.06) return;
      }
      // Check proximity to edges
      for (const edge of edges) {
        const ev1 = vertices.find(v => v.id === edge.fromId);
        if (!ev1) continue;
        const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + edge.dx, ey2 = ev1.y + edge.dy;
        for (let ox = -2; ox <= 2; ox++) {
          for (let oy = -2; oy <= 2; oy++) {
            if (pointToSegmentDistance(x, y, ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy) < 0.035) return;
          }
        }
      }
    }
    saveToHistory();
    const newVertex: Vertex = {
      id: crypto.randomUUID(),
      x,
      y,
    };
    setVertices(prev => [...prev, newVertex]);
  };

  const moveVertex = (id: string, dx: number, dy: number) => {
    if (preventCrossings) {
      const movedV = vertices.find(v => v.id === id);
      if (!movedV) return;

      const nextX = ((movedV.x + dx) % 1 + 1) % 1;
      const nextY = ((movedV.y + dy) % 1 + 1) % 1;

      // Temporary edges for crossing check
      const nextEdges = edges.map(e => {
        if (e.fromId === id) return { ...e, dx: e.dx - dx, dy: e.dy - dy };
        if (e.toId === id) return { ...e, dx: e.dx + dx, dy: e.dy + dy };
        return e;
      });

      // Temporary vertices for crossing check
      const nextVertices = vertices.map(v => v.id === id ? { ...v, x: nextX, y: nextY } : v);

      // Check all affected edges against ALL other edges
      // (This is more thorough and handles the case where moving a vertex makes its edges cross existing ones)
      const affectedEdgeIds = edges.filter(e => e.fromId === id || e.toId === id).map(e => e.id);

      for (const edgeId of affectedEdgeIds) {
        const edge = nextEdges.find(e => e.id === edgeId)!;
        const fromV = nextVertices.find(v => v.id === edge.fromId)!;
        const x1 = fromV.x, y1 = fromV.y, x2 = fromV.x + edge.dx, y2 = fromV.y + edge.dy;

        for (const other of nextEdges) {
          if (other.id === edge.id) continue;
          const ev1 = nextVertices.find(v => v.id === other.fromId);
          if (!ev1) continue;

          const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + other.dx, ey2 = ev1.y + other.dy;

          const minX = Math.floor(Math.min(x1, x2)) - Math.ceil(Math.max(ex1, ex2));
          const maxX = Math.ceil(Math.max(x1, x2)) - Math.floor(Math.min(ex1, ex2));
          const minY = Math.floor(Math.min(y1, y2)) - Math.ceil(Math.max(ey1, ey2));
          const maxY = Math.ceil(Math.max(y1, y2)) - Math.floor(Math.min(ey1, ey2));

          for (let ox = minX; ox <= maxX; ox++) {
            for (let oy = minY; oy <= maxY; oy++) {
              if (segmentsIntersect(
                x1, y1, x2, y2,
                ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy,
                edge.fromId, edge.toId, other.fromId, other.toId
              )) {
                return; // BLOCK MOVE
              }
            }
          }
        }
      }

      // 2. Check if the vertex itself crosses or lands on any edge it's NOT connected to
      const myPathX1 = movedV.x;
      const myPathY1 = movedV.y;
      const myPathX2 = movedV.x + dx;
      const myPathY2 = movedV.y + dy;

      for (const edge of nextEdges) {
        if (edge.fromId === id || edge.toId === id) continue;

        const ev1 = nextVertices.find(v => v.id === edge.fromId)!;
        const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + edge.dx, ey2 = ev1.y + edge.dy;

        const minX = Math.floor(Math.min(myPathX1, myPathX2)) - Math.ceil(Math.max(ex1, ex2));
        const maxX = Math.ceil(Math.max(myPathX1, myPathX2)) - Math.floor(Math.min(ex1, ex2));
        const minY = Math.floor(Math.min(myPathY1, myPathY2)) - Math.ceil(Math.max(ey1, ey2));
        const maxY = Math.ceil(Math.max(myPathY1, myPathY2)) - Math.floor(Math.min(ey1, ey2));

        for (let ox = minX; ox <= maxX; ox++) {
          for (let oy = minY; oy <= maxY; oy++) {
            const tex1 = ex1 + ox;
            const tey1 = ey1 + oy;
            const tex2 = ex2 + ox;
            const tey2 = ey2 + oy;

            // Check if vertex path crosses edge
            if (segmentsIntersect(
              myPathX1, myPathY1, myPathX2, myPathY2,
              tex1, tey1, tex2, tey2,
              id, "path-end", edge.fromId, edge.toId
            )) {
              return;
            }

            // Check if final position is too close to edge
            if (pointToSegmentDistance(nextX, nextY, tex1, tey1, tex2, tey2) < 0.035) {
              return;
            }
          }
        }
      }

      // 3. Check proximity to other vertices
      for (const otherV of vertices) {
        if (otherV.id === id) continue;
        if (Math.sqrt(Math.pow(otherV.x - nextX, 2) + Math.pow(otherV.y - nextY, 2)) < 0.05) {
          return;
        }
      }
    }

    setVertices(prev => prev.map(v => {
      if (v.id === id) {
        return {
          ...v,
          x: ((v.x + dx) % 1 + 1) % 1,
          y: ((v.y + dy) % 1 + 1) % 1
        };
      }
      return v;
    }));

    // Adjust edges connected to this vertex
    setEdges(prev => prev.map(e => {
      if (e.fromId === id) {
        return { ...e, dx: e.dx - dx, dy: e.dy - dy };
      }
      if (e.toId === id) {
        return { ...e, dx: e.dx + dx, dy: e.dy + dy };
      }
      return e;
    }));
  };

  const toggleStrict = () => {
    const nextMode = !preventCrossings;
    setPreventCrossings(nextMode);

    if (nextMode) {
      // Cleanup existing crossings
      setEdges(prevEdges => {
        const safeEdges: Edge[] = [];
        for (const edge of prevEdges) {
          let hasCrossing = false;

          const fromV = vertices.find(v => v.id === edge.fromId);
          const toV = vertices.find(v => v.id === edge.toId);
          if (!fromV || !toV) continue;

          const x1 = fromV.x, y1 = fromV.y, x2 = fromV.x + edge.dx, y2 = fromV.y + edge.dy;

          for (const safe of safeEdges) {
            const ev1 = vertices.find(v => v.id === safe.fromId);
            if (!ev1) continue;

            const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + safe.dx, ey2 = ev1.y + safe.dy;

            // Check all periodic images
            // We can reuse a wider range for safety or pre-calculate
            for (let ox = -2; ox <= 2; ox++) {
              for (let oy = -2; oy <= 2; oy++) {
                if (segmentsIntersect(
                  x1, y1, x2, y2,
                  ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy,
                  edge.fromId, edge.toId, safe.fromId, safe.toId
                )) {
                  hasCrossing = true;
                  break;
                }
              }
              if (hasCrossing) break;
            }
            if (hasCrossing) break;
          }

          if (!hasCrossing) {
            safeEdges.push(edge);
          }
        }

        // Remove duplicate edges (keep first of each vertex pair)
        const dedupedEdges: Edge[] = [];
        for (const edge of safeEdges) {
          const isDuplicate = dedupedEdges.some(e =>
            (e.fromId === edge.fromId && e.toId === edge.toId) ||
            (e.fromId === edge.toId && e.toId === edge.fromId)
          );
          if (!isDuplicate) dedupedEdges.push(edge);
        }

        if (dedupedEdges.length !== prevEdges.length) {
          saveToHistory();
        }
        return dedupedEdges;
      });
    }
  };

  const addEdge = (fromId: string, toId: string, dx: number, dy: number) => {
    if (preventCrossings) {
      // Check for duplicate edges
      const existingEdge = edges.find(e =>
        (e.fromId === fromId && e.toId === toId) ||
        (e.fromId === toId && e.toId === fromId)
      );
      if (existingEdge) {
        const ev1 = vertices.find(v => v.id === existingEdge.fromId);
        if (ev1) {
          setDuplicateEdgeInfo({ x1: ev1.x, y1: ev1.y, x2: ev1.x + existingEdge.dx, y2: ev1.y + existingEdge.dy });
          setTimeout(() => setDuplicateEdgeInfo(null), 600);
        }
        return;
      }

      const fromV = vertices.find(v => v.id === fromId);
      const toV = vertices.find(v => v.id === toId);
      if (!fromV || !toV) return;

      const x1 = fromV.x, y1 = fromV.y, x2 = fromV.x + dx, y2 = fromV.y + dy;

      for (const edge of edges) {
        const ev1 = vertices.find(v => v.id === edge.fromId);
        if (!ev1) continue;

        const ex1 = ev1.x, ey1 = ev1.y, ex2 = ev1.x + edge.dx, ey2 = ev1.y + edge.dy;

        const minX = Math.floor(Math.min(x1, x2)) - Math.ceil(Math.max(ex1, ex2));
        const maxX = Math.ceil(Math.max(x1, x2)) - Math.floor(Math.min(ex1, ex2));
        const minY = Math.floor(Math.min(y1, y2)) - Math.ceil(Math.max(ey1, ey2));
        const maxY = Math.ceil(Math.max(y1, y2)) - Math.floor(Math.min(ey1, ey2));

        for (let ox = minX; ox <= maxX; ox++) {
          for (let oy = minY; oy <= maxY; oy++) {
            if (segmentsIntersect(
              x1, y1, x2, y2,
              ex1 + ox, ey1 + oy, ex2 + ox, ey2 + oy,
              fromId, toId, edge.fromId, edge.toId
            )) {
              setCrossingInfo({
                x1, y1, x2, y2,
                x3: ex1 + ox, y3: ey1 + oy, x4: ex2 + ox, y4: ey2 + oy
              });
              setTimeout(() => setCrossingInfo(null), 500);
              return;
            }
          }
        }
      }
    }

    saveToHistory();
    const newEdge: Edge = {
      id: crypto.randomUUID(),
      fromId,
      toId,
      dx,
      dy,
    };
    setEdges(prev => [...prev, newEdge]);
  };

  const endMove = () => {
    if (preventCrossings && !isGraphValid(vertices, edges)) {
      undo();
    }
  };


  const clearGraph = () => {
    if (confirm("Clear entire graph?")) {
      saveToHistory();
      setVertices([]);
      setEdges([]);
    }
  };

  const removeVertex = (id: string) => {
    saveToHistory();
    setVertices(prev => prev.filter(v => v.id !== id));
    setEdges(prev => prev.filter(e => e.fromId !== id && e.toId !== id));
  };

  const removeEdge = (id: string) => {
    saveToHistory();
    setEdges(prev => prev.filter(e => e.id !== id));
  };

  return (
    <div className="relative w-full h-full bg-black text-slate-100 overflow-hidden font-sans select-none touch-none">
      {/* Help Modal (Responsive) - Moved to top for maximum visibility */}
      {showHelp && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black p-4 pointer-events-auto cursor-pointer" onClick={() => setShowHelp(false)}>
          <div className="bg-slate-900 w-full max-w-lg max-h-[90vh] rounded-3xl border-2 border-indigo-500 flex flex-col shadow-[0_0_50px_rgba(79,70,229,0.5)] cursor-default" onClick={e => e.stopPropagation()}>
            <div className="overflow-y-auto p-6 sm:p-8 flex-1 custom-scrollbar" onClick={() => setShowHelp(false)}>
              <h3 className="text-3xl sm:text-4xl font-black mb-6 text-center" style={{ color: '#818cf8', display: 'block', textShadow: '0 0 20px rgba(129, 140, 248, 0.5)' }}>Instructions</h3>
              <div className="space-y-4 sm:space-y-6">
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><CircleDot size={24} /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#a5b4fc', margin: 0 }}>Vertex Mode</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Tap anywhere on the grid to place new vertices. Drag vertices to move them. This is the default mode.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><ArrowRight size={24} className="rotate-[-45deg]" /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#a5b4fc', margin: 0 }}>Edge Mode</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Drag from one vertex to another. Drag across the screen boundaries to create wrap-around edges.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-pink-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><Eraser size={24} /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#f9a8d4', margin: 0 }}>Eraser Mode</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Tap any vertex or edge to remove it from the torus.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><Undo2 size={24} /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#a5b4fc', margin: 0 }}>Undo Action</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Press Ctrl + Z or use the undo button in the toolbar.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><Lock size={24} /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#a5b4fc', margin: 0 }}>Strict Mode</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Prevents edges from crossing each other on the doughnut, and disallows multiple edges between the same pair of vertices.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 sm:gap-8">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0" style={{ color: '#ffffff' }}><Donut size={24} /></div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold leading-tight" style={{ color: '#a5b4fc', margin: 0 }}>Doughnut View</p>
                    <p className="text-sm sm:text-base mt-1" style={{ color: '#ffffff' }}>Switch to the 3D Doughnut view to see your graph wrapped around a torus!</p>
                  </div>
                </div>
              </div>
              <p className="mt-8 text-center text-slate-400 font-bold animate-pulse uppercase tracking-widest text-sm">Tap anywhere to close</p>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar / Header */}
      <div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-4 flex flex-col gap-4 pointer-events-none">
        <div className="flex justify-between items-center w-full">
          <div className="flex gap-1 sm:gap-2 pointer-events-auto">
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 bg-indigo-700 hover:bg-indigo-600 rounded-xl shadow-lg transition-all active:scale-95 border border-indigo-500/30"
            >
              <HelpCircle size={20} className="sm:w-6 sm:h-6" />
              <span className="hidden md:inline font-bold">Instructions</span>
            </button>
            <button
              onClick={() => setIs3D(!is3D)}
              className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 bg-slate-900 hover:bg-slate-800 rounded-xl shadow-lg transition-all active:scale-95 border border-slate-700/50 text-white"
            >
              {is3D ? <Layout size={20} className="sm:w-6 sm:h-6" /> : <Donut size={20} className="sm:w-6 sm:h-6" />}
              <span className="hidden md:inline font-bold">{is3D ? '2D View' : 'Doughnut View'}</span>
            </button>
            <button
              onClick={toggleStrict}
              className={`flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 rounded-xl shadow-lg transition-all active:scale-95 border ${preventCrossings ? 'bg-indigo-700 border-indigo-500/50' : 'bg-slate-900 border-slate-700/50'} text-white`}
              title={preventCrossings ? "Enforce Doughnut Planarity" : "Allow Crossings"}
            >
              {preventCrossings ? <Lock size={18} className="sm:w-5 sm:h-5" /> : <Unlock size={18} className="sm:w-5 sm:h-5" />}
              <span className="hidden md:inline font-bold">{preventCrossings ? 'Strict' : 'Free'}</span>
            </button>
          </div>

          <div className="flex gap-1 sm:gap-2 pointer-events-auto">
            <button
              onClick={undo}
              className="p-2 sm:p-3 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} className="sm:w-5 sm:h-5" />
            </button>
            <button onClick={saveGraph} className="p-2 sm:p-3 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Save">
              <Save size={18} className="sm:w-5 sm:h-5" />
            </button>
            <button onClick={loadGraph} className="p-2 sm:p-3 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Load">
              <FolderOpen size={18} className="sm:w-5 sm:h-5" />
            </button>
            <button onClick={clearGraph} className="p-2 sm:p-3 bg-slate-900 hover:bg-red-900 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Clear">
              <Trash2 size={18} className="sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Mode Toggles */}
        <div className="flex justify-center gap-2 pointer-events-auto">
          <div className="bg-slate-900/90 backdrop-blur-xl p-2 rounded-3xl border-2 border-slate-700/50 flex gap-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <button
              onClick={() => setCurrentTool('vertex')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-black text-lg ${currentTool === 'vertex'
                ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-105'
                : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
            >
              <CircleDot size={24} strokeWidth={currentTool === 'vertex' ? 3 : 2} />
              <span>Vertex</span>
            </button>
            <button
              onClick={() => setCurrentTool('edge')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-black text-lg ${currentTool === 'edge'
                ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-105'
                : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
            >
              <ArrowRight size={24} className="rotate-[-45deg]" strokeWidth={currentTool === 'edge' ? 3 : 2} />
              <span>Edge</span>
            </button>
            <button
              onClick={() => setCurrentTool('eraser')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-black text-lg ${currentTool === 'eraser'
                ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.4)] scale-105 animate-pulse'
                : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
            >
              <Eraser size={24} className={currentTool === 'eraser' ? 'rotate-12' : ''} strokeWidth={currentTool === 'eraser' ? 3 : 2} />
              <span>Eraser</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!showHelp && (
        <div className="w-full h-full flex items-center justify-center px-10 py-12 sm:p-24 bg-black">
          <div className={`relative ${is3D ? 'w-full h-full' : ''}`}>
            <div className={`relative w-full ${is3D ? 'h-full' : 'aspect-square max-h-[80vh] max-w-[80vh] bg-black rounded-2xl shadow-[0_0_80px_rgba(79,70,229,0.15)] border border-slate-800/50 overflow-hidden'}`}>
              {is3D ? (
                <Torus3D vertices={vertices} edges={edges} maxClique={maxClique} />
              ) : (
                <Canvas2D
                  vertices={vertices}
                  edges={edges}
                  maxClique={maxClique}
                  currentTool={currentTool}
                  onAddVertex={addVertex}
                  onAddEdge={addEdge}
                  onRemoveVertex={removeVertex}
                  onRemoveEdge={removeEdge}
                  onMoveVertex={moveVertex}
                  onStartMove={saveToHistory}
                  onEndMove={endMove}
                  crossingInfo={crossingInfo}
                  duplicateEdgeInfo={duplicateEdgeInfo}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
