// Material families for the Jiangnan water town (world bible: whitewash, black tile, dark timber, grey stone).
// One material per family, shared by every building, so the whole town draws in a handful of calls.
// UVs are world metres (builder.ts), so the procedural detail has a real size: tile channels 0.22 m,
// grime rising 0.9 m from the waterline, rain streaks hanging from the eaves.
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from '../../systems/noise';

type THREE = typeof THREE_NS;

export interface TownMaterials {
  wall: THREE_NS.MeshStandardMaterial;
  tile: THREE_NS.MeshStandardMaterial;
  under: THREE_NS.MeshStandardMaterial;
  timber: THREE_NS.MeshStandardMaterial;
  stone: THREE_NS.MeshStandardMaterial;
  hole: THREE_NS.MeshBasicMaterial;
  foliage: THREE_NS.MeshStandardMaterial;
  /** Willow fronds: alpha-tested leaf cards (u across the frond, v from the limb (0) to the tip (1)). */
  frond: THREE_NS.MeshStandardMaterial;
  window: THREE_NS.MeshStandardMaterial;
  textures: THREE_NS.Texture[];
  dispose(): void;
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

/** Black tile: convex tile columns running down the slope (u = along ridge, 1 m per repeat), faint courses. */
function tileTexture(THREE: THREE) {
  const S = 128;
  const { c, g } = canvas(S);
  const cols = 4.5; // channels per metre ≈ 0.22 m
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * cols;
      const f = u - Math.floor(u);
      // rounded tile profile: bright crest, dark gutter
      const crest = Math.sin(f * Math.PI);
      const course = (y / S) * 5; // tile courses down the slope
      const cf = course - Math.floor(course);
      const lap = cf < 0.12 ? 0.72 + cf * 2.3 : 1;
      const jitter = 0.92 + 0.16 * Math.sin(Math.floor(u) * 12.9 + Math.floor(course) * 78.2);
      const v = Math.max(0, Math.min(255, (0.28 + 0.72 * Math.pow(crest, 0.7)) * lap * jitter * 255));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Lattice window (ice-ray / grid) as an emissive mask: paper glows, mullions hold it back. */
function latticeTexture(THREE: THREE) {
  const S = 128;
  const { c, g } = canvas(S);
  g.fillStyle = '#fff3dc';
  g.fillRect(0, 0, S, S);
  // paper unevenness
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(160,110,60,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * S, Math.random() * S, 6 + Math.random() * 18, 2 + Math.random() * 10);
  }
  g.strokeStyle = '#1a120d';
  g.lineWidth = 3;
  const n = 5;
  for (let i = 1; i < n; i++) {
    const p = (i / n) * S;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  g.lineWidth = 2;
  // inner diamonds: a quieter lattice inside the grid
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = (i + 0.5) * (S / n), y = (j + 0.5) * (S / n), r = S / n / 2.6;
      if ((i + j) % 2) continue;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r, y);
      g.closePath();
      g.stroke();
    }
  g.lineWidth = 8;
  g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** World-space weathering for whitewash and stone: damp plinth at the waterline, rain streaks, mottling. */
function weather(mat: THREE_NS.MeshStandardMaterial, key: string, kind: 'wall' | 'stone') {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const body =
      kind === 'wall'
        ? /* glsl */ `
        {
          float hz = vWP.x * 0.83 + vWP.z * 1.17;
          // damp, greenish plinth rising from the quay (y = 0.8): a wavy tide line ~0.5-1.1 m up the wall
          float tide = 1.3 + 0.55 * fbm(vec2(hz * 0.9, 1.3), 3);
          float damp = 1.0 - smoothstep(tide - 0.35, tide + 0.18, vWP.y);
          // rain streaks hanging from the eaves: long vertical noise, only in the upper wall
          float streak = smoothstep(0.5, 0.8, fbm(vec2(hz * 3.1, vWP.y * 0.12), 4)) * smoothstep(1.6, 4.2, vWP.y);
          // lime-wash: broad mottling plus flaked patches where the grey render shows through
          float mott = fbm(vec2(hz * 0.35, vWP.y * 0.5) + 4.0, 4);
          float flake = smoothstep(0.58, 0.74, fbm(vec2(hz * 0.7, vWP.y * 0.9) + 11.0, 4));
          vec3 c = diffuseColor.rgb;
          c *= 0.84 + 0.22 * mott;
          c = mix(c, c * vec3(0.76, 0.77, 0.74), flake * 0.7);
          c = mix(c, c * vec3(0.58, 0.6, 0.56), streak * 0.65);
          c = mix(c, vec3(0.26, 0.3, 0.26), damp * 0.85);
          // grime gathers low on the wall
          c *= 0.8 + 0.2 * smoothstep(0.8, 3.6, vWP.y);
          diffuseColor.rgb = c;
        }`
        : /* glsl */ `
        {
          float hz = vWP.x * 0.83 + vWP.z * 1.17;
          float n = fbm(vec2(hz * 1.7, vWP.y * 1.7), 4);
          float blocks = step(0.94, fract(vWP.y * 2.2)) + step(0.97, fract(hz * 1.1 + floor(vWP.y * 2.2) * 0.5));
          vec3 c = diffuseColor.rgb * (0.78 + 0.36 * n) * (1.0 - 0.28 * clamp(blocks, 0.0, 1.0));
          float wet = 1.0 - smoothstep(0.1, 0.6, vWP.y);
          c = mix(c, c * vec3(0.55, 0.62, 0.58), wet);
          diffuseColor.rgb = c;
        }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`);
  };
  mat.customProgramCacheKey = () => key;
}

