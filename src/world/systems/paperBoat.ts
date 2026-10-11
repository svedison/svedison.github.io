// The paper boat: a classic folded "hat" boat in washi (3d-paper-material, washi preset #f0e8d2), carrying a lantern.
//
// Geometry (boat length ~1 unit along +x = bow, y up, z = beam), all flat-shaded facets so the folds read:
//  - two hull sides, each a fan of flat facets from the keel fold up to a rim that bows out amidships;
//  - a folded-up cuff band along each rim (the hat brim), a paper-thickness proud of the hull and paler;
//  - the sail: a double-layer triangle standing in the middle, its two layers slightly parted, entering the hull;
//  - thickness: an inner copy of every sheet, offset by the paper thickness and tinted 0.86 (skill: offset copies).
// Light: the lantern sits in the bow pocket; its glow transmits through the paper as emissive × transmission map
// (formation-driven), falling off with distance from the lantern (the skill's Transmit step, done cheaply).
import type * as THREE_NS from 'three';
import { acquireWashi, releaseWashi } from './washi';
import { createLantern, type Lantern } from './lantern';

type THREE = typeof THREE_NS;

export interface PaperBoatOptions {
  /** Lantern glow colour. Default #F2A93B. */
  lanternColor?: THREE_NS.ColorRepresentation;
  /** Starting lantern intensity 0..2. Default 1. */
  lantern?: number;
  /** Add a real PointLight at the lantern (lights the water/scene around). Default true. */
  light?: boolean;
  /** PointLight range in world units (independent of group scale). Default 4. */
  lightDistance?: number;
  /** PointLight intensity at lantern 1. Default 1.4. */
  lightIntensity?: number;
  /** Candle flicker; pass false under reduced motion. Default true. */
  flicker?: boolean;
  /** Paper tint. Default #f0e8d2 (washi). */
  tint?: THREE_NS.ColorRepresentation;
}

export interface PaperBoat {
  /** Root. Boat is ~1 unit long, keel at y=0, bow toward +x. Scale/position/rotate this. */
  group: THREE_NS.Group;
  lantern: Lantern;
  /** Lantern brightness: 0 = unlit, 1 = normal, ~1.8 = "Love" gold bloom. Also drives paper transmission. */
  setLantern(intensity: number): void;
  /** Sun direction (world, toward the sun) + colour*strength for back-lit transmission through the paper. */
  setSun(dir: THREE_NS.Vector3, color: THREE_NS.ColorRepresentation, strength?: number): void;
  /** Flicker + paper glow. No allocation. */
  update(dt: number, time: number): void;
  dispose(): void;
}

// --- dimensions (unit-length boat)
const A = 0.5; // rim half-length (tip to tip = 1)
const B = 0.25; // keel half-length
const H = 0.2; // hull height
const W = 0.14; // half-beam at the rim amidships
const SAIL_H = 0.33; // sail apex above rim
const PAPER = 0.006; // paper thickness

const RIM_U = [-1, -0.62, -0.25, 0.25, 0.62, 1];
const RIM_Z = [0, 0.74, 1, 1, 0.74, 0];

function buildBoatGeometry(THREE: THREE): THREE_NS.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const tri = (a: THREE_NS.Vector3, b: THREE_NS.Vector3, c: THREE_NS.Vector3, shade: number) => {
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      col.push(shade, shade, shade);
      // planar projection, scaled so the 256px washi tile spans ~0.45 units
      uv.push((p.x + p.z * 0.6) * 3.6, (p.y + p.z * 0.4) * 3.6);
    }
  };
  const quad = (a: THREE_NS.Vector3, b: THREE_NS.Vector3, c: THREE_NS.Vector3, d: THREE_NS.Vector3, shade: number) => {
    tri(a, b, c, shade);
    tri(a, c, d, shade);
  };
  const n = RIM_U.length;
  const keel = (u: number) => v3(B * u, 0, 0);
  const rim = (i: number, side: number, y = H) => v3(A * RIM_U[i] + 0, y, side * W * RIM_Z[i]);
  // A point on the hull side at height fraction f (0 keel .. 1 rim) under rim vertex i.
  const hullAt = (i: number, side: number, f: number) => {
    const k = keel(RIM_U[i]);
    const r = rim(i, side);
    return k.lerp(r, f);
  };
  const CUFF = 0.7; // cuff band from 70% height to the rim

  for (const side of [1, -1]) {
    const flip = side < 0;
    // hull facets: keel -> cuff line
    for (let i = 0; i < n - 1; i++) {
      const a = hullAt(i, side, 0);
      const b = hullAt(i + 1, side, 0);
      const c = hullAt(i + 1, side, CUFF);
      const d = hullAt(i, side, CUFF);
      // end facets are the folded-over flaps: a touch brighter than the middle panel so the folds read
      const shade = i === 0 || i === n - 2 ? 0.99 : i === 1 || i === n - 3 ? 0.95 : 0.92;
      if (flip) quad(a, d, c, b, shade);
      else quad(a, b, c, d, shade);
    }
    // cuff band: proud of the hull by one paper thickness, paler (two layers of paper)
    for (let i = 0; i < n - 1; i++) {
      const off = (p: THREE_NS.Vector3) => {
        p.z += side * PAPER * 1.2;
        return p;
      };
      const a = off(hullAt(i, side, CUFF - 0.02));
      const b = off(hullAt(i + 1, side, CUFF - 0.02));
      const c = off(rim(i + 1, side, H + 0.004));
      const d = off(rim(i, side, H + 0.004));
      if (flip) quad(a, d, c, b, 1.0);
      else quad(a, b, c, d, 1.0);
      // cuff underside edge (the paper's cut edge) — a thin darker lip
      const e = hullAt(i, side, CUFF - 0.02);
      const f = hullAt(i + 1, side, CUFF - 0.02);
      if (flip) quad(e, a, b, f, 0.72);
      else quad(e, f, b, a, 0.72);
    }
    // inner skin (paper thickness), tinted 0.86
    for (let i = 0; i < n - 1; i++) {
      const inset = (p: THREE_NS.Vector3) => {
        p.z -= side * PAPER;
        p.y -= PAPER * 0.5;
        return p;
      };
      const a = inset(hullAt(i, side, 0.04));
      const b = inset(hullAt(i + 1, side, 0.04));
      const c = inset(rim(i + 1, side));
      const d = inset(rim(i, side));
      if (flip) quad(a, b, c, d, 0.82);
      else quad(a, d, c, b, 0.82);
      // rim edge strip joining outer and inner sheet: the visible paper thickness
      const ro0 = rim(i, side, H + 0.004);
      const ro1 = rim(i + 1, side, H + 0.004);
      ro0.z += side * PAPER * 1.2;
      ro1.z += side * PAPER * 1.2;
      if (flip) quad(ro0, ro1, c, d, 0.9);
      else quad(ro0, d, c, ro1, 0.9);
    }
  }

  // sail: two layers parted by a little air, each folded once down its middle (two facets, slightly out of plane)
  const apex = v3(0, H + SAIL_H, 0);
  const baseY = H * 0.45;
  const halfAtBase = 0.35;
  for (const side of [1, -1]) {
    const z = side * PAPER * 1.6;
    const bl = v3(-halfAtBase, baseY, z * 2.2);
    const br = v3(halfAtBase, baseY, z * 2.2);
    const mid = v3(0, baseY - 0.02, z * 5.0); // the layer bellies out a touch at the bottom
    const top = v3(apex.x, apex.y, z);
    if (side > 0) {
      tri(bl, mid, top, 0.99);
      tri(mid, br, top, 0.95);
    } else {
      tri(bl, top, mid, 0.97);
      tri(mid, top, br, 0.93);
    }
  }
  // sail tip thickness: tiny cap joining the two layers at the apex edges
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); // non-indexed => flat facets: the folds read
  return geo;
}

