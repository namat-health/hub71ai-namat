// Bakes the healthspan section's barefoot-print-in-sand sprites into public/assets/healthspan/.
// The relief is lit once here (heightmap, cast shadows, ambient occlusion, warm bounce) so the
// page only crossfades two transparent layers. Flat sand is alpha 0, so the page colour shows through.
//
//   node scripts/bake-healthspan-relief.mjs          sprites (deterministic, about 12 s)
//   node scripts/bake-healthspan-relief.mjs sheets   contact sheets in output/healthspan-relief/
//
// sharp is installed with Astro; this script is a development tool and never runs in the build.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/healthspan');
const SHEETS = path.join(ROOT, 'output/healthspan-relief');

// ------------------------------------------------------------------ config
const W = 480, H = 240;          // sprite size (1x)
const SS = 2;                    // supersampling factor for height + lighting
const W2 = W * SS, H2 = H * SS;
const FOOT_LEN = 300;            // px at 1x
const EDGE = 12;                 // alpha forced to 0 within this many px of the canvas edge

const SUN_AZ = [-Math.SQRT1_2, -Math.SQRT1_2]; // xy direction TO the sun (upper-left)
const LIGHT = {
  // zs: height scale for this sun (low sun: -15% depth so the pit is not a black slab)
  high: { el: 55, sun: 1.0, amb: 0.62, bounce: 0.25, pen: 3.0, zs: 1.0, shGain: 1.55, hiRange: 0.16, hiCap: 0.7 },
  low:  { el: 16, sun: 1.0, amb: 0.33, bounce: 0.27, pen: 3.4, zs: 0.95, shGain: 1.3, hiRange: 0.8, hiCap: 0.5 },
};
const FAINT_HIGH_GAIN = 1.12;   // extra shadow gain for faint prints under the high sun
const BG_REF = [0xf1, 0xeb, 0xdf];           // page sand (#f1ebdf) the alpha is derived against
const SH_WARM = [96, 70, 46];                // AO / penumbra: warm umber (sand-bounced skylight)
const SH_CORE = [30, 46, 42];                // darkest cast-shadow core
const HILITE_RGB = [255, 248, 234];          // warm: keeps the sand hue when brightening
const A_CAP = 0.85;

// ------------------------------------------------------------------ PRNG + noise
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
// value noise in [-1,1]
function vnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return 2 * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) - 1;
}
function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, y * f, seed + o * 101); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

// ------------------------------------------------------------------ math helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const lerp = (a, b, t) => a + (b - a) * t;
// approximate SDF of a rotated ellipse (iq's k0*(k0-1)/k1)
function sdEllipse(px, py, cx, cy, rx, ry, rot = 0) {
  let x = px - cx, y = py - cy;
  if (rot) { const c = Math.cos(rot), s = Math.sin(rot); const t = c * x + s * y; y = -s * x + c * y; x = t; }
  const k0 = Math.hypot(x / rx, y / ry);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry));
  return k1 < 1e-9 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1;
}
// tapered capsule from a (radius ra) to b (radius rb)
function sdCapsule(px, py, ax, ay, bx, by, ra, rb = ra) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - (ra + (rb - ra) * h);
}
const gauss = (dx, dy, sx, sy) => Math.exp(-0.5 * ((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));

function blur(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let ks = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); ks += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += src[y * w + clamp(x + i, 0, w - 1)] * k[i + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += tmp[clamp(y + i, 0, h - 1) * w + x] * k[i + r];
    out[y * w + x] = s;
  }
  return out;
}

