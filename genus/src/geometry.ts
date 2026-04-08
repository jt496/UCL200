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

// ---- Complex arithmetic (Vec2 as complex numbers) ----
function cmul(a: Vec2, b: Vec2): Vec2 { return { x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x }; }
function cconj(a: Vec2): Vec2 { return { x: a.x, y: -a.y }; }
function cdiv(a: Vec2, b: Vec2): Vec2 {
  const d = b.x * b.x + b.y * b.y;
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
}
function cabs2(a: Vec2): number { return a.x * a.x + a.y * a.y; }

// ---- PSU(1,1) Möbius transformations ----
// f(z) = (a*z + b) / (conj(b)*z + conj(a)), |a|²-|b|²=1
export type MobiusDisc = { a: Vec2; b: Vec2 };

export function mobiusApply(m: MobiusDisc, z: Vec2): Vec2 {
  const num = add(cmul(m.a, z), m.b);
  const den = add(cmul(cconj(m.b), z), cconj(m.a));
  return cdiv(num, den);
}

export function mobiusDerivAt(m: MobiusDisc, z: Vec2): Vec2 {
  // m'(z) = 1 / (conj(b)*z + conj(a))²
  const den = add(cmul(cconj(m.b), z), cconj(m.a));
  const den2 = cmul(den, den);
  const d = den2.x * den2.x + den2.y * den2.y;
  return { x: den2.x / d, y: -den2.y / d }; // 1/den2
}

export function mobiusCompose(f: MobiusDisc, g: MobiusDisc): MobiusDisc {
  // compose(f, g)(z) = f(g(z))
  // a_new = a_f*a_g + b_f*conj(b_g)
  // b_new = a_f*b_g + b_f*conj(a_g)
  return {
    a: add(cmul(f.a, g.a), cmul(f.b, cconj(g.b))),
    b: add(cmul(f.a, g.b), cmul(f.b, cconj(g.a))),
  };
}

const IDENTITY_MOBIUS: MobiusDisc = { a: { x: 1, y: 0 }, b: { x: 0, y: 0 } };

// ---- Polygon vertices ----

// For g=1: unit square corners (flat torus)
// For g>=2: regular 4g-gon in Poincaré disc with correct hyperbolic circumradius
export function getPolygonVerts(g: number): Vec2[] {
  if (g === 1) {
    // Flat square: corners at ±0.5 (same as before, scaled to fit)
    return [
      { x: -0.5, y: -0.5 },
      { x:  0.5, y: -0.5 },
      { x:  0.5, y:  0.5 },
      { x: -0.5, y:  0.5 },
    ];
  }
  return getHyperbolicPolygonVerts(g);
}

export function getHyperbolicPolygonVerts(g: number): Vec2[] {
  const n = 4 * g;
  // For a regular n-gon with interior angle α = 2π/n = π/(2g),
  // the hyperbolic circumradius satisfies: cosh(R) = cos(π/n) / sin(α/2) = cot(π/n)
  const cotPiN = Math.cos(Math.PI / n) / Math.sin(Math.PI / n);
  const coshR = cotPiN; // cot(π/n), NOT cot²
  // R = acosh(coshR), euclidean radius r = tanh(R/2)
  const R = Math.log(coshR + Math.sqrt(coshR * coshR - 1));
  const r = Math.tanh(R / 2);
  const verts: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
    verts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  return verts;
}

// ---- Deck transformations ----

