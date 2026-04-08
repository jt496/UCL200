import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PolygonCanvas } from './components/PolygonCanvas';
import {
  HelpCircle, Trash2, Save, FolderOpen, Undo2, CircleDot, ArrowRight,
  Lock, Unlock, Eraser,
} from 'lucide-react';
import {
  getPolygonVerts, getDeckTransforms,
  firstCrossing, wrapDir, wrapPos, edgePartner,
  hypGetEdgeSegs,
  insidePolygon, edgeColor, edgeLabel,
  isHyperbolic,
  add, scale, norm, len,
  type Vec2,
} from './geometry';

export type Vertex = { id: string; x: number; y: number };
// tx, ty: absolute position of virtual endpoint in the universal cover
// g=1: (tx,ty) ∈ R² (may be outside [0,1]²)
// g≥2: (tx,ty) ∈ Poincaré disc D
export type Edge = {
  id: string;
  fromId: string;
  toId: string;
  tx: number;
  ty: number;
};

type GraphState = { vertices: Vertex[]; edges: Edge[] };
type Tool = 'vertex' | 'edge' | 'eraser';

// ---- Segment intersection helpers ----
function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
  id1: string, id2: string, id3: string, id4: string
): boolean {
  const sharedVertex = id1 === id3 || id1 === id4 || id2 === id3 || id2 === id4;
  const det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (det === 0) return false;
  const lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
  const gamma = ((y1 - y2) * (x4 - x1) + (x2 - x1) * (y4 - y1)) / det;
  const eps = 1e-9;
  if (sharedVertex) {
    return (eps < lambda && lambda < 1 - eps) && (eps < gamma && gamma < 1 - eps);
  }
  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

function pointToSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
  return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
}

// Get path segments for an edge (for crossing checks in math coords)
function getEdgeSegs(
  fromX: number, fromY: number, tx: number, ty: number,
  g: number, verts: Vec2[]
): Array<[Vec2, Vec2]> {
  if (isHyperbolic(g)) {
    const decks = getDeckTransforms(verts);
    return hypGetEdgeSegs({ x: fromX, y: fromY }, { x: tx, y: ty }, verts, decks);
  }
  // g=1: flat torus, tx/ty are absolute endpoint, displacement = (tx-fromX, ty-fromY)
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

function segsIntersect(
  segs1: Array<[Vec2, Vec2]>, segs2: Array<[Vec2, Vec2]>,
  e1fromId: string, e1toId: string, e2fromId: string, e2toId: string
): boolean {
  for (const [a, b] of segs1) {
    for (const [c, d] of segs2) {
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, e1fromId, e1toId, e2fromId, e2toId)) {
        return true;
      }
    }
  }
  return false;
}