// ------------------------------------------------------------------ foot anatomy
// Foot-local frame in foot units: u along the foot (heel 0 -> toe tips ~0.92), v across, v>0 = MEDIAL.
// Outline follows the sand-physics bake: narrow heel, a lateral column that widens diagonally into
// the forefoot, forefoot mass sitting laterally, a gradual 1st-metatarsal ramp and a smooth arch cut.
function footParams(seed) {
  const R = mulberry32(seed);
  const j = (a) => (R() * 2 - 1) * a;
  const spread = 1 + j(0.06);
  const toeAng = -0.08 + j(0.03);
  // cu, cv, ru, rv, pressure weight  (toe row pulled back; slopes back from the big toe to the little toe)
  const toes = [
    [0.848, 0.080, 0.077, 0.056, 1.0],   // hallux: slightly oblong
    [0.851, -0.012, 0.046, 0.029, 0.66],
    [0.828, -0.076, 0.042, 0.027, 0.58],
    [0.795, -0.134, 0.038, 0.025, 0.5],
    [0.754, -0.187, 0.033, 0.023, 0.42],
  ].map(([cu, cv, ru, rv, w]) => ({
    cu: cu + j(0.004), cv: (cv - 0.03) * spread + 0.03 + j(0.003), ru: ru * (1 + j(0.04)), rv: rv * (1 + j(0.04)), w: w * (1 + j(0.08)),
  }));
  return {
    toes, toeAng,
    heel: { cu: 0.14 + j(0.004), cv: -0.022 + j(0.003), ru: 0.14, rv: 0.122 + j(0.003) },
    ballAng: -0.25 * (1 + j(0.12)),
    press: { heel: 1.0 + j(0.05), ballM: 0.95 + j(0.05), ballL: 0.78 + j(0.06), band: 0.34 + j(0.04), ramp: 0.5 + j(0.05) },
    depth: 10.5 + j(0.6),
    edgeSeed: (seed * 7 + 13) | 0,
    grainSeed: (seed * 31 + 5) | 0,
  };
}

// signed distances (foot units) + pressure in [0,1]
const VS = 1.085; // across-foot squeeze -> width/length ~0.39 incl. toes
function footSample(P, u, v) {
  v *= VS;
  const h = P.heel;
  const heel = sdEllipse(u, v, h.cu, h.cv, h.ru, h.rv);
  const band = sdCapsule(u, v, 0.2, -0.03, 0.6, -0.122, 0.098);
  const ball = sdEllipse(u, v, 0.665, -0.035, 0.112, 0.186, P.ballAng);
  const ramp = sdCapsule(u, v, 0.4, -0.012, 0.63, 0.072, 0.048, 0.056);
  let dSole = smin(smin(smin(heel, band, 0.06), ramp, 0.06), ball, 0.08);
  const archCut = sdEllipse(u, v, 0.36, 0.196, 0.22, 0.11, 0.1);
  dSole = -smin(-dSole, archCut, 0.14);

  // toes: pad + a long proximal stem, softly joined; neighbours merge a little at the base
  const ca = Math.cos(P.toeAng), sa = Math.sin(P.toeAng);
  let dToes = 1e9, toePress = 0;
  for (let ti = 0; ti < P.toes.length; ti++) {
    const t = P.toes[ti];
    const pad = sdEllipse(u, v, t.cu, t.cv, t.ru, t.rv, P.toeAng);
    const L = t.ru * (ti === 0 ? 0.8 : ti === 4 ? 1.2 : 1.75); // hallux: short neck, a ridge separates it from the ball
    const stem = sdCapsule(u, v, t.cu, t.cv, t.cu - ca * L, t.cv + sa * L, t.rv * 0.82, t.rv * 0.7);
    dToes = smin(dToes, smin(pad, stem, 0.02), 0.012);
    const g = gauss(u - (t.cu + t.ru * 0.25), v - t.cv, t.ru * 0.7, t.rv * 0.75);
    toePress = Math.max(toePress, t.w * g);
  }
  // toe sulcus: the ridge between ball and toe row is pressed a little, sits below the surface
  const dSul = sdEllipse(u, v, 0.79, -0.05, 0.05, 0.172, -0.42);

  // sole pressure
  let p = 0;
  const acc = (x) => { p = 1 - (1 - p) * (1 - clamp(x, 0, 1)); };
  const pr = P.press;
  acc(pr.heel * gauss(u - (h.cu + 0.012), v - (h.cv + 0.004), 0.095, 0.08));
  acc(pr.ballM * gauss(u - 0.685, v - 0.062, 0.078, 0.07));
  acc(pr.ballL * gauss(u - 0.63, v + 0.095, 0.085, 0.078));
  const bandAxis = sdCapsule(u, v, 0.2, -0.03, 0.6, -0.122, 0);
  acc(pr.band * Math.exp(-0.5 * (bandAxis / 0.05) ** 2));
  // 1st metatarsal: pressure climbs gradually along the shaft into the ball (no abrupt medial dip)
  const rampAxis = sdCapsule(u, v, 0.4, -0.012, 0.66, 0.072, 0);
  acc(pr.ramp * smoothstep(0.36, 0.7, u) * Math.exp(-0.5 * (rampAxis / 0.045) ** 2));
  const archLift = smoothstep(-0.05, 0.12, v) * Math.exp(-0.5 * ((u - 0.4) / 0.12) ** 2);
  p *= 1 - 0.5 * archLift;
  const pSole = 0.24 + 0.76 * p;
  const pToe = 0.7 * (0.26 + 0.74 * toePress);
  const pSul = 0.17;

  // soft region weights (softmin over the three SDFs) -> smooth joins between regions
  const tau = 0.01;
  const m0 = Math.min(dSole, dToes, dSul);
  const ws = Math.exp(-(dSole - m0) / tau), wt = Math.exp(-(dToes - m0) / tau), wu = Math.exp(-(dSul - m0) / tau);
  const pr2 = (pSole * ws + pToe * wt + pSul * wu) / (ws + wt + wu);
  const d = smin(dSole, smin(dToes, dSul, 0.012), 0.02);
  return { d, dSole, dToes, dSul, p: pr2 };
}

