// The room: plaster wall with a long mullioned window (rain running down the glass, the city out of focus
// behind it), one long oiled walnut shelf on iron brackets, the warm key's light shafts and the dust in them.
// Lighting follows 3d-wood-lighting-scorecard: one warm key, low cool fill, a rim from the window, low hemi.
import * as THREE from 'three';
import { fbm2 } from '../../systems/noise';
import { chamferBox, F0, mergeStatic, metalMat, SPECIES, woodMat } from './materials';

export const SHELF_Y = 1.0; // top surface of the shelf
export const WALL_Z = -0.2; // front face of the back wall
export const SPACING = 0.45; // between artifacts
export const ART_Z = -0.035;
export const SHELF_X0 = -1.7;
export const SHELF_X1 = 4.6;
const WIN = { x0: -0.45, x1: 4.75, y0: 1.26, y1: 2.32 };
/** Direction the key light travels (from a lamp up and to the left, in front of the shelf). */
export const KEY_DIR = new THREE.Vector3(0.5, -0.74, -0.45).normalize();

export interface Room {
  group: THREE.Group;
  key: THREE.DirectionalLight;
  lights: THREE.Light[];
  windowMat: THREE.ShaderMaterial;
  shafts: THREE.Mesh;
  dust: THREE.Points;
  setTier(tier: 'high' | 'medium' | 'low'): void;
  update(time: number): void;
  dispose(): void;
}

