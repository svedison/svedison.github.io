// The Loop: the Pacific rim as an ink-wash relief map on paper.
// One displaced plane, one shader. Land is a baked mask (sharp, for the brushed coastline) plus two blurred
// fields (soft relief + sea contour lines), all baked once on the CPU from the coastline data in geo.ts.
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from '../../systems/noise';
import { COLUMBIA, ISLETS, POLYGONS, TEX_LAT, TEX_LON, YANGTZE, project, texBounds, type LatLon } from './geo';

type THREE = typeof THREE_NS;

export interface SharedUniforms {
  uFogColor: { value: THREE_NS.Color };
  uFogDensity: { value: number };
  uTime: { value: number };
  /** 0..1: the loop has closed; the paper warms. */
  uWarm: { value: number };
}

export interface MapLayer {
  mesh: THREE_NS.Mesh;
  /** Station paper washes: index 0..2, strength 0..1. */
  setWash(i: number, v: number): void;
  setDetail(hi: boolean): void;
  dispose(): void;
}

function mercLat(lat: number) {
  const p = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + p / 2));
}

/** Chaikin corner-cutting on a closed lat/lon ring: the hand-simplified coast reads as a brushed curve, not as
 * stair-stepped segments, at any zoom. */
function chaikin(ring: LatLon[], iterations: number): LatLon[] {
  let pts = ring;
  for (let k = 0; k < iterations; k++) {
    const out: LatLon[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}
let smoothPolys: LatLon[][] | null = null;

/** Draws every coastline into a 2D context sized w × h (north up). */
function drawLand(g: CanvasRenderingContext2D, w: number, h: number, river: boolean) {
  const mN = mercLat(TEX_LAT[1]);
  const mS = mercLat(TEX_LAT[0]);
  const px = (lon: number) => ((lon - TEX_LON[0]) / (TEX_LON[1] - TEX_LON[0])) * w;
  const py = (lat: number) => ((mN - mercLat(Math.max(-60, Math.min(84, lat)))) / (mN - mS)) * h;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#f00';
  smoothPolys ??= POLYGONS.map((p) => chaikin(p, 2));
  for (const poly of smoothPolys) {
    g.beginPath();
    poly.forEach(([lat, lon], i) => (i ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
    g.closePath();
    g.fill();
  }
  for (const [lat, lon, len] of ISLETS) {
    g.beginPath();
    const rx = Math.max(1.2, (len / (TEX_LON[1] - TEX_LON[0])) * w * 0.5);
    g.ellipse(px(lon), py(lat), rx, rx * 0.45, -0.25, 0, Math.PI * 2);
    g.fill();
  }
  if (river) {
    g.strokeStyle = '#00f';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    const line = (pts: LatLon[], wpx: number) => {
      g.lineWidth = wpx;
      g.beginPath();
      pts.forEach(([lat, lon], i) => (i ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
      g.stroke();
    };
    line(YANGTZE, Math.max(1.5, w / 900));
    line(COLUMBIA, Math.max(1, w / 1400));
    g.globalCompositeOperation = 'source-over';
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let a = src.slice();
  let b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** Sharp mask: R = land, pre-blurred so its 0.5 iso-line is smooth (never stair-stepped); B = rivers.
 * Fast path: the browser's own (GPU) canvas blur, no per-pixel JS, so the module is ready quickly.
 * Fallback (no ctx.filter, e.g. older Safari): the CPU box blur at a lower resolution. */
function bakeMask(THREE: THREE, hi: boolean): THREE_NS.Texture {
  const W = hi ? 2048 : 1600;
  const H = Math.round(W * 0.62);
  const sharp = document.createElement('canvas');
  sharp.width = W;
  sharp.height = H;
  const sg = sharp.getContext('2d')!;
  drawLand(sg, W, H, true);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const og = out.getContext('2d', { alpha: false });
  if (og && typeof og.filter === 'string') {
    og.fillStyle = '#000';
    og.fillRect(0, 0, W, H);
    // a ramp a few texels wide: the bilinear 0.5 iso-line stays a smooth curve, not texel-corner kinks
    og.filter = `blur(${hi ? 2.2 : 2}px)`;
    og.drawImage(sharp, 0, 0);
    og.filter = 'none';
    const tex = new THREE.CanvasTexture(out); // flipY (default) matches the map's bottom-up uv
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    sharp.width = sharp.height = 0;
    return tex;
  }
  // CPU fallback at a smaller size (the old 2048 bake was the heaviest part of this module's init).
  const w = 1280;
  const h = Math.round(w * 0.62);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cg = c.getContext('2d', { willReadFrequently: true })!;
  drawLand(cg, w, h, true);
  const img = cg.getImageData(0, 0, w, h).data;
  const landHi = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) landHi[i] = img[i * 4] / 255;
  const landSm = boxBlur(landHi, w, h, 1, 2);
  const md = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = y * w + x;
      const dst = ((h - 1 - y) * w + x) * 4;
      md[dst] = Math.round(landSm[src] * 255);
      md[dst + 2] = img[src * 4 + 2];
      md[dst + 3] = 255;
    }
  }
  const mask = new THREE.DataTexture(md, w, h, THREE.RGBAFormat);
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  mask.anisotropy = 4;
  mask.needsUpdate = true;
  return mask;
}

function bakeTextures(THREE: THREE, hi: boolean) {
  const mask = bakeMask(THREE, hi);

  // Soft fields at low resolution: R = narrow blur (coastal relief), G = wide blur (sea contours, mountain belts).
  const w = 384;
  const h = Math.round(w * 0.62);
  const s = document.createElement('canvas');
  s.width = w;
  s.height = h;
  const sg = s.getContext('2d', { willReadFrequently: true })!;
  drawLand(sg, w, h, false);
  const px = sg.getImageData(0, 0, w, h).data;
  const land = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) land[i] = px[i * 4] / 255;
  const narrow = boxBlur(land, w, h, 2, 3);
  const wide = boxBlur(land, w, h, 6, 3);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = y * w + x;
      const dst = ((h - 1 - y) * w + x) * 4; // DataTexture rows run bottom-up
      data[dst] = Math.round(narrow[src] * 255);
      data[dst + 1] = Math.round(wide[src] * 255);
      data[dst + 2] = Math.round(land[src] * 255);
      data[dst + 3] = 255;
    }
  }
  const soft = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  soft.magFilter = THREE.LinearFilter;
  soft.minFilter = THREE.LinearFilter;
  soft.wrapS = soft.wrapT = THREE.ClampToEdgeWrapping;
  soft.needsUpdate = true;
  return { mask, soft };
}

const VERT = /* glsl */ `
uniform sampler2D uSoft;
uniform vec4 uBounds; // x0, x1, zS, zN
varying vec3 vWorld;
varying vec2 vUv;
${GLSL_NOISE}
// Mountains gather in belts just inside the coast (the Pacific's ring of mountains); interiors stay quiet paper.
float relief(vec2 p, vec2 sf){
  float inland = smoothstep(0.5, 0.95, sf.x);
  float belt = smoothstep(0.5, 0.72, sf.y) * smoothstep(1.0, 0.82, sf.y);
  float massif = smoothstep(0.55, 0.78, fbm(p * 0.03 + 5.0, 3));
  float r = ridged(p * 0.11 + 3.0, 4);
  return inland * r * r * (0.08 + 0.92 * max(belt, massif * 0.8));
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 uv = vec2((wp.x - uBounds.x) / (uBounds.y - uBounds.x), (wp.z - uBounds.z) / (uBounds.w - uBounds.z));
  vec4 sf = texture2D(uSoft, clamp(uv, 0.0, 1.0));
  wp.y += relief(wp.xz, sf.rg) * 2.6;
  vWorld = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uMaskTexel;
uniform sampler2D uSoft;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uWarm;
uniform float uDetail;
uniform vec3 uLand;
uniform vec3 uSea;
uniform vec3 uSeaDeep;
uniform vec3 uInk;
uniform vec3 uGold;
uniform vec3 uWashPos[3];
uniform vec3 uWashCol[3];
uniform float uWash[3];
varying vec3 vWorld;
varying vec2 vUv;
${GLSL_NOISE}
// Mountains gather in belts just inside the coast (the Pacific's ring of mountains); interiors stay quiet paper.
float relief(vec2 p, vec2 sf){
  float inland = smoothstep(0.5, 0.95, sf.x);
  float belt = smoothstep(0.5, 0.72, sf.y) * smoothstep(1.0, 0.82, sf.y);
  float massif = smoothstep(0.55, 0.78, fbm(p * 0.03 + 5.0, 3));
  float r = ridged(p * 0.11 + 3.0, 4);
  return inland * r * r * (0.08 + 0.92 * max(belt, massif * 0.8));
}
// contour line of field f at level l, ~w px wide, anti-aliased in screen space
float isoLine(float f, float l, float w){
  float d = abs(f - l) / max(fwidth(f), 1e-5);
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, d);
}
void main(){
  vec2 p = vWorld.xz;
  vec2 uv = clamp(vUv, 0.0, 1.0);
  // Brush wobble: the coastline is drawn, not traced.
  vec2 warp = vec2(vnoise(p * 0.55) - 0.5, vnoise(p * 0.55 + 17.0) - 0.5) * 0.0016;
  // bias toward the finer mip: the coast is re-sharpened from this field (d below), so a coarse mip at grazing
  // angles would come back as stair-steps
  vec2 suv = uv + warp;
  vec4 mk = texture2D(uMask, suv, -1.25);
  vec4 sf = texture2D(uSoft, uv);
  float m = mk.r;
  // Signed distance to the coast in screen px (+ = land). fwidth(m) is constant per texel under magnification
  // (bilinear is piecewise linear), so dividing by it stair-steps the coast at texel size on a close camera.
  // Instead: a central-difference gradient of the field in uv (continuous across texels), carried to screen
  // space through the smooth uv derivatives. The tap spacing follows the pixel footprint when minified.
  vec2 duvdx = dFdx(suv);
  vec2 duvdy = dFdy(suv);
  vec2 te = max(uMaskTexel, 0.5 * (abs(duvdx) + abs(duvdy)));
  float gx = texture2D(uMask, suv + vec2(te.x, 0.0), -1.25).r - texture2D(uMask, suv - vec2(te.x, 0.0), -1.25).r;
  float gy = texture2D(uMask, suv + vec2(0.0, te.y), -1.25).r - texture2D(uMask, suv - vec2(0.0, te.y), -1.25).r;
  vec2 guv = vec2(gx / (2.0 * te.x), gy / (2.0 * te.y));
  float gpx = length(vec2(dot(guv, duvdx), dot(guv, duvdy)));
  float d = (m - 0.5) / max(gpx, 1e-4);
  float land = clamp(d + 0.5, 0.0, 1.0);
  // Beyond the charted domain the clamped texture smears into streaks: keep the wash colour there, but lift
  // the drawn detail (coast, relief, contours, rivers) so the chart simply fades out into the paper.
  vec2 ov = max(vec2(0.0), max(-vUv, vUv - 1.0));
  float chart = 1.0 - smoothstep(0.0, 0.04, max(ov.x, ov.y));

  // --- paper ---
  float fib = vnoise(p * vec2(3.1, 0.7)) * 0.5 + vnoise(p * 7.3 + 4.0) * 0.5;
  float cloudy = fbm(p * 0.05 + 7.0, 3);
  vec3 sea = mix(uSea, uSeaDeep, smoothstep(0.02, 0.0, sf.g) * (0.55 + 0.45 * cloudy));
  vec3 col = mix(sea, uLand, land);
  col *= 0.975 + 0.05 * fib;

  // --- relief as ink wash (sumi-e: shadows are laid-down washes, not grey shading) ---
  if (land > 0.0) {
    float e = 0.3;
    float h0 = relief(p, sf.rg);
    float hx = relief(p + vec2(e, 0.0), sf.rg);
    float hz = relief(p + vec2(0.0, e), sf.rg);
    vec3 n = normalize(vec3((h0 - hx) * 2.6, e, (h0 - hz) * 2.6));
    float lit = dot(n, normalize(vec3(-0.6, 0.7, -0.4)));
    float shadow = smoothstep(0.8, 0.3, lit);
    float wash = shadow * smoothstep(0.04, 0.3, h0);
    // dry-brush break-up so the washes look laid down, not computed
    wash *= 0.55 + 0.6 * vnoise(p * vec2(1.2, 2.6) + 2.0);
    // a faint jade-grey in the lowlands near the coast, plain warm paper inland
    float low = (1.0 - smoothstep(0.55, 0.9, sf.g)) * (1.0 - smoothstep(0.0, 0.2, h0));
    col = mix(col, col * vec3(0.95, 0.975, 0.95), low * 0.8);
    col = mix(col, uInk, clamp(wash * 0.42, 0.0, 0.42) * land * uDetail * chart);
    // ink bleed just inside the coast
    float bleed = (1.0 - smoothstep(0.5, 0.8, sf.r)) * land;
    col = mix(col, uInk, bleed * 0.1 * chart);
    // rivers
    // rivers; the Yangtze carries the love light once it is placed
    float riv = smoothstep(0.2, 0.7, mk.b) * land * chart;
    col = mix(col, mix(uInk, uGold, uWash[0] * 0.85), riv * mix(0.7, 0.95, uWash[0]));
  }

  // --- sea: water lines echo the coast (old woodblock charts) ---
  float sea1 = isoLine(sf.g, 0.12, 1.0) * (0.55 + 0.45 * step(0.35, vnoise(p * 0.8)));
  float sea2 = isoLine(sf.g, 0.045, 0.9) * step(0.45, vnoise(p * 0.6 + 9.0));
  col = mix(col, uInk, (sea1 * 0.16 + sea2 * 0.09) * (1.0 - land) * uDetail * chart);

  // graticule every 10°, very faint and broken
  float lonDeg = p.x / 40.0 * 57.29578 + 178.0;
  float merc = -p.y / 40.0 + 0.76291;
  float latDeg = atan(sinh(merc)) * 57.29578;
  vec2 g = vec2(lonDeg, latDeg) / 10.0;
  vec2 gd = abs(fract(g + 0.5) - 0.5) / max(fwidth(g), vec2(1e-5));
  float grid = (1.0 - smoothstep(0.4, 1.4, min(gd.x, gd.y))) * step(0.5, fract((p.x + p.y) * 0.7));
  col = mix(col, uInk, grid * 0.05 * (1.0 - land * 0.6));

  // --- the brushed coastline ---
  // width swells and thins like a loaded brush (1.2–3.4 px), with rare dry-brush breaks
  float w = 0.9 + 1.2 * vnoise(p * 0.22 + 3.0) + 0.6 * vnoise(p * 0.9);
  float dry = smoothstep(0.1, 0.24, vnoise(p * vec2(1.4, 2.2)));
  float coast = (1.0 - smoothstep(w - 0.9, w + 0.9, abs(d - w * 0.4))) * (0.5 + 0.5 * dry);
  col = mix(col, uInk, coast * 0.92 * chart);

  // --- station washes: colour bleeds into the paper where a light is placed ---
  for (int i = 0; i < 3; i++) {
    float r = length(p - uWashPos[i].xz);
    float edge = uWashPos[i].y * (0.85 + 0.3 * vnoise(p * 0.7 + float(i) * 13.0));
    float stain = smoothstep(edge, edge * 0.35, r);
    float rim = smoothstep(edge * 0.75, edge * 0.97, r) * stain; // pigment gathers at the edge of a wash
    col = mix(col, col * uWashCol[i], (stain * 0.35 + rim * 0.45) * uWash[i]);
  }

  // the loop has closed: the paper warms a little
  col = mix(col, col * vec3(1.03, 1.0, 0.94), uWarm);

  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  // high haze over the far north and the chart's side edges, so the sheet never shows an edge
  float haze = max(smoothstep(0.8, 1.0, vUv.y), max(smoothstep(0.08, -0.02, vUv.x), smoothstep(0.92, 1.02, vUv.x)));
  fog = max(fog, haze * 0.92);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createMap(THREE: THREE, shared: SharedUniforms, opts: { hi: boolean }): MapLayer {
  const { mask, soft } = bakeTextures(THREE, opts.hi);
  const img = mask.image as { width: number; height: number };
  const maskW = img.width || 1600;
  const maskH = img.height || 992;
  const b = texBounds();
  // The plane is larger than the texture domain so the sea runs out under the fog, never to an edge.
  const W = 300;
  const D = 190;
  const geo = new THREE.PlaneGeometry(W, D, opts.hi ? 300 : 160, opts.hi ? 190 : 100);
  geo.rotateX(-Math.PI / 2);
  geo.translate(6, 0, -4);
  const washPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const washCol = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMask: { value: mask },
      uMaskTexel: { value: new THREE.Vector2(1 / maskW, 1 / maskH) },
      uSoft: { value: soft },
      uBounds: { value: new THREE.Vector4(b.x0, b.x1, b.zS, b.zN) },
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uWarm: shared.uWarm,
      uDetail: { value: 1 },
      uLand: { value: new THREE.Color('#efe4cc') },
      uSea: { value: new THREE.Color('#e9e6dd') },
      uSeaDeep: { value: new THREE.Color('#d9ddd5') },
      uInk: { value: new THREE.Color('#1c1b19') },
      uGold: { value: new THREE.Color('#e0952a') },
      uWashPos: { value: washPos },
      uWashCol: { value: washCol },
      uWash: { value: [0, 0, 0] },
    },
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  return {
    mesh,
    setWash(i, v) {
      (mat.uniforms.uWash.value as number[])[i] = v;
    },
    setDetail(hi) {
      mat.uniforms.uDetail.value = hi ? 1 : 0.6;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mask.dispose();
      soft.dispose();
    },
  };
}

/** Exposes the wash uniforms so the module can place them at station positions. */
export function setWashStation(layer: MapLayer, i: number, x: number, z: number, radius: number, color: THREE_NS.Color) {
  const u = (layer.mesh.material as THREE_NS.ShaderMaterial).uniforms;
  (u.uWashPos.value as THREE_NS.Vector3[])[i].set(x, radius, z);
  (u.uWashCol.value as THREE_NS.Color[])[i].copy(color);
}

export { project };
