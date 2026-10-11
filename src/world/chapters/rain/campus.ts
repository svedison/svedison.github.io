// The quad: generic collegiate-gothic masses (brick + cast-stone trim, steep slate roofs, buttresses, lancet windows,
// a tower with pinnacles), brick paths, a fountain plaza on the axis of the vista, lamp posts, a covered arcade and a
// bench. Built from a small kit and merged by material (one draw per material). Nothing here is a replica of a real
// building. Wear is causal: rain streaks run down walls, roofs and up-facing faces take snow in winter.
import type * as THREE_NS from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../../systems/noise';
import { LAND_Y } from './terrain';

type THREE = typeof THREE_NS;

/** Authored anchors (world). */
export const ANCHOR = {
  /** Red CSO lantern hangs from the right-row cherry at z ≈ -71. */
  lantern: { x: 9.6, y: 3.0, z: -70.7 },
  bench: { x: 8.6, z: -83.5 },
  /** Letter pinned on the wall inside the arcade, behind the first arch. */
  letter: { x: 16.25, y: 1.75, z: -79.93 },
  fountain: { x: 5, z: -104 },
};

type Key = 'wall' | 'trim' | 'roof' | 'path' | 'iron' | 'wood' | 'water';

export interface Campus {
  group: THREE_NS.Group;
  umbrella: THREE_NS.Group;
  umbrellaMat: THREE_NS.MeshStandardMaterial;
  letter: THREE_NS.Mesh;
  letterMat: THREE_NS.MeshLambertMaterial;
  lampGlows: { x: number; y: number; z: number; size: number; color: string }[];
  setSeason(snow: number, windowGlow: number): void;
  dispose(): void;
}