function plasterTexture(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // periodic by sampling a torus-like wrap: blend the four quadrant samples
      const u = x / N,
        v = y / N;
      const s = (px: number, py: number) => fbm2(px * 6, py * 6, 5, 3) * 0.7 + fbm2(px * 26, py * 26, 3, 9) * 0.3;
      const a = s(u, v) * (1 - u) * (1 - v) + s(u - 1, v) * u * (1 - v) + s(u, v - 1) * (1 - u) * v + s(u - 1, v - 1) * u * v;
      const val = Math.max(0, Math.min(255, Math.round(128 + (a - 0.5) * 210)));
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildRoom(field: THREE.Texture, env: THREE.Texture, tier: 'high' | 'medium' | 'low', isMobile: boolean): Room {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- wall: four slabs round the window opening, so the reveal has real depth ---- */
  const plaster = plasterTexture();
  plaster.repeat.set(0.7, 0.7);
  disposables.push(plaster);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.93, roughnessMap: plaster, bumpMap: plaster, bumpScale: 0.6 });
  wallMat.onBeforeCompile = (sh) => {
    // plaster mottling in the albedo from the same map (kept subtle), world-projected so slabs agree
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec2 wq = (abs(vWN.z) > 0.5 ? vWP.xy : (abs(vWN.x) > 0.5 ? vWP.zy : vWP.xz)) * 0.7;
         float mott = texture2D(roughnessMap, wq).g;
         diffuseColor.rgb *= 0.78 + 0.44 * mott;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * (0.9 + 0.1 * texture2D(roughnessMap, wq * 3.0).g);');
  };
  // world-projected bump: UVs from world xy
  const slab = (x0: number, x1: number, y0: number, y1: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.12);
    const P = g.attributes.position as THREE.BufferAttribute;
    const N = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    for (let i = 0; i < P.count; i++) {
      const wx = P.getX(i) + cx,
        wy = P.getY(i) + cy,
        wz = P.getZ(i);
      if (Math.abs(N.getZ(i)) > 0.5) uv.setXY(i, wx, wy);
      else if (Math.abs(N.getX(i)) > 0.5) uv.setXY(i, wz, wy);
      else uv.setXY(i, wx, wz);
    }
    const m = new THREE.Mesh(g, wallMat);
    m.position.set(cx, cy, WALL_Z - 0.06);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  };
  slab(-4, 8, -1, WIN.y0);
  slab(-4, 8, WIN.y1, 4);
  slab(-4, WIN.x0, WIN.y0, WIN.y1);
  slab(WIN.x1, 8, WIN.y0, WIN.y1);

  /* ---- window: painted frame, mullions, a wooden sill, and the rainy glass ---- */
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.6 });
  const fr = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(chamferBox(w, h, d, 0.004), frameMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  const GZ = WALL_Z - 0.085;
  const wW = WIN.x1 - WIN.x0,
    wH = WIN.y1 - WIN.y0;
  fr(wW, 0.05, 0.05, (WIN.x0 + WIN.x1) / 2, WIN.y1 - 0.025, GZ + 0.01);
  fr(wW, 0.045, 0.05, (WIN.x0 + WIN.x1) / 2, WIN.y0 + 0.0225, GZ + 0.01);
  const panes = 6;
  for (let i = 0; i <= panes; i++) fr(0.045, wH, 0.05, WIN.x0 + (i / panes) * wW + (i === 0 ? 0.0225 : i === panes ? -0.0225 : 0), (WIN.y0 + WIN.y1) / 2, GZ + 0.01);
  for (let i = 0; i < panes; i++) fr(wW / panes, 0.022, 0.03, WIN.x0 + ((i + 0.5) / panes) * wW, WIN.y0 + wH * 0.62, GZ + 0.005);
  const sillMat = woodMat(field, env, { ...SPECIES.walnut, seed: 3, axis: 0, grain: 1.4, envMapIntensity: 0.3 });
  const sill = new THREE.Mesh(chamferBox(wW + 0.06, 0.02, 0.1), sillMat);
  sill.position.set((WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.01, WALL_Z - 0.06);
  sill.castShadow = sill.receiveShadow = true;
  group.add(sill);

  const windowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLayers: { value: tier === 'low' ? 1 : 2 },
      uSlide: { value: 1 },
      uGlassZ: { value: GZ },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLayers, uSlide, uGlassZ;
      varying vec3 vW;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

      /* the city, far out of focus: q is metres on a plane ~28 m beyond the glass; blur 0 (sharp) .. 1 (soft) */
      vec3 outside(vec2 q, float blur){
        vec3 col = mix(vec3(0.020, 0.024, 0.034), vec3(0.006, 0.008, 0.014), smoothstep(-2.0, 14.0, q.y));
        col += vec3(0.10, 0.062, 0.036) * exp(-max(q.y + 1.0, 0.0) * 0.22) * 0.5;  /* sodium glow over the city */
        for (int i = 0; i < 3; i++){
          if (float(i) > uLayers) break;
          /* fewer, larger cells further out; each light its own size, softness, brightness and colour temperature */
          float s = 2.3 + float(i) * 1.55;
          vec2 g = q / s + vec2(float(i) * 7.31, float(i) * 3.17);
          vec2 id = floor(g);
          vec2 f = fract(g) - 0.5;
          float h = h12(id + float(i) * 13.1);
          vec2 hv = h22(id + 3.7);
          float cyq = (id.y + 0.5) * s;   /* density by the cell's own height, so no disc is cut by the threshold */
          float lit = step(mix(0.58, 0.9, smoothstep(0.0, 11.0, cyq)), h) * (1.0 - smoothstep(9.0, 15.0, cyq));
          float rad = mix(0.12, 0.36, hv.x * hv.x);
          vec2 c = (h22(id) - 0.5) * 2.0 * (0.47 - rad);           /* the whole disc stays inside its cell */
          float d = length(f - c) / rad;
          float soft = mix(0.18, 0.95, hv.y) * mix(0.55, 1.0, blur);
          /* a gaussian body cut to zero at the rim, a crisper lens edge on the sharper ones */
          float body = exp(-d * d * mix(0.6, 3.2, soft)) * (1.0 - smoothstep(1.0 - 0.3 * soft - 0.04, 1.0, d));
          body *= 1.0 + 0.22 * (1.0 - soft) * smoothstep(0.55, 0.92, d) * blur;
          float h2 = h12(id + 5.7);
          float h3 = h12(id + 9.1);
          vec3 lc = h2 < 0.55 ? mix(vec3(1.0, 0.46, 0.16), vec3(1.0, 0.7, 0.4), h3)      /* sodium .. warm white */
                  : h2 < 0.82 ? mix(vec3(1.0, 0.82, 0.62), vec3(0.62, 0.74, 1.0), h3)    /* tungsten .. LED */
                  : h2 < 0.94 ? vec3(0.95, 0.3, 0.18) : vec3(0.5, 0.85, 0.75);             /* a red sign, a green one */
          float bright = (0.04 + 0.62 * h3 * h3 * h3) * mix(1.25, 0.55, hv.x);           /* big ones are dimmer */
          float flick = 0.88 + 0.12 * sin(uTime * (0.3 + h2) + h * 30.0);
          col += lc * body * lit * bright * flick * (1.0 - 0.35 * blur) * (1.0 - 0.28 * float(i));
        }
        return col;
      }

      /* drops on the glass, p in metres on the pane. n: refraction offset, m: drop mask, tr: wet trail */
      void drops(vec2 p, out vec2 n, out float m, out float tr){
        n = vec2(0.0); m = 0.0; tr = 0.0;
        /* beaded drops, appearing and drying in place */
        for (int k = 0; k < 2; k++){
          float cs = k == 0 ? 0.014 : 0.009;
          vec2 g = p / cs + float(k) * 3.7;
          vec2 id = floor(g), f = fract(g) - 0.5;
          float h = h12(id + float(k) * 11.0);
          vec2 c = (h22(id) - 0.5) * 0.6;
          float life = fract(uTime * 0.05 * uSlide + h * 7.0);
          float r = (0.2 + 0.24 * h) * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.75, 1.0, life));
          r *= step(0.62, h);
          vec2 dv = f - c; dv.y *= 1.12;
          float d = length(dv);
          float mm = 1.0 - smoothstep(r * 0.82, r, d);
          n += dv / max(r, 1e-3) * mm;
          m = max(m, mm);
        }
        /* running drops: one per 4 cm column, stop-and-go, leaving a clear wet trail and beads */
        if (uSlide > 0.5){
          float cw = 0.04;
          float cx = floor(p.x / cw);
          float h = h12(vec2(cx, 3.3));
          if (h > 0.45){
            float sp = 0.05 + 0.08 * h;
            float ph = uTime * sp + h * 13.0;
            float cyc = floor(ph);
            float fp = fract(ph);
            float stepy = fp + 0.06 * sin(fp * 30.0 + h * 6.0);   /* stop-and-go */
            float top = ${WIN.y1.toFixed(3)} + 0.05, len = ${(WIN.y1 - WIN.y0 + 0.12).toFixed(3)};
            float y = top - stepy * len;
            float big = step(0.86, h);   /* a few long streaks that read from across the room */
            float wob = (sin(p.y * 38.0 + h * 9.0 + cyc) * 0.0035 + sin(p.y * 91.0 + h) * 0.0012) * mix(1.0, 0.45, big);
            float x = (cx + 0.3 + 0.4 * h12(vec2(cx, cyc))) * cw + wob;
            vec2 dv = vec2((p.x - x) / 0.0042, (p.y - y) / 0.0058);
            dv.y += dv.y < 0.0 ? 0.0 : -0.35 * dv.y;
            float d = length(dv);
            float mm = 1.0 - smoothstep(0.8, 1.0, d);
            n += dv * mm * 0.9;
            m = max(m, mm);
            float above = p.y - y;
            float tw = mix(0.0034, 0.0052, big);
            float trail = (1.0 - smoothstep(tw * 0.55, tw, abs(p.x - x))) * step(0.0, above) * (1.0 - smoothstep(0.0, mix(0.32, 0.9, big), above));
            tr = max(tr, trail * mix(0.75, 1.0, big));
            /* beads left in the trail */
            float by = fract(above / 0.016);
            vec2 bd = vec2((p.x - x) / 0.0018, (by - 0.5) * 0.016 / 0.0018);
            float bead = (1.0 - smoothstep(0.7, 1.0, length(bd))) * trail * step(0.3, h12(vec2(cx, floor(above / 0.016))));
            n += bd * bead * 0.6;
            m = max(m, bead);
          }
        }
      }

      void main(){
        vec2 p = vW.xy;
        vec3 V = normalize(vW - cameraPosition);
        float far = 28.0 / max(0.05, -V.z);
        vec2 q = cameraPosition.xy + V.xy * far;
        vec2 n; float m; float tr;
        drops(p, n, m, tr);
        float blur = mix(1.0, 0.25, tr);
        vec3 bg = outside(q, blur);
        /* a drop is a small lens: the city a little sharper and shifted, a darker rim, a brighter crown */
        vec3 thru = outside(q - n * 0.12, 0.45);
        vec3 col = mix(bg, thru * 1.1, m * 0.9);
        float rim = smoothstep(0.55, 1.0, length(n)) * m;
        col = col * (1.0 - rim * 0.05) + bg * smoothstep(0.2, 0.8, -n.y) * m * 0.45;
        /* lamp catch on the top edge of each drop */
        col += vec3(1.0, 0.78, 0.5) * smoothstep(0.55, 0.95, -n.y * 0.7 + n.x * -0.5) * m * 0.07;
        /* the wet streak holds a thin line of the lamp along its edges */
        col += vec3(0.06, 0.042, 0.026) * smoothstep(0.85, 1.0, tr) * (0.6 + 0.4 * smoothstep(0.2, 0.9, tr * (1.0 - tr) * 4.0));
        /* condensation haze and a faint warm reflection of the room */
        col += vec3(0.010, 0.010, 0.012) * (1.0 - m) + vec3(0.035, 0.022, 0.012) * (1.0 - smoothstep(${WIN.y0.toFixed(2)}, ${(WIN.y0 + 0.5).toFixed(2)}, p.y)) * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(wW, wH), windowMat);
  glass.position.set((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, GZ - 0.01);
  group.add(glass);

  /* ---- the shelf: oiled walnut, rounded arrises, on four iron brackets ---- */
  const shelfMat = woodMat(field, env, { ...SPECIES.walnut, seed: 1, axis: 0, grain: 1.5, ringFreq: 22, envMapIntensity: 0.3 });
  const SL = SHELF_X1 - SHELF_X0;
  const shelf = new THREE.Mesh(chamferBox(SL, 0.036, 0.3, 0.004), shelfMat);
  shelf.position.set((SHELF_X0 + SHELF_X1) / 2, SHELF_Y - 0.018, WALL_Z + 0.15);
  shelf.castShadow = shelf.receiveShadow = true;
  group.add(shelf);
  const iron = metalMat(env, F0.iron, { rough: 0.55, env: 0.5, tarnish: 0.6, tarnishCol: [0.05, 0.035, 0.025] });
  const brG1 = chamferBox(0.022, 0.2, 0.012, 0.002);
  const brG2 = chamferBox(0.022, 0.012, 0.22, 0.002);
  const brG3 = chamferBox(0.016, 0.012, 0.25, 0.002);
  for (const x of [-1.45, -0.25, 0.95, 2.15, 3.35, 4.35]) {
    const a = new THREE.Mesh(brG1, iron);
    a.position.set(x, SHELF_Y - 0.036 - 0.1, WALL_Z + 0.006);
    const b = new THREE.Mesh(brG2, iron);
    b.position.set(x, SHELF_Y - 0.042, WALL_Z + 0.11);
    const c = new THREE.Mesh(brG3, iron);
    c.position.set(x, SHELF_Y - 0.12, WALL_Z + 0.09);
    c.rotation.x = -0.72;
    for (const m of [a, b, c]) {
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // wall slabs, window frame and brackets: one draw call per material
  mergeStatic(group, new Set<THREE.Object3D>([glass, sill, shelf]));

  /* ---- lights: one warm key with the only shadow; fill, rim and hemi only keep the flanks alive ---- */
  const key = new THREE.DirectionalLight(0xffd6a0, 2.6);
  const keyTarget = new THREE.Object3D();
  keyTarget.position.set(1.45, 1.1, -0.1);
  key.target = keyTarget;
  key.position.copy(keyTarget.position).addScaledVector(KEY_DIR, -4.5);
  key.castShadow = true;
  const sm = tier === 'high' ? 2048 : 1024;
  key.shadow.mapSize.set(sm, sm);
  Object.assign(key.shadow.camera, { near: 0.5, far: 9, left: -3.5, right: 3.5, top: 1.8, bottom: -1.8 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = sm === 2048 ? 0.0035 : 0.006;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xaec7df, 0.32);
  fill.position.set(2.5, 1.6, 3.0);
  const rim = new THREE.DirectionalLight(0x9fb8d8, 0.85);
  rim.position.set(0.6, 2.2, -3.0);
  const hemi = new THREE.HemisphereLight(0xb5c5d7, 0x35281c, 0.09);
  group.add(key, keyTarget, fill, rim, hemi);
  const lights: THREE.Light[] = [key, fill, rim, hemi];

  /* ---- shafts: billboarded around the key's axis, one draw call, faded near the shelf ---- */
  const NS = 9;
  const shaftG = new THREE.BufferGeometry();
  const pos = new Float32Array(NS * 4 * 3);
  const corner = new Float32Array(NS * 4 * 2);
  const center = new Float32Array(NS * 4 * 3);
  const size = new Float32Array(NS * 4 * 3);
  const idx: number[] = [];
  for (let s = 0; s < NS; s++) {
    const ex = SHELF_X0 + 0.15 + s * 0.68 + Math.sin(s * 2.3) * 0.08;
    const end = new THREE.Vector3(ex, SHELF_Y + 0.3 + (s % 3) * 0.12, WALL_Z + 0.05);
    const len = 2.6;
    const c = end.clone().addScaledVector(KEY_DIR, -len / 2);
    const w = 0.26 + (s % 2) * 0.12;
    for (let v = 0; v < 4; v++) {
      const i = s * 4 + v;
      corner[i * 2] = v & 1 ? 1 : 0;
      corner[i * 2 + 1] = v & 2 ? 1 : 0;
      center.set([c.x, c.y, c.z], i * 3);
      size.set([w, len, s * 1.73], i * 3);
      pos.set([c.x, c.y, c.z], i * 3);
    }
    const b = s * 4;
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  shaftG.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  shaftG.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  shaftG.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  shaftG.setAttribute('aSize', new THREE.BufferAttribute(size, 3));
  shaftG.setIndex(idx);
  shaftG.boundingSphere = new THREE.Sphere(new THREE.Vector3(1.6, 1.8, 0.4), 5);
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAxis: { value: KEY_DIR.clone() }, uGain: { value: 0.22 } },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; attribute vec3 aCenter; attribute vec3 aSize;
      uniform vec3 uAxis;
      varying vec2 vC; varying vec3 vW; varying float vSeed;
      void main(){
        vec3 toCam = normalize(cameraPosition - aCenter);
        vec3 side = normalize(cross(uAxis, toCam));
        vec3 wp = aCenter + uAxis * (aCorner.y - 0.5) * aSize.y + side * (aCorner.x - 0.5) * aSize.x;
        vC = aCorner; vW = wp; vSeed = aSize.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGain;
      varying vec2 vC; varying vec3 vW; varying float vSeed;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 x){ vec2 i = floor(x), f = fract(x); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
      void main(){
        float across = clamp(abs(vC.x - 0.5) * 2.0, 0.0, 1.0);
        float prof = pow(1.0 - across, 2.2);
        float along = smoothstep(0.0, 0.45, vC.y) * (1.0 - smoothstep(0.86, 1.0, vC.y));
        float n = vn(vec2(vC.x * 3.0 + vSeed, vC.y * 5.0 - uTime * 0.05)) * 0.6 + vn(vec2(vC.x * 7.0 - vSeed, vC.y * 11.0 + uTime * 0.03)) * 0.4;
        float foot = smoothstep(${(SHELF_Y + 0.05).toFixed(2)}, ${(SHELF_Y + 0.42).toFixed(2)}, vW.y);
        float a = prof * along * (0.45 + 0.75 * n) * foot * uGain;
        gl_FragColor = vec4(vec3(1.0, 0.74, 0.44) * a, 1.0);
      }`,
  });
  const shafts = new THREE.Mesh(shaftG, shaftMat);
  shafts.frustumCulled = false;
  shafts.renderOrder = 3;
  group.add(shafts);

  /* ---- baked warm pool: where each shaft lands on the wall, plus the glow the lamp leaves along the shelf.
     One additive quad on the wall face, every tier (the shafts themselves drop out on low). ---- */
  const poolMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uGain: { value: tier === 'low' ? 1.25 : 1.0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uGain; varying vec3 vW;
      void main(){
        float x0 = ${(SHELF_X0 + 0.15).toFixed(3)};
        float k = floor((vW.x - x0) / 0.68 + 0.5);
        float a = 0.0;
        for (int j = -1; j <= 1; j++){
          float s = k + float(j);
          if (s < 0.0 || s > 8.0) continue;
          float ex = x0 + s * 0.68 + sin(s * 2.3) * 0.08 + 0.1;
          float ey = ${(SHELF_Y + 0.18).toFixed(3)} + mod(s, 3.0) * 0.06;
          vec2 d = vec2((vW.x - ex) / 0.36, (vW.y - ey) / 0.2);
          a += exp(-dot(d, d) * 1.6) * (0.75 + 0.25 * sin(s * 4.1));
        }
        /* a low glow just above the shelf and a soft fall-off under it */
        float y = vW.y - ${SHELF_Y.toFixed(3)};
        a += 0.35 * exp(-max(y, 0.0) / 0.16) * step(0.0, y);
        a *= smoothstep(${(WIN.y0 + 0.01).toFixed(3)}, ${(WIN.y0 - 0.06).toFixed(3)}, vW.y);
        a *= smoothstep(${(SHELF_X0 - 0.3).toFixed(3)}, ${(SHELF_X0 + 0.5).toFixed(3)}, vW.x) * smoothstep(${(SHELF_X1 + 0.3).toFixed(3)}, ${(SHELF_X1 - 0.5).toFixed(3)}, vW.x);
        gl_FragColor = vec4(vec3(0.20, 0.115, 0.055) * a * uGain, 1.0);
      }`,
  });
  const poolG = new THREE.PlaneGeometry(SHELF_X1 - SHELF_X0 + 0.8, WIN.y0 - SHELF_Y + 0.02);
  const wallPool = new THREE.Mesh(poolG, poolMat);
  wallPool.position.set((SHELF_X0 + SHELF_X1) / 2, (WIN.y0 + SHELF_Y) / 2 - 0.0, WALL_Z + 0.002);
  wallPool.renderOrder = 2;
  group.add(wallPool);
  disposables.push(poolMat, poolG);

  /* ---- under the shelf: the key's bounce off the walnut and the spill past its front edge, so the lower third is a
     lit wall falling into shadow (a contact band right under the board), not flat black. One additive quad. ---- */
  const underMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uGain: poolMat.uniforms.uGain },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uGain; varying vec3 vW;
      void main(){
        float y = ${(SHELF_Y - 0.036).toFixed(3)} - vW.y; /* depth below the board */
        float x0 = ${(SHELF_X0 + 0.15).toFixed(3)};
        float sx = 0.5 + 0.5 * sin((vW.x - x0) / 0.68 * 6.2832 + 0.6);
        float a = smoothstep(0.015, 0.11, y) * exp(-y / 0.3) * (0.8 + 0.2 * sx);
        a *= smoothstep(${(SHELF_X0 - 0.3).toFixed(3)}, ${(SHELF_X0 + 0.5).toFixed(3)}, vW.x) * smoothstep(${(SHELF_X1 + 0.3).toFixed(3)}, ${(SHELF_X1 - 0.5).toFixed(3)}, vW.x);
        gl_FragColor = vec4(vec3(0.125, 0.07, 0.034) * a * uGain, 1.0);
      }`,
  });
  const underG = new THREE.PlaneGeometry(SHELF_X1 - SHELF_X0 + 0.8, 0.9);
  const underPool = new THREE.Mesh(underG, underMat);
  underPool.position.set((SHELF_X0 + SHELF_X1) / 2, SHELF_Y - 0.036 - 0.45, WALL_Z + 0.002);
  underPool.renderOrder = 2;
  group.add(underPool);
  disposables.push(underMat, underG);

  /* ---- dust: points that only show inside a shaft ---- */
  const DUST_MAX = isMobile ? 700 : 2000;
  const dG = new THREE.BufferGeometry();
  const dp = new Float32Array(DUST_MAX * 3);
  const ds = new Float32Array(DUST_MAX);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < DUST_MAX; i++) {
    dp[i * 3] = SHELF_X0 - 0.4 + rnd() * (SHELF_X1 - SHELF_X0 + 0.8);
    dp[i * 3 + 1] = SHELF_Y + 0.05 + rnd() * 1.3;
    dp[i * 3 + 2] = WALL_Z + 0.04 + rnd() * 0.85;
    ds[i] = rnd();
  }
  dG.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dG.setAttribute('aSeed', new THREE.BufferAttribute(ds, 1));
  dG.setDrawRange(0, tier === 'low' ? Math.floor(DUST_MAX * 0.35) : tier === 'medium' ? Math.floor(DUST_MAX * 0.65) : DUST_MAX);
  // shaft geometry for gating: end of shaft 0 and the period between shafts
  const e0 = new THREE.Vector3(SHELF_X0 + 0.15, SHELF_Y + 0.3, WALL_Z + 0.05);
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 900 }, uAxis: { value: KEY_DIR.clone() }, uE0: { value: e0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPx; uniform vec3 uAxis, uE0;
      varying float vA;
      void main(){
        vec3 p = position;
        float s = aSeed * 6.2831;
        p += vec3(sin(uTime * 0.11 + s * 3.0) * 0.05, sin(uTime * 0.07 + s * 5.0) * 0.035 - mod(uTime * 0.004 + aSeed, 1.0) * 0.06, cos(uTime * 0.09 + s * 2.0) * 0.04);
        vec3 d = p - uE0; vec3 dp = d - uAxis * dot(d, uAxis);
        vec3 o = vec3(0.68, 0.0, 0.0); vec3 op = o - uAxis * dot(o, uAxis);
        float k = floor(dot(dp, op) / dot(op, op) + 0.5);
        float dist = length(dp - k * op);
        float inBeam = 1.0 - smoothstep(0.08, 0.26, dist);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = -mv.z;
        // motes 1.5-4 mm: a few px at the dolly's distance, so they read as dust in the light, not noise
        float sz = (0.0016 + aSeed * 0.0024) * uPx / depth;
        gl_PointSize = clamp(sz, 1.5, 26.0);
        float foot = smoothstep(${(SHELF_Y + 0.02).toFixed(2)}, ${(SHELF_Y + 0.25).toFixed(2)}, p.y);
        // brighter the higher (nearer the lamp) they float in the beam; the occasional glint as a mote turns
        float lamp = 0.75 + 0.6 * smoothstep(${(SHELF_Y + 0.2).toFixed(2)}, ${(SHELF_Y + 1.1).toFixed(2)}, p.y);
        float glint = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + s * 7.0);
        vA = (0.02 + 0.98 * inBeam) * foot * lamp * glint / max(1.0, sz * 0.22);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.55, 1.0, d)) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * a * 2.1, 1.0);
      }`,
  });
  const dust = new THREE.Points(dG, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  group.add(dust);

  disposables.push(wallMat, frameMat, sillMat, windowMat, shelfMat, iron, shaftMat, dustMat, shaftG, dG);

  return {
    group,
    key,
    lights,
    windowMat,
    shafts,
    dust,
    setTier(t) {
      windowMat.uniforms.uLayers.value = t === 'low' ? 1 : 2;
      windowMat.uniforms.uSlide.value = 1;
      dG.setDrawRange(0, t === 'low' ? Math.floor(DUST_MAX * 0.35) : t === 'medium' ? Math.floor(DUST_MAX * 0.65) : DUST_MAX);
      shafts.visible = t !== 'low';
      poolMat.uniforms.uGain.value = t === 'low' ? 1.25 : 1.0;
    },
    update(time) {
      windowMat.uniforms.uTime.value = time;
      shaftMat.uniforms.uTime.value = time;
      dustMat.uniforms.uTime.value = time;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      disposables.forEach((d) => d.dispose());
      key.shadow.map?.dispose();
    },
  };
}

/** Set the dust's pixel scale (drawing-buffer height / (2 tan(fov/2))). */
export function setDustPx(room: Room, px: number) {
  (room.dust.material as THREE.ShaderMaterial).uniforms.uPx.value = px;
}