function isGraphValid(vList: Vertex[], eList: Edge[], g: number, verts: Vec2[]): boolean {
  for (let i = 0; i < eList.length; i++) {
    const e1 = eList[i];
    const from1 = vList.find(v => v.id === e1.fromId);
    if (!from1) continue;
    const segs1 = getEdgeSegs(from1.x, from1.y, e1.tx, e1.ty, g, verts);
    for (let j = i + 1; j < eList.length; j++) {
      const e2 = eList[j];
      const from2 = vList.find(v => v.id === e2.fromId);
      if (!from2) continue;
      const segs2 = getEdgeSegs(from2.x, from2.y, e2.tx, e2.ty, g, verts);
      if (segsIntersect(segs1, segs2, e1.fromId, e1.toId, e2.fromId, e2.toId)) return false;
    }
  }
  for (const v of vList) {
    for (const ov of vList) {
      if (v.id === ov.id) continue;
      if (Math.sqrt((v.x - ov.x) ** 2 + (v.y - ov.y) ** 2) < 0.05) return false;
    }
    for (const e of eList) {
      if (e.fromId === v.id || e.toId === v.id) continue;
      const from = vList.find(fv => fv.id === e.fromId);
      if (!from) continue;
      const segs = getEdgeSegs(from.x, from.y, e.tx, e.ty, g, verts);
      for (const [a, b] of segs) {
        if (pointToSegDist(v.x, v.y, a.x, a.y, b.x, b.y) < 0.03) return false;
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
  let maxR: string[] = [];
  function solve(r: string[], p: string[], x: string[]) {
    if (p.length === 0 && x.length === 0) {
      if (r.length > maxR.length) maxR = [...r];
      return;
    }
    if (r.length + p.length <= maxR.length) return;
    const pivot = [...p, ...x][0];
    const pNeighbors = adj.get(pivot) ?? new Set<string>();
    const candidates = p.filter(v => !pNeighbors.has(v));
    for (const v of candidates) {
      const vN = adj.get(v)!;
      solve([...r, v], p.filter(u => vN.has(u)), x.filter(u => vN.has(u)));
      p = p.filter(u => u !== v);
      x.push(v);
    }
  }
  solve([], vertices.map(v => v.id), []);
  return new Set(maxR);
}

function App() {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [genus, setGenus] = useState(2);
  const [history, setHistory] = useState<GraphState[]>([]);
  const [currentTool, setCurrentTool] = useState<Tool>('vertex');
  const [showHelp, setShowHelp] = useState(false);
  const [preventCrossings, setPreventCrossings] = useState(true);
  const [crossingInfo, setCrossingInfo] = useState<{ fromId: string; toId: string } | null>(null);
  const [duplicateEdgeInfo, setDuplicateEdgeInfo] = useState<{ fromId: string; toId: string } | null>(null);

  const lastClique = useRef<Set<string>>(new Set());
  const highlightedClique = useMemo(() => {
    const newClique = getMaxClique(vertices, edges);
    const prev = lastClique.current;
    if (prev.size > 0) {
      const adj = new Map<string, Set<string>>();
      vertices.forEach(v => adj.set(v.id, new Set()));
      edges.forEach(e => {
        adj.get(e.fromId)?.add(e.toId);
        adj.get(e.toId)?.add(e.fromId);
      });
      const ids = Array.from(prev);
      if (ids.every(id => adj.has(id))) {
        let isClique = true;
        outer: for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            if (!adj.get(ids[i])?.has(ids[j])) { isClique = false; break outer; }
          }
        }
        if (isClique && prev.size >= newClique.size) return prev;
      }
    }
    lastClique.current = newClique;
    return newClique;
  }, [vertices, edges]);

  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, { vertices, edges }].slice(-50));
  }, [vertices, edges]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setVertices(last.vertices);
    setEdges(last.edges);
  }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  // TikZ export
  const generateTikZ = useCallback(() => {
    const g = genus;
    const verts = getPolygonVerts(g);
    const n = verts.length;
    const vLabel = new Map<string, string>();
    vertices.forEach((v, i) => vLabel.set(v.id, `v${i + 1}`));

    const lines: string[] = [];
    lines.push(`% Genus-${g} surface graph (polygon representation)`);
    lines.push(`% Requires: \\usepackage{tikz,xcolor}`);
    lines.push(``);
    lines.push(`\\begin{tikzpicture}[scale=3.5]`);

    for (let i = 0; i < n; i++) {
      const A = verts[i];
      const B = verts[(i + 1) % n];
      const col = edgeColor(i);
      const tikzCol = col.replace('#', '');
      lines.push(`  \\definecolor{ec${i}}{HTML}{${tikzCol}}`);
      lines.push(`  \\draw[ec${i}, line width=1.5pt] (${A.x.toFixed(4)},${A.y.toFixed(4)}) -- (${B.x.toFixed(4)},${B.y.toFixed(4)});`);
      const mx = ((A.x + B.x) / 2).toFixed(4);
      const my = ((A.y + B.y) / 2).toFixed(4);
      const lbl = edgeLabel(i);
      lines.push(`  \\node[ec${i}, font=\\tiny] at (${mx},${my}) {${lbl}};`);
    }

    lines.push(`  \\begin{scope}`);
    const polyCoords = verts.map(v => `(${v.x.toFixed(4)},${v.y.toFixed(4)})`).join(' -- ');
    lines.push(`    \\clip ${polyCoords} -- cycle;`);

    if (!isHyperbolic(g)) {
      edges.forEach(edge => {
        const from = vertices.find(v => v.id === edge.fromId);
        if (!from) return;
        const isH = highlightedClique.size >= 3 &&
          highlightedClique.has(edge.fromId) && highlightedClique.has(edge.toId);
        const style = isH ? 'thick, orange!80!yellow' : 'violet!60!blue';

        let pos: Vec2 = { x: from.x, y: from.y };
        let rem: Vec2 = { x: edge.tx - from.x, y: edge.ty - from.y };
        for (let iter = 0; iter < 6; iter++) {
          const cross = firstCrossing(pos, rem, verts);
          if (!cross) {
            const end = add(pos, rem);
            lines.push(`    \\draw[${style}] (${pos.x.toFixed(4)},${pos.y.toFixed(4)}) -- (${end.x.toFixed(4)},${end.y.toFixed(4)});`);
            break;
          }
          const crossPt = add(pos, scale(rem, cross.t));
          lines.push(`    \\draw[${style}] (${pos.x.toFixed(4)},${pos.y.toFixed(4)}) -- (${crossPt.x.toFixed(4)},${crossPt.y.toFixed(4)});`);
          const remLen = len(rem) * (1 - cross.t);
          const newDir = wrapDir(norm(rem), cross.edgeIndex, g, verts);
          pos = wrapPos(crossPt, cross.edgeIndex, g, verts);
          rem = scale(newDir, remLen);
        }
      });
    } else {
      // Hyperbolic: just draw straight segments (TikZ approximation)
      edges.forEach(edge => {
        const from = vertices.find(v => v.id === edge.fromId);
        if (!from) return;
        const isH = highlightedClique.size >= 3 &&
          highlightedClique.has(edge.fromId) && highlightedClique.has(edge.toId);
        const style = isH ? 'thick, orange!80!yellow' : 'violet!60!blue';
        const decks = getDeckTransforms(verts);
        const segs = hypGetEdgeSegs({ x: from.x, y: from.y }, { x: edge.tx, y: edge.ty }, verts, decks);
        for (const [a, b] of segs) {
          lines.push(`    \\draw[${style}] (${a.x.toFixed(4)},${a.y.toFixed(4)}) -- (${b.x.toFixed(4)},${b.y.toFixed(4)});`);
        }
      });
    }

    lines.push(`  \\end{scope}`);

    vertices.forEach(v => {
      lines.push(`  \\filldraw[fill=black, draw=violet!60!blue] (${v.x.toFixed(4)},${v.y.toFixed(4)}) circle (1.2pt); % ${vLabel.get(v.id)}`);
    });

    lines.push(`\\end{tikzpicture}`);

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `genus-${g}-graph.tikz`;
    a.click();
    URL.revokeObjectURL(url);
  }, [genus, vertices, edges, highlightedClique]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        generateTikZ();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [generateTikZ]);

  // Auto-load on mount
  useEffect(() => {
    const key = `genus-graph-${genus}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const { v, e } = JSON.parse(saved) as { v: Vertex[]; e: Edge[] };
        setVertices(v);
        setEdges(e);
      } catch (err) {
        console.error('Failed to load graph', err);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  const saveGraph = () => {
    localStorage.setItem(`genus-graph-${genus}`, JSON.stringify({ v: vertices, e: edges }));
    alert('Graph saved!');
  };

  const loadGraph = () => {
    const saved = localStorage.getItem(`genus-graph-${genus}`);
    if (saved) {
      const { v, e } = JSON.parse(saved) as { v: Vertex[]; e: Edge[] };
      setVertices(v);
      setEdges(e);
    }
  };

  const clearGraph = () => {
    if (confirm('Clear entire graph?')) {
      saveToHistory();
      setVertices([]);
      setEdges([]);
    }
  };

  const changeGenus = (g: number) => {
    if (g === genus) return;
    if (vertices.length > 0 || edges.length > 0) {
      if (!confirm(`Switch to genus ${g}? This will clear the current graph.`)) return;
    }
    setVertices([]);
    setEdges([]);
    setHistory([]);
    setGenus(g);
    const saved = localStorage.getItem(`genus-graph-${g}`);
    if (saved) {
      try {
        const { v, e } = JSON.parse(saved) as { v: Vertex[]; e: Edge[] };
        setVertices(v);
        setEdges(e);
      } catch (_) { /* ignore */ }
    }
  };

  const addVertex = (x: number, y: number) => {
    const g = genus;
    const verts = getPolygonVerts(g);
    if (!insidePolygon({ x, y }, verts)) return;
    if (preventCrossings) {
      for (const v of vertices) {
        if (Math.sqrt((v.x - x) ** 2 + (v.y - y) ** 2) < 0.06) return;
      }
      for (const edge of edges) {
        const ev = vertices.find(v => v.id === edge.fromId);
        if (!ev) continue;
        const segs = getEdgeSegs(ev.x, ev.y, edge.tx, edge.ty, g, verts);
        for (const [a, b] of segs) {
          if (pointToSegDist(x, y, a.x, a.y, b.x, b.y) < 0.035) return;
        }
      }
    }
    saveToHistory();
    setVertices(prev => [...prev, { id: crypto.randomUUID(), x, y }]);
  };

  const addEdge = (fromId: string, toId: string, tx: number, ty: number) => {
    if (preventCrossings) {
      const dup = edges.find(e =>
        (e.fromId === fromId && e.toId === toId) ||
        (e.fromId === toId && e.toId === fromId)
      );
      if (dup) {
        setDuplicateEdgeInfo({ fromId: dup.fromId, toId: dup.toId });
        setTimeout(() => setDuplicateEdgeInfo(null), 600);
        return;
      }
      const g = genus;
      const verts = getPolygonVerts(g);
      const from = vertices.find(v => v.id === fromId);
      if (!from) return;
      const newSegs = getEdgeSegs(from.x, from.y, tx, ty, g, verts);
      for (const edge of edges) {
        const ev = vertices.find(v => v.id === edge.fromId);
        if (!ev) continue;
        const segs = getEdgeSegs(ev.x, ev.y, edge.tx, edge.ty, g, verts);
        if (segsIntersect(newSegs, segs, fromId, toId, edge.fromId, edge.toId)) {
          setCrossingInfo({ fromId, toId });
          setTimeout(() => setCrossingInfo(null), 500);
          return;
        }
      }
    }
    saveToHistory();
    setEdges(prev => [...prev, { id: crypto.randomUUID(), fromId, toId, tx, ty }]);
  };

  const moveVertex = (id: string, ddx: number, ddy: number) => {
    const movedV = vertices.find(v => v.id === id);
    if (!movedV) return;
    const g = genus;
    const verts = getPolygonVerts(g);
    const newPos: Vec2 = { x: movedV.x + ddx, y: movedV.y + ddy };

    if (!insidePolygon(newPos, verts)) return;

    if (preventCrossings) {
      for (const ov of vertices) {
        if (ov.id === id) continue;
        if (Math.sqrt((ov.x - newPos.x) ** 2 + (ov.y - newPos.y) ** 2) < 0.05) return;
      }
    }

    setVertices(prev => prev.map(v =>
      v.id === id ? { ...v, x: newPos.x, y: newPos.y } : v
    ));

    setEdges(prev => prev.map(e => {
      if (isHyperbolic(g)) {
        // For hyperbolic: tx,ty are absolute disc coords.
        // When from-vertex moves, tx,ty (absolute endpoint) stays the same.
        // When to-vertex moves, approximate: shift tx,ty by (ddx,ddy).
        if (e.fromId === id) {
          return e; // endpoint doesn't change
        }
        if (e.toId === id) {
          return { ...e, tx: e.tx + ddx, ty: e.ty + ddy };
        }
        return e;
      } else {
        // g=1 flat torus
        if (e.fromId === id) {
          // tx,ty is absolute endpoint; from-vertex moved, so endpoint stays same,
          // meaning displacement (tx-from.x, ty-from.y) changes by (-ddx,-ddy).
          // But tx,ty is absolute, so no update needed.
          return e;
        }
        if (e.toId === id) {
          // to-vertex moved: compute wrapped delta
          const from = vertices.find(v => v.id === e.fromId);
          if (!from) return e;
          const disp: Vec2 = { x: e.tx - from.x, y: e.ty - from.y };
          const cross = firstCrossing({ x: from.x, y: from.y }, disp, verts);
          let dv: Vec2;
          if (!cross) {
            dv = { x: ddx, y: ddy };
          } else {
            dv = wrapDir({ x: ddx, y: ddy }, edgePartner(cross.edgeIndex), g, verts);
          }
          return { ...e, tx: e.tx + dv.x, ty: e.ty + dv.y };
        }
        return e;
      }
    }));
  };

  const endMove = () => {
    const g = genus;
    const verts = getPolygonVerts(g);
    if (preventCrossings && !isGraphValid(vertices, edges, g, verts)) {
      undo();
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

  const toggleStrict = () => {
    const next = !preventCrossings;
    setPreventCrossings(next);
    if (next) {
      const g = genus;
      const verts = getPolygonVerts(g);
      setEdges(prevEdges => {
        const safe: Edge[] = [];
        for (const edge of prevEdges) {
          const from = vertices.find(v => v.id === edge.fromId);
          if (!from) continue;
          const newSegs = getEdgeSegs(from.x, from.y, edge.tx, edge.ty, g, verts);
          let hasCross = false;
          for (const se of safe) {
            const sfrom = vertices.find(v => v.id === se.fromId);
            if (!sfrom) continue;
            const ssegs = getEdgeSegs(sfrom.x, sfrom.y, se.tx, se.ty, g, verts);
            if (segsIntersect(newSegs, ssegs, edge.fromId, edge.toId, se.fromId, se.toId)) {
              hasCross = true; break;
            }
          }
          if (!hasCross) safe.push(edge);
        }
        const deduped: Edge[] = [];
        for (const edge of safe) {
          const isDup = deduped.some(e =>
            (e.fromId === edge.fromId && e.toId === edge.toId) ||
            (e.fromId === edge.toId && e.toId === edge.fromId)
          );
          if (!isDup) deduped.push(edge);
        }
        return deduped;
      });
    }
  };

  return (
    <div className="relative w-full h-full bg-black text-slate-100 overflow-hidden font-sans select-none touch-none">
      {/* Help Modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black p-4 pointer-events-auto cursor-pointer"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-slate-900 w-full max-w-lg max-h-[90vh] rounded-3xl border-2 border-indigo-500 flex flex-col shadow-[0_0_50px_rgba(79,70,229,0.5)] cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <div className="overflow-y-auto p-6 sm:p-8 flex-1" onClick={() => setShowHelp(false)}>
              <h3 className="text-3xl sm:text-4xl font-black mb-6 text-center text-indigo-400" style={{ textShadow: '0 0 20px rgba(129,140,248,0.5)' }}>
                Genus Surface
              </h3>
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-xl p-4">
                  <p className="font-bold text-indigo-300 mb-1">What is this?</p>
                  <p className="text-sm text-slate-300">
                    A genus-g surface is built from a regular 4g-gon by identifying its edges in pairs.
                    Opposite edges are glued with reversed orientation according to the word{' '}
                    <span className="font-mono text-indigo-200">a₁b₁a₁⁻¹b₁⁻¹ … aᵍbᵍaᵍ⁻¹bᵍ⁻¹</span>.
                    For g=1 this gives the torus; for g=2, the double torus; etc.
                    For g≥2 the polygon is drawn in the Poincaré disc model of hyperbolic geometry.
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-4">
                  <p className="font-bold text-indigo-300 mb-1">Edge Colours</p>
                  <p className="text-sm text-slate-300 mb-2">
                    Paired edges share the same colour. When drawing wraps across a coloured edge,
                    it re-enters through the matching same-coloured edge with reversed orientation.
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    {[...Array(4 * genus)].map((_, i) => (
                      <span key={i} style={{ color: edgeColor(i) }}>{edgeLabel(i)}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0"><CircleDot size={20} /></div>
                  <div>
                    <p className="font-bold text-indigo-300">Vertex Mode</p>
                    <p className="text-sm text-slate-300">Click inside the polygon to add vertices. Drag to move them.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0"><ArrowRight size={20} /></div>
                  <div>
                    <p className="font-bold text-indigo-300">Edge Mode</p>
                    <p className="text-sm text-slate-300">Drag from one vertex to another. Edges that cross a polygon boundary wrap to the identified edge automatically.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="bg-pink-600 p-2 rounded-lg shrink-0"><Eraser size={20} /></div>
                  <div>
                    <p className="font-bold text-indigo-300">Eraser Mode</p>
                    <p className="text-sm text-slate-300">Click a vertex or edge to remove it.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="bg-indigo-600 p-2 rounded-lg shrink-0"><Lock size={20} /></div>
                  <div>
                    <p className="font-bold text-indigo-300">Strict Mode</p>
                    <p className="text-sm text-slate-300">Prevents edge crossings and duplicate edges (simple graph on the surface).</p>
                  </div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4">
                  <p className="font-bold text-indigo-300 mb-1">Seven Colour Theorem</p>
                  <p className="text-sm text-slate-300">
                    The chromatic number of a genus-g surface satisfies χ ≤ ⌊(7+√(1+48g))/2⌋.
                    The maximum clique (highlighted gold) gives a lower bound on chromatic number.
                    Try to find K₇ on the torus (g=1) or larger cliques on higher genus surfaces!
                  </p>
                </div>
                <p className="text-center text-slate-400 font-bold animate-pulse uppercase tracking-widest text-sm mt-4">
                  Tap anywhere to close
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-4 flex flex-col gap-3 pointer-events-none">
        <div className="flex justify-between items-center w-full">
          {/* Left controls */}
          <div className="flex gap-1 sm:gap-2 pointer-events-auto flex-wrap">
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-xl shadow-lg transition-all active:scale-95 border border-indigo-500/30"
            >
              <HelpCircle size={18} />
              <span className="hidden md:inline font-bold text-sm">Help</span>
            </button>

            {/* Genus selector */}
            <div className="flex gap-1 bg-slate-900/80 rounded-xl p-1 border border-slate-700/50">
              {[1, 2, 3, 4].map(g => (
                <button
                  key={g}
                  onClick={() => changeGenus(g)}
                  className={`px-2 py-1.5 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                    genus === g
                      ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)]'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  g={g}
                </button>
              ))}
            </div>

            <button
              onClick={toggleStrict}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg transition-all active:scale-95 border ${
                preventCrossings ? 'bg-indigo-700 border-indigo-500/50' : 'bg-slate-900 border-slate-700/50'
              } text-white`}
              title={preventCrossings ? 'Strict mode ON' : 'Strict mode OFF'}
            >
              {preventCrossings ? <Lock size={16} /> : <Unlock size={16} />}
              <span className="hidden md:inline font-bold text-sm">{preventCrossings ? 'Strict' : 'Free'}</span>
            </button>
          </div>

          {/* Right controls */}
          <div className="flex gap-1 sm:gap-2 pointer-events-auto">
            <button onClick={undo} className="p-2 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Undo (Ctrl+Z)">
              <Undo2 size={16} />
            </button>
            <button onClick={saveGraph} className="p-2 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Save">
              <Save size={16} />
            </button>
            <button onClick={loadGraph} className="p-2 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Load">
              <FolderOpen size={16} />
            </button>
            <button onClick={clearGraph} className="p-2 bg-slate-900 hover:bg-red-900 rounded-xl border border-slate-700/50 shadow-lg transition-all active:scale-95" title="Clear">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* Tool selector */}
        <div className="flex justify-center pointer-events-auto">
          <div className="bg-slate-900/90 backdrop-blur-xl p-2 rounded-3xl border-2 border-slate-700/50 flex gap-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <button
              onClick={() => setCurrentTool('vertex')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all font-black text-base ${
                currentTool === 'vertex'
                  ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-105'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <CircleDot size={20} strokeWidth={currentTool === 'vertex' ? 3 : 2} />
              <span>Vertex</span>
            </button>
            <button
              onClick={() => setCurrentTool('edge')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all font-black text-base ${
                currentTool === 'edge'
                  ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-105'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <ArrowRight size={20} className="rotate-[-45deg]" strokeWidth={currentTool === 'edge' ? 3 : 2} />
              <span>Edge</span>
            </button>
            <button
              onClick={() => setCurrentTool('eraser')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all font-black text-base ${
                currentTool === 'eraser'
                  ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.4)] scale-105 animate-pulse'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <Eraser size={20} className={currentTool === 'eraser' ? 'rotate-12' : ''} strokeWidth={currentTool === 'eraser' ? 3 : 2} />
              <span>Eraser</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main canvas area */}
      <div className="w-full h-full flex items-center justify-center p-4 sm:p-20">
        <div className="relative w-full aspect-square max-h-[78vh] max-w-[78vh] bg-black rounded-2xl shadow-[0_0_80px_rgba(79,70,229,0.15)] border border-slate-800/50 overflow-hidden">
          <PolygonCanvas
            vertices={vertices}
            edges={edges}
            genus={genus}
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
            maxClique={highlightedClique}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