export function createCampus(THREE: THREE, mobile: boolean): Campus {
  const group = new THREE.Group();
  group.name = 'campus';
  const disposables: { dispose(): void }[] = [];
  const parts: Record<Key, THREE_NS.BufferGeometry[]> = { wall: [], trim: [], roof: [], path: [], iron: [], wood: [], water: [] };
  const windows: THREE_NS.BufferGeometry[] = [];
  const Y = LAND_Y;

  const clean = (g: THREE_NS.BufferGeometry) => {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      return ng;
    }
    return g;
  };
  const box = (k: Key, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    parts[k].push(clean(g));
  };
  const cyl = (k: Key, r0: number, r1: number, h: number, seg: number, x: number, y: number, z: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    g.translate(x, y + h / 2, z);
    parts[k].push(clean(g));
  };
  const cone = (k: Key, r: number, h: number, seg: number, x: number, y: number, z: number) => {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.rotateY(Math.PI / seg);
    g.translate(x, y + h / 2, z);
    parts[k].push(clean(g));
  };
  /** Gable roof prism; ridge along x (alongX) or z. Eave line at y, ridge at y + h. */
  const gable = (k: Key, len: number, width: number, h: number, x: number, y: number, z: number, alongX: boolean) => {
    const s = new THREE.Shape();
    s.moveTo(-width / 2 - 0.35, -0.1);
    s.lineTo(width / 2 + 0.35, -0.1);
    s.lineTo(0, h);
    s.lineTo(-width / 2 - 0.35, -0.1);
    const g = new THREE.ExtrudeGeometry(s, { depth: len + 0.6, bevelEnabled: false });
    g.translate(0, 0, -(len + 0.6) / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    parts[k].push(clean(g));
  };
  /** Pointed lancet window (shape coords kept as uv for the mullion shader). facing: +z, +x, -x. */
  const lancet = (w: number, h: number, x: number, y: number, z: number, facing: 'z' | 'x' | '-x') => {
    const s = new THREE.Shape();
    const ah = w * 0.85;
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h - ah);
    s.quadraticCurveTo(w / 2, h - ah * 0.3, 0, h);
    s.quadraticCurveTo(-w / 2, h - ah * 0.3, -w / 2, h - ah);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ShapeGeometry(s, 4);
    if (facing === 'x') g.rotateY(Math.PI / 2);
    if (facing === '-x') g.rotateY(-Math.PI / 2);
    g.translate(x, y, z);
    windows.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
  };

  // ---------------- a gothic block: walls, plinth, string course, buttresses, windows, gable roof
  const block = (o: {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    h: number;
    roofH: number;
    alongX: boolean;
    winFaces: ('z' | 'x' | '-x')[];
    bay: number;
  }) => {
    const w = o.x1 - o.x0;
    const d = o.z1 - o.z0;
    const cx = (o.x0 + o.x1) / 2;
    const cz = (o.z0 + o.z1) / 2;
    box('wall', w, o.h, d, cx, Y, cz);
    box('trim', w + 0.3, 0.7, d + 0.3, cx, Y, cz); // plinth
    box('trim', w + 0.22, 0.28, d + 0.22, cx, Y + o.h - 0.28, cz); // eave course
    box('trim', w + 0.12, 0.16, d + 0.12, cx, Y + 2.1, cz); // string course
    gable('roof', o.alongX ? w : d, o.alongX ? d : w, o.roofH, cx, Y + o.h, cz, o.alongX);
    for (const f of o.winFaces) {
      const along = f === 'z' ? w : d;
      const n = Math.floor(along / o.bay);
      const start = (f === 'z' ? o.x0 : o.z0) + (along - n * o.bay) / 2;
      for (let i = 0; i <= n; i++) {
        const u = start + i * o.bay;
        // buttress at every bay line
        if (f === 'z') box('trim', 0.7, o.h - 0.4, 0.9, u, Y, o.z1 + 0.4);
        else if (f === 'x') box('trim', 0.9, o.h - 0.4, 0.7, o.x1 + 0.4, Y, u);
        else box('trim', 0.9, o.h - 0.4, 0.7, o.x0 - 0.4, Y, u);
        if (i === n) break;
        const m = u + o.bay / 2;
        const ww = Math.min(1.5, o.bay * 0.42);
        const wh = o.h - 3.6;
        if (f === 'z') lancet(ww, wh, m, Y + 2.5, o.z1 + 0.03, 'z');
        else if (f === 'x') lancet(ww, wh, o.x1 + 0.03, Y + 2.5, m, 'x');
        else lancet(ww, wh, o.x0 - 0.03, Y + 2.5, m, '-x');
      }
    }
  };

  // Hall L (with the tower at its right end) and Hall R (with an entrance pavilion): the vista opens between them.
  block({ x0: -30, x1: -2, z0: -140, z1: -128, h: 10, roofH: 6, alongX: true, winFaces: ['z'], bay: 3.5 });
  block({ x0: 13, x1: 44, z0: -140, z1: -128, h: 10, roofH: 6, alongX: true, winFaces: ['z'], bay: 3.5 });
  // tower
  {
    const x0 = -8.5;
    const x1 = -1.5;
    const z0 = -133.5;
    const z1 = -126.5;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const H = 25;
    box('wall', 7, H, 7, cx, Y, cz);
    box('trim', 7.4, 0.8, 7.4, cx, Y, cz);
    for (const y of [2.1, 10.5, 18.5]) box('trim', 7.2, 0.2, 7.2, cx, Y + y, cz);
    // corner buttresses that step in as they rise
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      box('trim', 1.1, 12, 1.1, cx + sx * 3.4, Y, cz + sz * 3.4);
      box('trim', 0.8, H - 1, 0.8, cx + sx * 3.45, Y, cz + sz * 3.45);
      cone('trim', 0.55, 3.6, 4, cx + sx * 3.45, Y + H - 0.2, cz + sz * 3.45);
    }
    // crenellated parapet
    for (let i = 0; i < 6; i++) {
      const u = -2.9 + i * 1.16;
      box('trim', 0.6, 0.9, 0.35, cx + u, Y + H, z1);
      box('trim', 0.6, 0.9, 0.35, cx + u, Y + H, z0);
      box('trim', 0.35, 0.9, 0.6, x0, Y + H, cz + u);
      box('trim', 0.35, 0.9, 0.6, x1, Y + H, cz + u);
    }
    box('trim', 7.3, 0.3, 7.3, cx, Y + H - 0.3, cz);
    // belfry lancets and a tall stair window
    lancet(1.1, 5.2, cx - 1.4, Y + 19.2, z1 + 0.03, 'z');
    lancet(1.1, 5.2, cx + 1.4, Y + 19.2, z1 + 0.03, 'z');
    lancet(1.2, 6.5, cx, Y + 11.2, z1 + 0.03, 'z');
    lancet(1.6, 6.0, cx, Y + 2.6, z1 + 0.03, 'z');
  }
  // entrance pavilion on Hall R
  {
    const x0 = 18.5;
    const x1 = 27.5;
    const cx = (x0 + x1) / 2;
    box('wall', 9, 13, 3.2, cx, Y, -126.9);
    box('trim', 9.4, 0.7, 3.5, cx, Y, -126.9);
    gable('roof', 3.6, 9, 5, cx, Y + 13, -126.9, false);
    box('trim', 1, 14, 1, x0, Y, -125.5);
    box('trim', 1, 14, 1, x1, Y, -125.5);
    cone('trim', 0.55, 3, 4, x0, Y + 14, -125.5);
    cone('trim', 0.55, 3, 4, x1, Y + 14, -125.5);
    lancet(3.0, 7.8, cx, Y + 4.2, -125.27, 'z');
    lancet(1.8, 3.4, cx, Y + 0.2, -125.27, 'z'); // the door glows too
  }
  // Wing L (behind the copy column, mostly a dark mass) and Wing R (with the arcade)
  block({ x0: -26, x1: -16, z0: -124, z1: -84, h: 8.5, roofH: 5, alongX: false, winFaces: ['x'], bay: 3.4 });
  block({ x0: 15, x1: 30, z0: -111, z1: -80, h: 8.5, roofH: 5.5, alongX: true, winFaces: ['-x'], bay: 3.4 });
  // windows on Wing R's front, above the arcade roof
  for (const x of [17.5, 21, 24.5, 28]) lancet(1.0, 2.4, x, Y + 5.0, -79.97, 'z');

  // ---------------- arcade: a pierced front wall with three pointed arches, a lean-to roof, a dry walkway
  {
    const ax0 = 15;
    const ax1 = 22.5;
    const zf = -77.6;
    const H = 3.9;
    const bay = (ax1 - ax0) / 3;
    const s = new THREE.Shape();
    s.moveTo(ax0, 0);
    s.lineTo(ax1, 0);
    s.lineTo(ax1, H);
    s.lineTo(ax0, H);
    s.lineTo(ax0, 0);
    for (let i = 0; i < 3; i++) {
      const c = ax0 + bay * (i + 0.5);
      const hw = bay / 2 - 0.3;
      const p = new THREE.Path();
      p.moveTo(c - hw, 0);
      p.lineTo(c - hw, 1.9);
      p.quadraticCurveTo(c - hw, 2.75, c, 3.15);
      p.quadraticCurveTo(c + hw, 2.75, c + hw, 1.9);
      p.lineTo(c + hw, 0);
      p.lineTo(c - hw, 0);
      s.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, Y, zf - 0.45);
    parts.trim.push(clean(g));
    box('trim', ax1 - ax0 + 0.3, 0.25, 0.7, (ax0 + ax1) / 2, Y + H, zf - 0.2);
    // lean-to roof from the arcade front up to Wing R
    const roof = new THREE.BoxGeometry(ax1 - ax0 + 0.6, 0.18, 3.4);
    roof.rotateX(-0.32);
    roof.translate((ax0 + ax1) / 2, Y + H + 0.55, zf - 1.15);
    parts.roof.push(clean(roof));
    // walkway floor + end wall
    box('path', ax1 - ax0, 0.06, 2.4, (ax0 + ax1) / 2, Y, zf - 1.2);
    box('trim', 0.45, H, 2.4, ax1 - 0.2, Y, zf - 1.2);
  }

  // ---------------- paths, plaza, fountain, balustrade across the vista
  box('path', 3.6, 0.05, 76, 5, Y - 0.01, -93);
  box('path', 31, 0.05, 2.8, -0.5, Y - 0.01, -77);
  box('path', 70, 0.05, 3, 8, Y - 0.01, -126);
  {
    const g = new THREE.CylinderGeometry(6.5, 6.5, 0.06, 40);
    g.translate(ANCHOR.fountain.x, Y + 0.0, ANCHOR.fountain.z);
    parts.path.push(clean(g));
    const rim = new THREE.TorusGeometry(3.4, 0.22, 6, 40);
    rim.rotateX(-Math.PI / 2);
    rim.translate(ANCHOR.fountain.x, Y + 0.32, ANCHOR.fountain.z);
    parts.trim.push(clean(rim));
    cyl('trim', 3.5, 3.5, 0.32, 40, ANCHOR.fountain.x, Y, ANCHOR.fountain.z);
    const w = new THREE.CircleGeometry(3.25, 40);
    w.rotateX(-Math.PI / 2);
    w.translate(ANCHOR.fountain.x, Y + 0.36, ANCHOR.fountain.z);
    parts.water.push(clean(w));
    cyl('trim', 0.55, 0.35, 1.0, 10, ANCHOR.fountain.x, Y + 0.3, ANCHOR.fountain.z);
    cyl('trim', 0.9, 0.9, 0.12, 12, ANCHOR.fountain.x, Y + 1.3, ANCHOR.fountain.z);
  }
  box('trim', 14.2, 0.9, 0.35, 5.6, Y, -131.5);
  for (let x = -1; x <= 12.5; x += 1.35) box('trim', 0.3, 1.1, 0.4, x, Y, -131.5);

  // ---------------- a timber pier off the end of the path: where the convoy comes in, where the camera stands
  {
    box('wood', 2.2, 0.1, 13, 5, Y + 0.02, -50.5);
    for (let z = -44.5; z >= -56; z -= 2.6) {
      cyl('wood', 0.09, 0.09, 1.0, 6, 3.9, -0.6, z);
      cyl('wood', 0.09, 0.09, 1.0, 6, 6.1, -0.6, z);
    }
    box('wood', 0.1, 0.1, 13, 3.95, Y + 0.1, -50.5);
    box('wood', 0.1, 0.1, 13, 6.05, Y + 0.1, -50.5);
  }

  // ---------------- lamp posts
  const lampGlows: Campus['lampGlows'] = [];
  const lamp = (x: number, z: number) => {
    cyl('iron', 0.07, 0.05, 3.3, 6, x, Y, z);
    cyl('iron', 0.14, 0.14, 0.22, 6, x, Y, z);
    box('iron', 0.34, 0.06, 0.34, x, Y + 3.3, z);
    cone('iron', 0.26, 0.24, 4, x, Y + 3.78, z);
    lampGlows.push({ x, y: Y + 3.55, z, size: 1.5, color: '#ffc982' });
  };
  for (const z of [-72, -100, -122]) lamp(2.7, z);
  // right row starts at the bench (it lights the umbrella), not in the camera's sightline to the CSO lantern
  for (const z of [-86, -104, -120]) lamp(7.3, z);
  // lamp heads themselves (emissive), merged into the window mesh
  for (const g of lampGlows) {
    const h = new THREE.BoxGeometry(0.24, 0.42, 0.24);
    h.translate(g.x, g.y, g.z);
    // planar uv so the window shader paints it solid
    const pos = h.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = 9.0; // marker: always lit
      uv[i * 2 + 1] = 0.5;
    }
    h.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    windows.push(h.toNonIndexed());
    h.dispose();
  }
  // sconce over the letter
  lampGlows.push({ x: ANCHOR.letter.x, y: ANCHOR.letter.y + 1.05, z: ANCHOR.letter.z + 0.25, size: 1.0, color: '#ffc982' });
  box('iron', 0.16, 0.24, 0.16, ANCHOR.letter.x, ANCHOR.letter.y + 0.92, ANCHOR.letter.z + 0.12);

  // ---------------- bench (slats along z, facing -x toward the path)
  {
    const { x, z } = ANCHOR.bench;
    for (let i = 0; i < 3; i++) box('wood', 0.13, 0.05, 2.0, x - 0.18 + i * 0.15, Y + 0.44, z);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BoxGeometry(0.05, 0.13, 2.0);
      g.rotateZ(-0.18);
      g.translate(x + 0.28 + i * 0.02, Y + 0.68 + i * 0.17, z);
      parts.wood.push(clean(g));
    }
    for (const dz of [-0.85, 0.85]) {
      box('iron', 0.5, 0.05, 0.06, x, Y + 0.4, z + dz);
      box('iron', 0.05, 0.42, 0.06, x - 0.2, Y, z + dz);
      box('iron', 0.05, 0.9, 0.06, x + 0.26, Y, z + dz);
    }
  }

  // ---------------- merge + materials
  const snowU = { value: 0 };
  const detail = (mat: THREE_NS.MeshLambertMaterial, kind: 'brick' | 'stone' | 'path' | 'roof' | 'plain') => {
    // one closure source for every kind: without its own key three would share the first compiled program
    mat.customProgramCacheKey = () => `rain-campus-${kind}`;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snowU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWN;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uSnow;\nvarying vec3 vWp;\nvarying vec3 vWN;\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 n = normalize(vWN);
            float u = abs(n.x) > abs(n.z) ? vWp.z : vWp.x;
            float k = 1.0;
            ${
              kind === 'brick'
                ? `float row = floor(vWp.y / 0.17);
                   float bx = fract((u + mod(row, 2.0) * 0.19) / 0.38);
                   float by = fract(vWp.y / 0.17);
                   float mortar = step(bx, 0.06) + step(by, 0.12);
                   k *= mix(0.9 + 0.22 * hash12(vec2(floor((u + mod(row, 2.0) * 0.19) / 0.38), row)), 1.35, clamp(mortar, 0.0, 1.0) * 0.6);`
                : ''
            }
            ${
              kind === 'path'
                ? `vec2 q = vWp.xz / vec2(0.36, 0.18);
                   float row = floor(q.y);
                   q.x += mod(row, 2.0) * 0.5;
                   vec2 f = fract(q);
                   float mortar = step(f.x, 0.07) + step(f.y, 0.12);
                   float aa = 1.0 - smoothstep(0.25, 0.6, length(fwidth(q)));
                   k *= mix(0.85 + 0.3 * hash12(floor(q)) * aa, 0.62, clamp(mortar, 0.0, 1.0) * aa) * mix(0.8, 1.0, aa);
                   // wet puddle sheen in the low spots
                   k *= 1.0 - 0.18 * smoothstep(0.55, 0.75, vnoise(vWp.xz * 0.6));`
                : ''
            }
            ${kind === 'roof' ? `k *= 0.85 + 0.25 * step(0.5, fract(vWp.y / 0.22)) * 0.6 + 0.15 * hash12(floor(vec2(u / 0.3, vWp.y / 0.22)));` : ''}
            ${kind === 'stone' ? `k *= 0.88 + 0.2 * vnoise(vec2(u, vWp.y) * 1.7);` : ''}
            // rain streaks down vertical faces, darker under eaves
            float vert = 1.0 - abs(n.y);
            float streak = vnoise(vec2(u * 3.1, vWp.y * 0.12)) * vnoise(vec2(u * 9.0, 1.3));
            k *= 1.0 - vert * 0.32 * smoothstep(0.25, 0.65, streak);
            diffuseColor.rgb *= k;
            float sn = uSnow * smoothstep(0.35, 0.85, n.y) * smoothstep(0.2, 0.55, vnoise(vWp.xz * 1.9) * 0.6 + 0.5 * uSnow);
            ${
              // winter value structure: the brick paths are walked clear (a dark wet band with slush at the edges
              // and in the joints) and slate roofs hold broken snow, so neither melts into the white ground or the sky
              kind === 'path'
                ? `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.12, 0.13) * (0.85 + 0.3 * vnoise(vWp.xz * 0.9)), 0.8 * uSnow);
                   sn *= 0.3 + 0.12 * vnoise(vWp.xz * 1.3 + 4.0) + 0.5 * smoothstep(1.2, 1.75, abs(vWp.x - 5.0));`
                : kind === 'roof'
                  ? `sn *= 0.62 + 0.2 * step(0.5, fract(vWp.y / 0.22));`
                  : ''
            }
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.87, 0.89), sn);
          }`,
        );
    };
  };
  const mats: Record<Key, THREE_NS.MeshLambertMaterial> = {
    wall: new THREE.MeshLambertMaterial({ color: '#7c5a4b' }),
    trim: new THREE.MeshLambertMaterial({ color: '#a39785' }),
    roof: new THREE.MeshLambertMaterial({ color: '#3a4144' }),
    path: new THREE.MeshLambertMaterial({ color: '#6b4b41' }),
    iron: new THREE.MeshLambertMaterial({ color: '#1d2124' }),
    wood: new THREE.MeshLambertMaterial({ color: '#615349' }),
    water: new THREE.MeshLambertMaterial({ color: '#1b2a2c' }),
  };
  detail(mats.wall, 'brick');
  detail(mats.trim, 'stone');
  detail(mats.roof, 'roof');
  detail(mats.path, 'path');
  detail(mats.wood, 'plain');
  (Object.keys(parts) as Key[]).forEach((k) => {
    if (!parts[k].length) return;
    const g = mergeGeometries(parts[k])!;
    parts[k].forEach((p) => p.dispose());
    const m = new THREE.Mesh(g, mats[k]);
    m.name = `campus-${k}`;
    group.add(m);
    disposables.push(g, mats[k]);
  });

  // windows: warm interiors with mullions and transoms, some rooms dark
  const winU = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uGlow: { value: 1 } };
  const winMat = new THREE.ShaderMaterial({
    uniforms: winU,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vWp;
      void main(){
        vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform float uGlow;
      varying vec2 vUv; varying vec3 vWp;
      void main(){
        float room = hash12(floor(vWp.xz / 3.3) + floor(vWp.y / 4.0) * 7.0);
        float lit = room > 0.28 ? 1.0 : 0.12;
        float mull = step(abs(vUv.x), 0.035) + step(fract(vUv.y / 1.15), 0.05);
        float lead = step(fract(vUv.x * 3.2), 0.06) * 0.4;
        vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.85, 0.6), room);
        vec3 c = warm * (0.55 + 0.6 * (1.0 - smoothstep(0.0, 6.0, vUv.y))) * lit * uGlow;
        c = mix(c, vec3(0.08, 0.07, 0.07), clamp(mull + lead, 0.0, 1.0) * 0.85);
        c += vec3(0.06, 0.07, 0.08) * (1.0 - lit);
        if (vUv.x > 5.0) c = vec3(1.0, 0.74, 0.44) * 0.62 * uGlow; // lamp globes: warm, never blown white
        gl_FragColor = vec4(c * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const winGeo = mergeGeometries(windows)!;
  windows.forEach((w) => w.dispose());
  const winMesh = new THREE.Mesh(winGeo, winMat);
  winMesh.name = 'campus-windows';
  group.add(winMesh);
  disposables.push(winGeo, winMat);

  // ---------------- umbrella (hotspot object): open, resting against the bench. A domed eight-panel canopy that
  // sags between its ribs and scallops at the rim (the silhouette everyone knows), slate-blue nylon wet with rain:
  // low roughness so it carries real highlights, darker seams along the ribs, a ferrule and a J-handle.
  const umbrella = new THREE.Group();
  umbrella.name = 'umbrella';
  const umbrellaMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.0,
    side: THREE.DoubleSide,
    emissive: '#000000',
  });
  const R_UMB = 0.92;
  const canopyGeo = new THREE.SphereGeometry(R_UMB, 32, 8, 0, Math.PI * 2, 0, 1.05);
  {
    const p = canopyGeo.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    const nylon = new THREE.Color('#3f6a8c');
    const seam = new THREE.Color('#22384b');
    const tmp = new THREE.Color();
    const yRim = R_UMB * Math.cos(1.05);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const phi = Math.atan2(z, x);
      const panel = (((phi / (Math.PI * 2)) * 8) % 1 + 1) % 1;
      const mid = Math.sin(Math.PI * panel); // 0 on a rib, 1 mid-panel
      const rim = Math.min(1, Math.max(0, 1 - (y - yRim) / (R_UMB - yRim))); // 0 at the crown, 1 at the rim
      const k = 1 - 0.06 * mid * rim; // panels sag between the ribs
      p.setXYZ(i, x * k, y + 0.07 * mid * rim * rim, z * k); // and scallop up between rib tips
      tmp.copy(nylon).lerp(seam, Math.pow(1 - mid, 6) * 0.85);
      cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    canopyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    canopyGeo.computeVertexNormals();
    canopyGeo.translate(0, -R_UMB * Math.cos(1.05) * 0.4, 0);
  }
  const canopy = new THREE.Mesh(canopyGeo, umbrellaMat);
  canopy.position.y = 0.62;
  const ribMat = new THREE.MeshStandardMaterial({ color: '#1b1e21', roughness: 0.35 });
  const shaftGeo = new THREE.CylinderGeometry(0.016, 0.016, 1.55, 6);
  shaftGeo.translate(0, 0.66, 0);
  const shaft = new THREE.Mesh(shaftGeo, ribMat);
  const hookGeo = new THREE.TorusGeometry(0.075, 0.02, 5, 12, Math.PI);
  const hook = new THREE.Mesh(hookGeo, ribMat);
  hook.rotation.z = Math.PI;
  hook.position.set(0.075, -0.1, 0);
  umbrella.add(canopy, shaft, hook);
  // lean it on the bench seat, canopy tipped toward the path and the camera so its dome reads in profile
  umbrella.position.set(ANCHOR.bench.x - 0.5, Y + 0.12, ANCHOR.bench.z + 0.6);
  umbrella.rotation.set(0.3, 0.2, 0.85);
  group.add(umbrella);
  disposables.push(umbrellaMat, canopyGeo, ribMat, shaftGeo, hookGeo);

  // ---------------- the letter: folded washi sheet pinned under the arcade, catching the sconce light
  const letterMat = new THREE.MeshLambertMaterial({ color: '#f3ecdc', emissive: '#3a2a14', side: THREE.DoubleSide });
  const lg = new THREE.PlaneGeometry(0.6, 0.78, 2, 1);
  const lp = lg.getAttribute('position');
  for (let i = 0; i < lp.count; i++) lp.setZ(i, Math.abs(lp.getX(i)) < 0.01 ? 0.025 : 0); // centre fold
  lg.computeVertexNormals();
  const letter = new THREE.Mesh(lg, letterMat);
  letter.position.set(ANCHOR.letter.x, ANCHOR.letter.y, ANCHOR.letter.z);
  letter.rotation.z = 0.04;
  group.add(letter);
  const sealGeo = new THREE.CircleGeometry(0.048, 12);
  const sealMat = new THREE.MeshBasicMaterial({ color: '#8f2a22' });
  const seal = new THREE.Mesh(sealGeo, sealMat);
  seal.position.set(0, 0.27, 0.03);
  letter.add(seal);
  disposables.push(letterMat, lg, sealGeo, sealMat);

  void mobile;
  return {
    group,
    umbrella,
    umbrellaMat,
    letter,
    letterMat,
    lampGlows,
    setSeason(snow, glow) {
      snowU.value = snow;
      winU.uGlow.value = glow;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}
