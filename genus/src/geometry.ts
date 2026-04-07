// geometry.ts — math for genus-g surfaces as 4g-gons with edge identifications

export type Vec2 = { x: number; y: number };

export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, y: v.y * s }; }
export function len2(v: Vec2): number { return v.x * v.x + v.y * v.y; }
export function len(v: Vec2): number { return Math.sqrt(len2(v)); }
export function norm(v: Vec2): Vec2 {
  const l = len(v);
  if (l < 1e-12) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

// Polygon vertices for genus g: regular 4g-gon, first vertex at top (y-up math coords)
// V[k] = (cos(π/2 + 2πk/(4g)), sin(π/2 + 2πk/(4g)))
export function getPolygonVerts(g: number): Vec2[] {
  const n = 4 * g;
  const verts: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
    verts.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }
  return verts;
}

// Partner edge: pure index arithmetic (no g needed)
// i%4 ∈ {0,1}: partner = i+2; i%4 ∈ {2,3}: partner = i-2
export function edgePartner(i: number): number {
  const r = i % 4;
  if (r === 0 || r === 1) return i + 2;
  return i - 2;
}

// Edge frame: tangent e, inward normal n (90° CCW of e = inward for CCW polygon), origin V[i], length L
export function edgeFrame(i: number, verts: Vec2[]): { e: Vec2; n: Vec2; origin: Vec2; L: number } {
  const n = verts.length;
  const A = verts[i];
  const B = verts[(i + 1) % n];
  const d = sub(B, A);
  const L = len(d);
  const e = scale(d, 1 / L);
  // Inward normal for CCW polygon: rotate e by 90° CCW
  const nv: Vec2 = { x: -e.y, y: e.x };
  return { e, n: nv, origin: A, L };
}

// Point-in-polygon test (ray casting)
export function insidePolygon(p: Vec2, verts: Vec2[]): boolean {
  const n = verts.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if ((yi > p.y) !== (yj > p.y) &&
        p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Find first crossing of ray start+t*d with polygon edges
// Returns smallest t > ε such that the ray crosses an edge, with s ∈ [-ε, 1+ε]
export function firstCrossing(
  start: Vec2, d: Vec2, verts: Vec2[]
): { t: number; edgeIndex: number; point: Vec2 } | null {
  const n = verts.length;
  const EPS = 1e-9;
  let best: { t: number; edgeIndex: number; point: Vec2 } | null = null;

  for (let i = 0; i < n; i++) {
    const A = verts[i];
    const B = verts[(i + 1) % n];
    const ex = B.x - A.x;
    const ey = B.y - A.y;
    // Solve: start + t*d = A + s*(B-A)
    // d.x*t - ex*s = A.x - start.x
    // d.y*t - ey*s = A.y - start.y
    const det = d.x * ey - d.y * ex;
    if (Math.abs(det) < 1e-12) continue;
    const rx = A.x - start.x;
    const ry = A.y - start.y;
    const t = (rx * ey - ry * ex) / det;
    const s = (rx * d.y - ry * d.x) / det;
    if (t > EPS && t <= 1 && s >= -EPS && s <= 1 + EPS) {
      if (best === null || t < best.t) {
        best = {
          t,
          edgeIndex: i,
          point: add(start, scale(d, t)),
        };
      }
    }
  }
  return best;
}

// Map a point near exit edge i to the partner edge j
export function wrapPos(p: Vec2, exitEdge: number, _g: number, verts: Vec2[]): Vec2 {
  const j = edgePartner(exitEdge);
  const fi = edgeFrame(exitEdge, verts);
  const fj = edgeFrame(j, verts);

  const dp = sub(p, fi.origin);
  const ti = dot(dp, fi.e) / fi.L;   // parameter along exit edge
  const si_in = dot(dp, fi.n);        // distance from edge (negative if outside)

  // Reversed identification: parameter t on i maps to (1-t) on j
  // Distance outside edge i maps to distance inside edge j
  return add(
    add(fj.origin, scale(fj.e, (1 - ti) * fj.L)),
    scale(fj.n, -si_in)
  );
}

// Jacobian of wrapPos: maps velocity through exit edge i
export function wrapDir(v: Vec2, exitEdge: number, _g: number, verts: Vec2[]): Vec2 {
  const j = edgePartner(exitEdge);
  const fi = edgeFrame(exitEdge, verts);
  const fj = edgeFrame(j, verts);
  // wrapPos = Vj + (1-ti)*L*ej + (-si_in)*nj
  // d/dt: -dot(v,ei)*ej - dot(v,ni)*nj
  return add(
    scale(fj.e, -dot(v, fi.e)),
    scale(fj.n, -dot(v, fi.n))
  );
}

// Follow a path from start with displacement d, wrapping at polygon edges
export function tracePath(start: Vec2, d: Vec2, g: number, verts: Vec2[]): Vec2 {
  let pos = start;
  let rem = d;
  for (let iter = 0; iter < 6; iter++) {
    const cross = firstCrossing(pos, rem, verts);
    if (!cross) {
      return add(pos, rem);
    }
    const crossPt = add(pos, scale(rem, cross.t));
    const remLen = len(rem) * (1 - cross.t);
    const newDir = wrapDir(norm(rem), cross.edgeIndex, g, verts);
    pos = wrapPos(crossPt, cross.edgeIndex, g, verts);
    rem = scale(newDir, remLen);
  }
  return add(pos, rem);
}

// Edge colors: paired edges get same color
// Handle h (i in [4h, 4h+3]):
//   type a (i%4==0 or 2): colors[h][0]
//   type b (i%4==1 or 3): colors[h][1]
const HANDLE_COLORS: [string, string][] = [
  ['#ef4444', '#3b82f6'],   // handle 0: red, blue
  ['#f97316', '#06b6d4'],   // handle 1: orange, cyan
  ['#a855f7', '#eab308'],   // handle 2: purple, yellow
  ['#22c55e', '#ec4899'],   // handle 3: green, pink
];

export function edgeColor(i: number): string {
  const h = Math.floor(i / 4);
  const r = i % 4;
  const isTypeA = r === 0 || r === 2;
  return HANDLE_COLORS[h % HANDLE_COLORS.length][isTypeA ? 0 : 1];
}

// Unicode subscript digits
const SUBSCRIPTS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function subscript(n: number): string {
  return String(n).split('').map(c => SUBSCRIPTS[parseInt(c)] ?? c).join('');
}

export function edgeLabel(i: number): string {
  const h = Math.floor(i / 4) + 1;
  const r = i % 4;
  const sub = subscript(h);
  if (r === 0) return 'a' + sub;
  if (r === 1) return 'b' + sub;
  if (r === 2) return 'a' + sub + '\u207B\u00B9';
  return 'b' + sub + '\u207B\u00B9';
}