function centreOffset(P) {
  let minu = 1e9, maxu = -1e9, minv = 1e9, maxv = -1e9;
  for (let v = -0.35; v <= 0.35; v += 0.0015) for (let u = -0.1; u <= 1.1; u += 0.0015) {
    if (footSample(P, u, v).d < 0) { minu = Math.min(minu, u); maxu = Math.max(maxu, u); minv = Math.min(minv, v); maxv = Math.max(maxv, v); }
  }
  return { ou: (minu + maxu) / 2, ov: (minv + maxv) / 2, len: maxu - minu, wid: maxv - minv };
}

// Build deep + faint heightmaps at SS resolution (heights in 1x px units, z up).
function buildHeights(side, seed) {
  const P = footParams(seed);
  const C = centreOffset(P);
  const Lpx = FOOT_LEN / C.len;           // px per foot unit
  const N = W2 * H2;
  const D = P.depth;
  const es = (mulberry32(P.edgeSeed)() * 1e6) | 0;
  const dist = new Float32Array(N), pres = new Float32Array(N), U = new Float32Array(N), V = new Float32Array(N);
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
    const px = (i + 0.5) / SS, py = (j + 0.5) / SS;
    const u = (px - W / 2) / Lpx + C.ou;
    const sy = (py - H / 2) / Lpx;
    // LEFT foot sits on the upper side of the trail, medial (big toe) edge DOWN (+y)
    const v = (side === 'left' ? sy : -sy) + C.ov;
    const s = footSample(P, u, v);
    const k = j * W2 + i;
    // crumbly lip: the edge of a print in dry sand is never a vector-perfect curve
    const xs = u * Lpx, ms = v * Lpx;
    dist[k] = s.d * Lpx + 0.95 * fbm(xs / 6.5, ms / 6.5, es + 3, 2) + 0.25 * vnoise(xs / 2.5, ms / 2.5, es + 4);
    pres[k] = s.p; U[k] = u; V[k] = v;
  }
  const presS = blur(pres, W2, H2, 2.6 * SS); // soft joins between heel/ball/sulcus/toes
  const pit = new Float32Array(N), rim = new Float32Array(N), env = new Float32Array(N);
  const pk = (a, b) => { const dm = a * Math.log(1 + b / a); return (1 - Math.exp(-dm / a)) * Math.exp(-dm / b); };
  for (let k = 0; k < N; k++) {
    const u = U[k], v = V[k], d = dist[k], p = presS[k];
    const xs = u * Lpx, ms = v * Lpx;
    // walls: steep break at the lip rounding into the floor; width varies (slumped lateral + heel
    // walls are wider, the medial wall under the arch/ball is crisper) plus low-frequency noise
    const lat = smoothstep(-0.04, -0.15, v), heelZ = smoothstep(0.22, 0.06, u), med = smoothstep(0.03, 0.13, v);
    const wn = 1 + 0.28 * fbm(xs / 38, ms / 38, es + 9, 2);
    const Wwall = (6.0 + 3.0 * smoothstep(0.5, 1, p)) * wn * (1 + 0.2 * lat + 0.18 * heelZ - 0.15 * med);
    const t = clamp(-d / Wwall, 0, 1);
    const wall = 1 - Math.pow(1 - t, 2.1);
    const floorN = 1 + 0.045 * fbm(xs / 20, ms / 20, es + 7, 3);
    pit[k] = -D * p * wall * floorN;
    // displaced-sand ridge outside the edge
    if (d > -2) {
      const dd = Math.max(d, 0);
      // push-off: sand thrown forward, mostly off the big toe; heel strike: a short, compact ridge
      // behind the heel, a touch lateral; lateral roll shoves sand outward; the arch pushes little
      const front = smoothstep(0.8, 0.97, u) * (0.55 + 0.45 * smoothstep(-0.12, 0.1, v));
      const heelBack = smoothstep(0.07, -0.02, u) * (0.6 + 0.4 * smoothstep(0.02, -0.1, v));
      const lateral = smoothstep(-0.08, -0.17, v) * smoothstep(0.1, 0.35, u);
      const arch = gauss(u - 0.4, v - 0.19, 0.12, 0.08);
      const toeGap = gauss(u - 0.83, v + 0.05, 0.04, 0.14) * smoothstep(8, 1, dd);
      let amp = 0.07 + 0.12 * lateral + 0.16 * front + 0.1 * heelBack;
      amp *= (1 - 0.7 * arch) * (1 - 0.75 * toeGap);
      const lump = 1 + (0.3 - 0.12 * front) * fbm(xs / 22, ms / 22, es, 2);
      const b = 6 + 6 * front + 2 * lateral - 1.5 * heelBack; // outward decay length
      const a = 2.2 - 0.6 * heelBack;                          // rise length at the lip
      const prof = (1 - Math.exp(-dd / a)) * Math.exp(-dd / b);
      rim[k] = D * amp * lump * (prof / pk(a, b)) * smoothstep(58, 30, dd);
    }
    env[k] = d < 0 ? 1 : Math.exp(-d / 12) * smoothstep(52, 22, d);
  }
  // grain: in-pit texture (two scales, after the traced-brand-art bake), sparse crumbs outside,
  // almost none ahead of the toes
  const grain = new Float32Array(N);
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
    const k = j * W2 + i;
    if (env[k] <= 0) continue;
    const px = (i + 0.5) / SS, py = (j + 0.5) / SS;
    const g = 0.6 * vnoise(px / 0.9, py / 0.9, P.grainSeed) + 0.4 * vnoise(px / 2.2, py / 2.2, P.grainSeed + 3);
    const inside = smoothstep(1, -3, dist[k]);
    const ahead = smoothstep(0.78, 0.94, U[k]);
    grain[k] = g * env[k] * (inside * 1.0 + (1 - inside) * 0.16 * (1 - 0.92 * ahead));
  }
  const deep = new Float32Array(N), faint = new Float32Array(N);
  const albDeep = new Float32Array(N), albFaint = new Float32Array(N);
  const pitS = blur(pit, W2, H2, 0.6 * SS), rimS = blur(rim, W2, H2, 0.9 * SS);
  for (let k = 0; k < N; k++) {
    deep[k] = pitS[k] + rimS[k] + 0.042 * grain[k];
    // compaction: pressed sand is a touch darker
    albDeep[k] = 1 - 0.045 * smoothstep(0, -6, dist[k]);
  }
  // faint: wind has drifted sand in — shallower, softened walls, low rim, uneven infill
  const pitF = blur(pit, W2, H2, 2.6 * SS), rimF = blur(rim, W2, H2, 4.5 * SS);
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
    const k = j * W2 + i;
    const px = (i + 0.5) / SS, py = (j + 0.5) / SS;
    const infill = 0.5 + 0.5 * fbm(px / 22, py / 22, P.grainSeed + 91, 3);
    const c = D * (0.28 - 0.06 * infill);
    const dpt = -pitF[k] * 0.6;
    faint[k] = -c * (1 - Math.exp(-dpt / c)) + rimF[k] * 0.22 + 0.026 * grain[k];
    albFaint[k] = 1 - 0.015 * smoothstep(4, -10, dist[k]);
  }
  return { deep, faint, albDeep, albFaint, C };
}