// Compute the PSU(1,1) element mapping A->C, B->D (two-point map)
// where A->0 via gA, then we build h(0)=D', h(gA(B))=gA(C), then compose with gA_inv
function buildMobiusFromTwoPoints(A: Vec2, B: Vec2, C: Vec2, D: Vec2): MobiusDisc {
  // g_A: z -> (z-A)/(1 - conj(A)*z)
  const normA = Math.sqrt(1 - cabs2(A));
  const gA: MobiusDisc = {
    a: { x: 1 / normA, y: 0 },
    b: { x: -A.x / normA, y: -A.y / normA },
  };
  const gA_inv: MobiusDisc = {
    a: { x: 1 / normA, y: 0 },
    b: { x: A.x / normA, y: A.y / normA },
  };

  const p = mobiusApply(gA, B);   // gA(B)
  const w1 = mobiusApply(gA, D);  // gA(D)
  const w2 = mobiusApply(gA, C);  // gA(C)

  // h: 0->w1, p->w2
  // e^{iθ} = w2 * (1 + conj(w1)*p) / (p + w1)  (as complex), normalized
  const numerator = cmul(w2, add({ x: 1, y: 0 }, cmul(cconj(w1), p)));
  const denominator = add(p, w1);
  const eiTheta_raw = cdiv(numerator, denominator);
  const eiTheta_mag = Math.sqrt(cabs2(eiTheta_raw));
  const eiTheta: Vec2 = eiTheta_mag > 1e-12
    ? { x: eiTheta_raw.x / eiTheta_mag, y: eiTheta_raw.y / eiTheta_mag }
    : { x: 1, y: 0 };

  const normW1 = Math.sqrt(1 - cabs2(w1));
  const h: MobiusDisc = {
    a: cdiv(eiTheta, { x: normW1, y: 0 }),
    b: cdiv(cmul(eiTheta, w1), { x: normW1, y: 0 }),
  };

  return mobiusCompose(gA_inv, mobiusCompose(h, gA));
}

export function getDeckTransforms(verts: Vec2[]): MobiusDisc[] {
  const n = verts.length;
  const decks: MobiusDisc[] = [];
  for (let i = 0; i < n; i++) {
    const j = edgePartner(i);
    const A = verts[i];
    const B = verts[(i + 1) % n];
    const C = verts[j];
    const D = verts[(j + 1) % n];
    // M_i(A) = D, M_i(B) = C  (edge i maps to edge j reversed)
    decks.push(buildMobiusFromTwoPoints(A, B, D, C));
  }
  return decks;
}

// ---- Flat torus helpers (g=1) ----

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
  const ti = dot(dp, fi.e) / fi.L;
  const si_in = dot(dp, fi.n);

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
  return add(
    scale(fj.e, -dot(v, fi.e)),
    scale(fj.n, -dot(v, fi.n))
  );
}

