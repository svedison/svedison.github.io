// Shared noise: GLSL chunks for shaders + deterministic JS value noise for heightfields and baked textures.
// No allocation in the JS hot paths (pure functions on numbers).

/** GLSL: hash12, hash22, vnoise (value, 0..1), gnoise (gradient, ~0..1), fbm(vec2,int), ridged(vec2,int). */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 x){
  vec2 i = floor(x), f = fract(x); vec2 u = f*f*(3.0-2.0*f);
  float a = hash12(i), b = hash12(i+vec2(1.0,0.0)), c = hash12(i+vec2(0.0,1.0)), d = hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float gnoise(vec2 x){
  vec2 p = floor(x), w = fract(x); vec2 u = w*w*w*(w*(w*6.0-15.0)+10.0);
  float a = dot(hash22(p)*2.0-1.0, w);
  float b = dot(hash22(p+vec2(1.0,0.0))*2.0-1.0, w-vec2(1.0,0.0));
  float c = dot(hash22(p+vec2(0.0,1.0))*2.0-1.0, w-vec2(0.0,1.0));
  float d = dot(hash22(p+vec2(1.0,1.0))*2.0-1.0, w-vec2(1.0,1.0));
  return 0.5 + 0.7*mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p, int oct){ float s=0.0, a=0.5, n=0.0; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*vnoise(p); n+=a; p=p*2.03+11.7; a*=0.5; } return s/n; }
float ridged(vec2 p, int oct){ float s=0.0, a=0.5, n=0.0; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*(1.0-abs(gnoise(p)*2.0-1.0)); n+=a; p=p*2.11+5.3; a*=0.5; } return s/n; }
`;

/** Deterministic PRNG (mulberry32). Returns a function producing 0..1. */
export function makeRng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash to 0..1. */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise, 0..1. */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise, 0..1. */
export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let s = 0;
  let amp = 0.5;
  let n = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * valueNoise2(x, y, seed + i * 17);
    n += amp;
    x = x * 2.03 + 11.7;
    y = y * 2.03 + 3.1;
    amp *= 0.5;
  }
  return s / n;
}

/** Domain-warped fbm for natural heightfields (bluffs, hills), 0..1. */
export function warpedFbm2(x: number, y: number, octaves = 5, warp = 0.6, seed = 0): number {
  const qx = fbm2(x + 1.7, y + 9.2, 3, seed + 101);
  const qy = fbm2(x + 8.3, y + 2.8, 3, seed + 202);
  return fbm2(x + warp * (qx - 0.5) * 4, y + warp * (qy - 0.5) * 4, octaves, seed);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