// ------------------------------------------------------------------ lighting
function lightRatio(h0in, w, hgt, L, alb) {
  const N = w * hgt;
  const h = new Float32Array(N); for (let k = 0; k < N; k++) h[k] = h0in[k] * L.zs;
  const el = (L.el * Math.PI) / 180, pen = (L.pen * Math.PI) / 180;
  const sx = Math.cos(el) * SUN_AZ[0], sy = Math.cos(el) * SUN_AZ[1], sz = Math.sin(el);
  const inv = 1 / SS;
  let maxH = -1e9; for (let k = 0; k < N; k++) if (h[k] > maxH) maxH = h[k];
  const at = (x, y) => h[clamp(y, 0, hgt - 1) * w + clamp(x, 0, w - 1)];
  // ambient occlusion: horizon-based, 8 directions, cos^2 sky visibility
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const steps = [1, 2, 3, 4, 6, 8, 11, 15, 20, 26, 34, 44, 56, 70];
  const ao = new Float32Array(N);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const h0 = h[y * w + x];
    let vis = 0;
    for (const [dx, dy] of dirs) {
      const len = Math.hypot(dx, dy) * inv;
      let smax = 0;
      for (const s of steps) {
        const sl = (at(x + dx * s, y + dy * s) - h0) / (s * len);
        if (sl > smax) smax = sl;
      }
      vis += 1 / (1 + smax * smax);
    }
    ao[y * w + x] = vis / 8;
  }
  // cast shadows: march toward the sun, soft penumbra from the sun-disc/scatter angle
  const tanLo = Math.tan(Math.max(el - pen, 0.01));
  const stepLen = Math.SQRT2 * inv;
  const sh = new Float32Array(N);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const h0 = h[y * w + x];
    let smax = -1e9;
    for (let s = 1; s < 4000; s++) {
      const t = s * stepLen;
      if (h0 + t * tanLo > maxH) break;
      const xx = x - s, yy = y - s;
      if (xx < 0 || yy < 0) break;
      const sl = (at(xx, yy) - h0) / t;
      if (sl > smax) smax = sl;
    }
    const ang = Math.atan(Math.max(smax, -10));
    sh[y * w + x] = smoothstep(-pen, pen, el - ang);
  }
  const flat = L.sun * sz + L.amb;
  const direct = new Float32Array(N), skyA = new Float32Array(N);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * inv);
    const gy = (at(x, y + 1) - at(x, y - 1)) / (2 * inv);
    const nl = Math.hypot(gx, gy, 1);
    const nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
    const ndl = Math.max(0, nx * sx + ny * sy + nz * sz);
    direct[k] = L.sun * ndl * sh[k];
    skyA[k] = L.amb * ao[k] * (0.6 + 0.4 * nz);
  }
  // one-bounce GI: sunlit sand nearby re-lights the concave, shadowed parts of the pit (warm fill)
  const near = blur(direct, w, hgt, 7 * SS);
  const out = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const bounce = L.bounce * near[k] * (1 - ao[k]) + 0.5 * L.bounce * near[k] * (1 - sh[k]) * 0.25;
    out[k] = alb[k] * (direct[k] + skyA[k] + bounce) / flat;
  }
  return out;
}