// Compute the exact displacement from (fromX,fromY) that reaches (targetX,targetY)
export function snapDisplacementTo(
  fromX: number, fromY: number,
  approxVx: number, approxVy: number,
  targetX: number, targetY: number,
  g: number, verts: Vec2[]
): Vec2 {
  let pos: Vec2 = { x: fromX, y: fromY };
  let rem: Vec2 = { x: approxVx, y: approxVy };
  let Jxx = 1, Jxy = 0, Jyx = 0, Jyy = 1;

  for (let iter = 0; iter < 6; iter++) {
    const cross = firstCrossing(pos, rem, verts);
    if (!cross) break;

    const fi = edgeFrame(cross.edgeIndex, verts);
    const fj = edgeFrame(edgePartner(cross.edgeIndex), verts);
    const Wxx = -fi.e.x * fj.e.x - fi.n.x * fj.n.x;
    const Wxy = -fi.e.y * fj.e.x - fi.n.y * fj.n.x;
    const Wyx = -fi.e.x * fj.e.y - fi.n.x * fj.n.y;
    const Wyy = -fi.e.y * fj.e.y - fi.n.y * fj.n.y;
    const nJxx = Wxx * Jxx + Wxy * Jyx;
    const nJxy = Wxx * Jxy + Wxy * Jyy;
    const nJyx = Wyx * Jxx + Wyy * Jyx;
    const nJyy = Wyx * Jxy + Wyy * Jyy;
    Jxx = nJxx; Jxy = nJxy; Jyx = nJyx; Jyy = nJyy;

    const crossPt = add(pos, scale(rem, cross.t));
    const remLen = len(rem) * (1 - cross.t);
    const newDir = wrapDir(norm(rem), cross.edgeIndex, g, verts);
    pos = wrapPos(crossPt, cross.edgeIndex, g, verts);
    rem = scale(newDir, remLen);
  }

  const actualEnd = add(pos, rem);
  const errX = targetX - actualEnd.x;
  const errY = targetY - actualEnd.y;
  return { x: approxVx + Jxx * errX + Jyx * errY, y: approxVy + Jxy * errX + Jyy * errY };
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

// ---- Hyperbolic geometry ----

export function isHyperbolic(g: number): boolean { return g >= 2; }

// Hyperbolic distance in Poincaré disc
function hypDist(z1: Vec2, z2: Vec2): number {
  const dz = sub(z1, z2);
  const num = Math.sqrt(len2(dz));
  const den_complex = sub({ x: 1, y: 0 }, cmul(cconj(z1), z2));
  const den = Math.sqrt(len2(den_complex));
  if (den < 1e-14) return 0;
  const ratio = num / den;
  if (ratio >= 1) return 1e10;
  return 2 * Math.atanh(ratio);
}

// Normalize angle to [0, 2π)
function normAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

// Compute geodesic circle for two points in the disc.
// Returns null if they are collinear with origin (geodesic is a diameter).
function geodesicCircle(p1: Vec2, p2: Vec2): { cx: number; cy: number; r: number } | null {
  const cross = p1.x * p2.y - p1.y * p2.x;
  if (Math.abs(cross) < 1e-8) return null;

  // From system: 2*cx*x1 + 2*cy*y1 = x1²+y1²+1, same for p2
  const r1sq = p1.x * p1.x + p1.y * p1.y;
  const r2sq = p2.x * p2.x + p2.y * p2.y;
  const det = 2 * cross;
  const cx = ((r1sq + 1) * p2.y - (r2sq + 1) * p1.y) / det;
  const cy = ((r2sq + 1) * p1.x - (r1sq + 1) * p2.x) / det;
  const r = Math.sqrt(cx * cx + cy * cy - 1);
  return { cx, cy, r };
}

// Check if point P lies on the arc from start to end (on a geodesic circle with center cx,cy,r)
function onGeodesicArc(
  P: Vec2, start: Vec2, end: Vec2,
  cx: number, cy: number, _r: number,
  isLine: boolean
): boolean {
  const EPS = 1e-6;
  if (isLine) {
    const ab = sub(end, start);
    const l2 = len2(ab);
    if (l2 < 1e-14) return false;
    const t = dot(sub(P, start), ab) / l2;
    return t > -EPS && t < 1 + EPS;
  }
  const aStart = Math.atan2(start.y - cy, start.x - cx);
  const aEnd = Math.atan2(end.y - cy, end.x - cx);
  const aP = Math.atan2(P.y - cy, P.x - cx);

  // Find which arc direction (CCW or CW) stays inside the disc
  const aMidCCW = aStart + normAngle(aEnd - aStart) / 2;
  const midCCW: Vec2 = {
    x: cx + _r * Math.cos(aMidCCW),
    y: cy + _r * Math.sin(aMidCCW),
  };
  const ccwIsInside = len2(midCCW) < 1;

  if (ccwIsInside) {
    const dEnd = normAngle(aEnd - aStart);
    const dP = normAngle(aP - aStart);
    return dP >= -EPS && dP <= dEnd + EPS;
  } else {
    const dEnd = normAngle(aStart - aEnd);
    const dP = normAngle(aStart - aP);
    return dP >= -EPS && dP <= dEnd + EPS;
  }
}

// Find crossing of geodesic arc (pos→target) with boundary geodesic arc (A→B).
// Returns {t, point} with t = d_H(pos, P) / d_H(pos, target), or null.
export function hypGeodesicCrossing(
  pos: Vec2, target: Vec2,
  A: Vec2, B: Vec2
): { t: number; point: Vec2 } | null {
  const gc1 = geodesicCircle(pos, target);
  const pathIsLine = gc1 === null;
  const gc2 = geodesicCircle(A, B);
  const boundIsLine = gc2 === null;

  const candidates: Vec2[] = [];

  if (pathIsLine && boundIsLine) {
    // Both are diameters — find intersection of two line segments
    const d1 = sub(target, pos);
    const d2 = sub(B, A);
    const det = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(det) < 1e-12) return null;
    const rx = A.x - pos.x, ry = A.y - pos.y;
    const t = (rx * d2.y - ry * d2.x) / det;
    const s = (rx * d1.y - ry * d1.x) / det;
    if (t > 1e-8 && t <= 1 + 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) {
      candidates.push(add(pos, scale(d1, t)));
    }
  } else if (pathIsLine && !boundIsLine) {
    // path is diameter, boundary is circle
    const { cx, cy, r } = gc2!;
    const d = sub(target, pos);
    // parametric: pos + t*d on circle (x-cx)²+(y-cy)²=r²
    const fx = pos.x - cx, fy = pos.y - cy;
    const a2 = len2(d);
    const b2 = 2 * (fx * d.x + fy * d.y);
    const c2 = fx * fx + fy * fy - r * r;
    const disc = b2 * b2 - 4 * a2 * c2;
    if (disc < 0) return null;
    const sqd = Math.sqrt(disc);
    for (const sign of [-1, 1]) {
      const t = (-b2 + sign * sqd) / (2 * a2);
      if (t > 1e-8 && t <= 1 + 1e-6) {
        candidates.push(add(pos, scale(d, t)));
      }
    }
  } else if (!pathIsLine && boundIsLine) {
    // path is circle, boundary is diameter
    const { cx, cy, r } = gc1!;
    const d = sub(B, A);
    const fx = A.x - cx, fy = A.y - cy;
    const a2 = len2(d);
    const b2 = 2 * (fx * d.x + fy * d.y);
    const c2 = fx * fx + fy * fy - r * r;
    const disc = b2 * b2 - 4 * a2 * c2;
    if (disc < 0) return null;
    const sqd = Math.sqrt(disc);
    for (const sign of [-1, 1]) {
      const t = (-b2 + sign * sqd) / (2 * a2);
      if (t >= -1e-6 && t <= 1 + 1e-6) {
        candidates.push(add(A, scale(d, t)));
      }
    }
  } else {
    // Both are circles: use radical axis
    const { cx: cx1, cy: cy1, r: r1 } = gc1!;
    const { cx: cx2, cy: cy2, r: r2 } = gc2!;
    const ddx = 2 * (cx2 - cx1);
    const ddy = 2 * (cy2 - cy1);
    const K = r2 * r2 - r1 * r1 + cx2 * cx2 - cx1 * cx1 + cy2 * cy2 - cy1 * cy1;

    if (Math.abs(ddy) > Math.abs(ddx)) {
      // y = (K - ddx*x) / ddy
      const A_coef = 1 + (ddx / ddy) * (ddx / ddy);
      const B_coef = -2 * cx1 + 2 * (cy1 - K / ddy) * (ddx / ddy);
      const C_coef = (cx1 * cx1) + (cy1 - K / ddy) * (cy1 - K / ddy) - r1 * r1;
      const disc = B_coef * B_coef - 4 * A_coef * C_coef;
      if (disc < 0) return null;
      const sqd = Math.sqrt(disc);
      for (const sign of [-1, 1]) {
        const x = (-B_coef + sign * sqd) / (2 * A_coef);
        const y = (K - ddx * x) / ddy;
        candidates.push({ x, y });
      }
    } else {
      if (Math.abs(ddx) < 1e-12) return null;
      // x = (K - ddy*y) / ddx
      const A_coef = 1 + (ddy / ddx) * (ddy / ddx);
      const B_coef = -2 * cy1 + 2 * (cx1 - K / ddx) * (ddy / ddx);
      const C_coef = (cy1 * cy1) + (cx1 - K / ddx) * (cx1 - K / ddx) - r1 * r1;
      const disc = B_coef * B_coef - 4 * A_coef * C_coef;
      if (disc < 0) return null;
      const sqd = Math.sqrt(disc);
      for (const sign of [-1, 1]) {
        const y = (-B_coef + sign * sqd) / (2 * A_coef);
        const x = (K - ddy * y) / ddx;
        candidates.push({ x, y });
      }
    }
  }

  const totalDist = hypDist(pos, target);
  let best: { t: number; point: Vec2 } | null = null;

  for (const P of candidates) {
    // Must be inside the disc
    if (len2(P) >= 1 - 1e-10) continue;
    // Must lie on path arc (pos -> target)
    if (!onGeodesicArc(P, pos, target,
      pathIsLine ? 0 : gc1!.cx,
      pathIsLine ? 0 : gc1!.cy,
      pathIsLine ? 1 : gc1!.r,
      pathIsLine)) continue;
    // Must lie on boundary arc (A -> B)
    if (!onGeodesicArc(P, A, B,
      boundIsLine ? 0 : gc2!.cx,
      boundIsLine ? 0 : gc2!.cy,
      boundIsLine ? 1 : gc2!.r,
      boundIsLine)) continue;

    const distToP = hypDist(pos, P);
    if (distToP < 1e-8) continue; // at starting point

    const t = totalDist > 1e-12 ? distToP / totalDist : 1;
    if (t > 1 + 1e-6) continue;
    if (best === null || t < best.t) {
      best = { t, point: P };
    }
  }

  return best;
}