export function createPaperBoat(THREE: THREE, opts: PaperBoatOptions = {}): PaperBoat {
  const group = new THREE.Group();
  group.name = 'paper-boat';

  const washi = acquireWashi(THREE);
  const lanternColor = new THREE.Color(opts.lanternColor ?? '#F2A93B');
  const geo = buildBoatGeometry(THREE);

  const LANTERN_POS = new THREE.Vector3(0.33, H + 0.035, 0);
  const glowUniforms = {
    uLanternPos: { value: LANTERN_POS },
    uGlowRadius: { value: 0.32 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.3, -0.8).normalize() },
    uSunTrans: { value: new THREE.Color('#ffd2a0').multiplyScalar(0.35) },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.tint ?? '#f0e8d2'),
    map: washi.albedo,
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: lanternColor.clone(),
    emissiveMap: washi.transmit,
    emissiveIntensity: 0,
    // fibre tooth catching raking light (same fields as albedo + transmission)
    bumpMap: washi.transmit,
    bumpScale: 0.35,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoatPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoatPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBoatPos;\nuniform vec3 uLanternPos;\nuniform float uGlowRadius;\nuniform vec3 uSunDir;\nuniform vec3 uSunTrans;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // light through the paper: strongest beside the lantern, inner faces lit directly, outer faces transmit
          float d = length(vBoatPos - uLanternPos);
          float fall = exp(-d / uGlowRadius);
          float inner = gl_FrontFacing ? 0.45 : 1.0;
          totalEmissiveRadiance *= fall * inner;
          // back-lit paper: sun behind the sheet shines through it, modulated by the same formation map
          vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = max(dot(-normal, sunV), 0.0);
          float tmap = texture2D(emissiveMap, vEmissiveMapUv).g;
          totalEmissiveRadiance += uSunTrans * back * (0.7 + 0.45 * tmap) * diffuseColor.rgb;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'paper-boat-v2';
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  const lantern = createLantern(THREE, {
    color: lanternColor,
    size: 0.085,
    light: opts.light ?? true,
    lightDistance: opts.lightDistance ?? 4,
    lightIntensity: opts.lightIntensity ?? 1.4,
    flicker: opts.flicker ?? true,
    intensity: opts.lantern ?? 1,
    seed: 3.7,
  });
  lantern.group.position.copy(LANTERN_POS);
  group.add(lantern.group);

  let intensity = opts.lantern ?? 1;
  let flick = 1;
  const apply = () => {
    mat.emissiveIntensity = 1.1 * intensity * flick;
  };
  apply();

  return {
    group,
    lantern,
    setLantern(v) {
      intensity = Math.max(0, v);
      lantern.setIntensity(intensity);
      apply();
    },
    setSun(dir, color, strength = 0.4) {
      glowUniforms.uSunDir.value.copy(dir).normalize();
      glowUniforms.uSunTrans.value.set(color).multiplyScalar(strength);
    },
    update(dt, time) {
      lantern.update(dt, time);
      if (opts.flicker ?? true) {
        flick = 0.92 + 0.08 * Math.sin(time * 9.1 + 1.3) * Math.sin(time * 5.3);
        apply();
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lantern.dispose();
      releaseWashi();
      group.removeFromParent();
    },
  };
}