function downsample(r, w, h, f) {
  const ow = w / f, oh = h / f, out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += r[(y * f + j) * w + x * f + i];
    out[y * ow + x] = s / (f * f);
  }
  return out;
}

// ratio -> RGBA. Flat sand (ratio 1) -> alpha 0.
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const BL = lum(BG_REF);
const shadeColour = (a) => {
  const t = smoothstep(0.14, 0.64, a);
  return [lerp(SH_WARM[0], SH_CORE[0], t), lerp(SH_WARM[1], SH_CORE[1], t), lerp(SH_WARM[2], SH_CORE[2], t)];
};
function encode(r, w, h, L, gain = 1, cap = A_CAP) {
  const buf = Buffer.alloc(w * h * 4);
  const capH = cap * L.hiCap;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    const v = e < EDGE ? 1 : 1 + (r[k] - 1) * smoothstep(EDGE, EDGE * 2, e);
    let a = 0, c = HILITE_RGB;
    if (v < 1) {
      // shadow colour depends on alpha: warm umber in AO/penumbra, cool-dark in the core.
      // Solve alpha for the target luminance drop with that colour (fixed-point, converges fast).
      const drop = (1 - v) * BL * L.shGain * gain;
      let aa = drop / (BL - lum(SH_CORE));
      for (let it = 0; it < 4; it++) { c = shadeColour(aa); aa = drop / (BL - lum(c)); }
      a = cap * (1 - Math.exp(-aa / cap));
      c = shadeColour(a);
    } else {
      a = capH * (1 - Math.exp(-(v - 1) / L.hiRange));
    }
    if (a < 0.008) a = 0;
    const o = k * 4;
    buf[o] = Math.round(c[0]); buf[o + 1] = Math.round(c[1]); buf[o + 2] = Math.round(c[2]);
    buf[o + 3] = Math.round(a * 255);
  }
  return buf;
}