// Trace geodesic path from pos to target with Möbius wrapping
export function hypTracePath(
  pos: Vec2, target: Vec2,
  verts: Vec2[], decks: MobiusDisc[]
): Vec2 {
  const n = verts.length;
  let curPos = pos;
  let curTarget = target;

  for (let iter = 0; iter < 8; iter++) {
    let best: { t: number; point: Vec2; edgeIndex: number } | null = null;
    for (let i = 0; i < n; i++) {
      const cross = hypGeodesicCrossing(curPos, curTarget, verts[i], verts[(i + 1) % n]);
      if (cross && (best === null || cross.t < best.t)) {
        best = { t: cross.t, point: cross.point, edgeIndex: i };
      }
    }
    if (!best) return curTarget;
    curPos = mobiusApply(decks[best.edgeIndex], best.point);
    curTarget = mobiusApply(decks[best.edgeIndex], curTarget);
  }
  return curTarget;
}

// Get segments of a hyperbolic edge for hit testing
export function hypGetEdgeSegs(
  fromPos: Vec2, target: Vec2,
  verts: Vec2[], decks: MobiusDisc[]
): Array<[Vec2, Vec2]> {
  const n = verts.length;
  const segs: Array<[Vec2, Vec2]> = [];
  let curPos = fromPos;
  let curTarget = target;

  for (let iter = 0; iter < 8; iter++) {
    let best: { t: number; point: Vec2; edgeIndex: number } | null = null;
    for (let i = 0; i < n; i++) {
      const cross = hypGeodesicCrossing(curPos, curTarget, verts[i], verts[(i + 1) % n]);
      if (cross && (best === null || cross.t < best.t)) {
        best = { t: cross.t, point: cross.point, edgeIndex: i };
      }
    }
    if (!best) {
      segs.push([curPos, curTarget]);
      break;
    }
    segs.push([curPos, best.point]);
    curPos = mobiusApply(decks[best.edgeIndex], best.point);
    curTarget = mobiusApply(decks[best.edgeIndex], curTarget);
  }
  return segs;
}