/** A willow frond: a thin stem with narrow lanceolate leaves alternating down it, tapering to the tip. Grey
 *  values vary per leaf (the material colour tints them); alpha carries the silhouette for alphaTest. */
function frondTexture(THREE: THREE) {
  const W = 64, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // canvas top = v 1 = the tip (CanvasTexture flips Y)
  g.strokeStyle = 'rgba(190,190,170,1)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 4);
  g.stroke();
  for (let y = H - 6, k = 0; y > 6; y -= 7 + r() * 4, k++) {
    const taper = 0.45 + 0.55 * (y / H); // leaves shrink toward the tip
    const side = k % 2 ? 1 : -1;
    const len = (22 + r() * 8) * taper, wid = (4.2 + r() * 1.8) * taper;
    const a = side * (0.5 + r() * 0.25) + Math.PI / 2; // leaves hang down and out from the stem
    const v = Math.round(185 + r() * 70);
    g.fillStyle = `rgb(${v},${v},${Math.round(v * 0.92)})`;
    g.save();
    g.translate(W / 2 + side * 1.5, y);
    g.rotate(a);
    g.beginPath();
    g.ellipse(len / 2, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createTownMaterials(THREE: THREE): TownMaterials {
  const tileTex = tileTexture(THREE);
  const tileMap = tileTex.clone();
  tileMap.colorSpace = THREE.SRGBColorSpace;
  tileMap.needsUpdate = true;
  const lattice = latticeTexture(THREE);

  const wall = new THREE.MeshStandardMaterial({ color: '#f4f0e4', roughness: 0.96, metalness: 0 });
  weather(wall, 'jy-wall-2', 'wall');
  const stone = new THREE.MeshStandardMaterial({ color: '#8e8f86', roughness: 0.9, metalness: 0 });
  weather(stone, 'jy-stone', 'stone');
  const tile = new THREE.MeshStandardMaterial({
    color: '#4a4d50',
    map: tileMap,
    bumpMap: tileTex,
    bumpScale: 2.2,
    roughness: 0.62,
    metalness: 0.05,
  });
  const under = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.9, side: THREE.DoubleSide });
  const timber = new THREE.MeshStandardMaterial({ color: '#4a3226', roughness: 0.78 });
  const hole = new THREE.MeshBasicMaterial({ color: '#15181a' });
  const foliage = new THREE.MeshStandardMaterial({ color: '#7f9465', roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const frondTex = frondTexture(THREE);
  const frond = new THREE.MeshStandardMaterial({
    color: '#8ea06f',
    map: frondTex,
    alphaTest: 0.42,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const window = new THREE.MeshStandardMaterial({
    color: '#2a1d14',
    emissive: new THREE.Color('#ffb35c'),
    emissiveMap: lattice,
    emissiveIntensity: 2.2,
    roughness: 0.9,
  });

  const mats = [wall, tile, under, timber, stone, hole, foliage, frond, window];
  return {
    wall,
    tile,
    under,
    timber,
    stone,
    hole,
    foliage,
    frond,
    window,
    textures: [tileTex, tileMap, lattice, frondTex],
    dispose() {
      mats.forEach((m) => m.dispose());
      [tileTex, tileMap, lattice, frondTex].forEach((t) => t.dispose());
    },
  };
}