const WEBP = { quality: Number(process.env.Q ?? 70), alphaQuality: Number(process.env.AQ ?? 73), effort: 6, smartSubsample: true };

// ------------------------------------------------------------------ sprites
async function bakeSprites() {
  const seeds = { left: [1103, 2207], right: [3301, 4409] };
  const report = [];
  let total = 0;
  for (const side of ['left', 'right']) {
    for (let vi = 0; vi < 2; vi++) {
      const { deep, faint, albDeep, albFaint, C } = buildHeights(side, seeds[side][vi]);
      const line = [`${side}-${vi + 1}: len ${C.len.toFixed(3)} wid ${C.wid.toFixed(3)} w/l ${(C.wid / C.len).toFixed(3)}`];
      for (const [kind, hm, alb] of [['deep', deep, albDeep], ['faint', faint, albFaint]]) {
        for (const sun of ['high', 'low']) {
          const r2 = lightRatio(hm, W2, H2, LIGHT[sun], alb);
          const r1 = downsample(r2, W2, H2, SS);
          const gain = kind === 'faint' && sun === 'high' ? FAINT_HIGH_GAIN : 1;
          const buf = encode(r1, W, H, LIGHT[sun], gain);
          const file = path.join(OUT, `print-${side}-${kind}-${sun}-${vi + 1}.webp`);
          await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).webp(WEBP).toFile(file);
          const sz = fs.statSync(file).size; total += sz;
          // stats: 99.5th percentile of shadow alpha / highlight alpha
          const sa = [], ha = [];
          for (let k = 0; k < W * H; k++) { const A = buf[k * 4 + 3]; if (!A) continue; (buf[k * 4] > 200 ? ha : sa).push(A); }
          const pc = (arr) => { arr.sort((a, b) => a - b); return arr.length ? (arr[Math.floor(arr.length * 0.995)] / 255).toFixed(2) : '0'; };
          line.push(`${kind}-${sun} ${(sz / 1024).toFixed(1)}KB sh${pc(sa)} hi${pc(ha)}`);
        }
      }
      report.push(line.join(' | '));
    }
  }
  console.log(report.join('\n'));
  console.log(`TOTAL ${(total / 1024).toFixed(1)} KB`);
}