// Snap to exact vertex after Möbius wrapping chain
export function hypSnapTo(
  fromPos: Vec2, approxTarget: Vec2,
  exactVertex: Vec2,
  verts: Vec2[], decks: MobiusDisc[]
): Vec2 {
  const n = verts.length;
  let curPos = fromPos;
  let curTarget = approxTarget;
  let composedM: MobiusDisc = IDENTITY_MOBIUS;

  for (let iter = 0; iter < 8; iter++) {
    let best: { t: number; point: Vec2; edgeIndex: number } | null = null;
    for (let i = 0; i < n; i++) {
      const cross = hypGeodesicCrossing(curPos, curTarget, verts[i], verts[(i + 1) % n]);
      if (cross && (best === null || cross.t < best.t)) {
        best = { t: cross.t, point: cross.point, edgeIndex: i };
      }
    }
    if (!best) break;
    composedM = mobiusCompose(decks[best.edgeIndex], composedM);
    curPos = mobiusApply(decks[best.edgeIndex], best.point);
    curTarget = mobiusApply(decks[best.edgeIndex], curTarget);
  }

  return mobiusApply(composedM, exactVertex);
}

// Compute geodesic arc params for drawing in Poincaré disc.
// Returns isLine=true for a diameter, or circle parameters in math coords.
export type GeodesicArcParams =
  | { isLine: true; z1: Vec2; z2: Vec2 }
  | { isLine: false; cx: number; cy: number; r: number; z1: Vec2; z2: Vec2 };

export function geodesicArcParams(z1: Vec2, z2: Vec2): GeodesicArcParams {
  const gc = geodesicCircle(z1, z2);
  if (!gc) return { isLine: true, z1, z2 };
  return { isLine: false, cx: gc.cx, cy: gc.cy, r: gc.r, z1, z2 };
}

// ---- Edge colors and labels (shared) ----

const HANDLE_COLORS: [string, string][] = [
  ['#ef4444', '#3b82f6'],
  ['#f97316', '#06b6d4'],
  ['#a855f7', '#eab308'],
  ['#22c55e', '#ec4899'],
];

export function edgeColor(i: number): string {
  const h = Math.floor(i / 4);
  const r = i % 4;
  const isTypeA = r === 0 || r === 2;
  return HANDLE_COLORS[h % HANDLE_COLORS.length][isTypeA ? 0 : 1];
}

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