// ------------------------------------------------------------------ contact sheets (live layout)
const BG = { r: 0xf1, g: 0xeb, b: 0xdf, alpha: 1 };
async function layer(file, pw, ph, angle, opacity, cx, cy) {
  const { data, info } = await sharp(path.join(OUT, file)).resize(pw, ph, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (opacity < 1) for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  const { data: rot, info: ri } = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  return { input: rot, left: Math.round(cx - ri.width / 2), top: Math.round(cy - ri.height / 2) };
}
// one trail in trail-local coords: along (+ = walking), across (- = left side). Returns print list.
function trailPrints(nSteps, PL, fade) {
  const out = [];
  const st = 0.36 * PL;
  out.push({ side: 'left', a: 0, c: -st, v: 1, mix: [['deep', 1]] });
  out.push({ side: 'right', a: 0, c: st, v: 2, mix: [['deep', 1]] });
  for (let s = 1; s <= nSteps; s++) {
    const side = s % 2 ? 'left' : 'right';
    out.push({ side, a: s * 2.2 * PL, c: (side === 'left' ? -1 : 1) * 0.29 * PL, v: ((s + 1) >> 1) % 2 + 1, mix: fade ? fade[s - 1] : [['deep', 1]] });
  }
  return out;
}
const FADE_DESKTOP = [[['deep', 1]], [['deep', 1]], [['deep', 1]], [['deep', 0.85], ['faint', 0.3]], [['deep', 0.17], ['faint', 0.83]], [['faint', 0.25]]];
const FADE_MOBILE = [[['deep', 1]], [['deep', 1]], [['deep', 0.85], ['faint', 0.3]], [['deep', 0.17], ['faint', 0.83]]];
function label(text, x, y, size = 11) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${size + 6}"><text x="0" y="${size}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" letter-spacing="1.5" fill="#16443f" fill-opacity="0.45">${text}</text></svg>`;
  return { input: Buffer.from(svg), left: x, top: y };
}
async function contactSheets() {
  // desktop 1440x640: top half high sun, bottom half low sun; prints ~95px (sprite 152x76)
  {
    const layers = [];
    const PL = 95, pw = 152, ph = 76;
    for (const [sun, y0] of [['high', 0], ['low', 320]]) {
      layers.push(label(sun === 'high' ? 'HIGH SUN 55°' : 'LOW SUN 16°', 16, y0 + 10));
      for (const [ty, tx, fade] of [[y0 + 100, 80, null], [y0 + 225, 120, FADE_DESKTOP]]) {
        for (const p of trailPrints(6, PL, fade)) {
          const ang = p.side === 'left' ? -7 : 7;
          for (const [kind, op] of p.mix) layers.push(await layer(`print-${p.side}-${kind}-${sun}-${p.v}.webp`, pw, ph, ang, op, tx + p.a, ty + p.c));
        }
      }
    }
    await sharp({ create: { width: 1440, height: 640, channels: 4, background: BG } }).composite(layers).png().toFile(path.join(SHEETS, 'contact-desktop.png'));
  }
  // mobile 390x700, low sun: trails walk DOWN (sprites +90deg), prints ~55px, two trails ~170px apart
  {
    const layers = [];
    const PL = 55, pw = 88, ph = 44;
    for (const [tx, ty, fade] of [[110, 80, null], [280, 110, FADE_MOBILE]]) {
      for (const p of trailPrints(4, PL, fade)) {
        const ang = 90 + (p.side === 'left' ? -7 : 7);
        for (const [kind, op] of p.mix) layers.push(await layer(`print-${p.side}-${kind}-low-${p.v}.webp`, pw, ph, ang, op, tx - p.c, ty + p.a));
      }
    }
    await sharp({ create: { width: 390, height: 700, channels: 4, background: BG } }).composite(layers).png().toFile(path.join(SHEETS, 'contact-mobile.png'));
  }
  // closeup 960x480 at 1:1, low sun
  {
    const layers = [
      { input: path.join(OUT, 'print-left-deep-low-1.webp'), left: 0, top: 120 },
      { input: path.join(OUT, 'print-right-faint-low-1.webp'), left: 480, top: 120 },
    ];
    await sharp({ create: { width: 960, height: 480, channels: 4, background: BG } }).composite(layers).png().toFile(path.join(SHEETS, 'contact-closeup.png'));
  }
}

const t0 = Date.now();
const only = process.argv[2];
fs.mkdirSync(OUT, {recursive: true});
if (only === 'sheets' || only === 'debug') fs.mkdirSync(SHEETS, {recursive: true});
if (only === 'debug') {
  const { deep, faint } = buildHeights('left', 1103);
  for (const [n, hm] of [['deep', deep], ['faint', faint]]) {
    const b = Buffer.alloc(W2 * H2);
    for (let k = 0; k < b.length; k++) b[k] = clamp(Math.round(128 + hm[k] * 9), 0, 255);
    await sharp(b, { raw: { width: W2, height: H2, channels: 1 } }).png().toFile(path.join(SHEETS, `_debug-height-${n}.png`));
  }
}
if (!only || only === 'sprites') await bakeSprites();
if (only === 'sheets') await contactSheets();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
