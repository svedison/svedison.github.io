// The eight shelf artifacts (SPEC §6), one per RESUME entry, built at true scale in metres.
// Each builder returns a pivot group centred on its own bounding box, so it turns about what you see,
// plus optional hooks the inspect view uses (a disc to spin, a drawer to slide, a per-frame animation).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArtifactId } from '../../../content/resume';
import { chamferBox, F0, mergeStatic, metalMat, SPECIES, woodMat } from './materials';

export interface ArtifactBuild {
  id: ArtifactId;
  /** Pivot group: children are centred on the piece's bounding-box centre. */
  root: THREE.Group;
  /** Bounding radius about the pivot (m), for fitting in the hand. */
  radius: number;
  /** Half height of the bounding box: the pivot sits this far above the shelf. */
  halfH: number;
  /** Half extents for the hit proxy and the contact pool. */
  half: THREE.Vector3;
  /** Yaw on the bench (rad): a three-quarter view. */
  yaw: number;
  /** Extra lean back toward the wall (rad, about x), e.g. the record. */
  tilt?: number;
  /** Lean back against the wall: z offset of the pivot (m). */
  z?: number;
  /** Drag spins this object about its own z axis instead of turning the whole piece (golden record). */
  spin?: THREE.Object3D;
  /** Toolbox drawer: slides along +z by `open` (m). */
  drawer?: THREE.Object3D;
  /** Per-frame animation (time in s, chapter t, lift amount 0..1). Returns true if anything moved. */
  animate?(time: number, t: number, lift: number, reduced: boolean): boolean;
  dispose(): void;
}

interface Kit {
  field: THREE.Texture;
  env: THREE.Texture;
  isMobile: boolean;
}

/** Small pieces: rings at the scale of the tree they came from (3d-wood-material, macro). */
const FINE = 3.2;

const disposeAll = (root: THREE.Object3D, extra: { dispose(): void }[] = []) => () => {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats)
      if (!seen.has(mat)) {
        seen.add(mat);
        mat.dispose();
      }
  });
  extra.forEach((e) => e.dispose());
};

const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true) => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
};

/** Centre the children of `inner` on their bounding box, wrap in a pivot group, measure. */
function finish(
  id: ArtifactId,
  inner: THREE.Group,
  yaw: number,
  extra: Partial<ArtifactBuild> = {},
  disposables: { dispose(): void }[] = [],
  skip: THREE.Object3D[] = [],
): ArtifactBuild {
  mergeStatic(inner, new Set(skip)); // one draw call per material (SPEC §12.4 draw-call budget)
  inner.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(inner);
  const c = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  inner.position.sub(c);
  const root = new THREE.Group();
  root.name = id;
  root.add(inner);
  // radius about the centre, from the actual vertices
  let radius = 0;
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const P = m.geometry.attributes.position as THREE.BufferAttribute;
    if ((m as THREE.InstancedMesh).isInstancedMesh) {
      radius = Math.max(radius, size.length() / 2);
      return;
    }
    const step = Math.max(1, Math.floor(P.count / 400));
    for (let i = 0; i < P.count; i += step) {
      v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
      radius = Math.max(radius, v.length());
    }
  });
  return {
    id,
    root,
    radius: Math.max(radius, 0.05),
    halfH: size.y / 2,
    half: size.clone().multiplyScalar(0.5),
    yaw,
    dispose: disposeAll(root, disposables),
    ...extra,
  };
}

/* ------------------------------------------------------------------------------ 1. golden record */
function goldenRecord(k: Kit): ArtifactBuild {
  const R = 0.15,
    H = 0.0024,
    HOLE = 0.0036;
  // lathe: u runs round the disc, so the derivative tangent is circumferential (anisotropy follows it)
  const prof = [
    new THREE.Vector2(HOLE, -H / 2),
    new THREE.Vector2(R - 0.001, -H / 2),
    new THREE.Vector2(R, -H / 4),
    new THREE.Vector2(R, H / 4),
    new THREE.Vector2(R - 0.001, H / 2),
    new THREE.Vector2(HOLE, H / 2),
  ];
  const discG = new THREE.LatheGeometry(prof, k.isMobile ? 120 : 192);
  discG.rotateX(Math.PI / 2); // axis now z: the face looks at +z
  // a true circumferential tangent per vertex: interpolated across each slice, so the anisotropic highlight is a
  // smooth arc instead of flat pie-slice wedges (the uv-derivative frame is constant per triangle)
  {
    const P = discG.attributes.position as THREE.BufferAttribute;
    const tg = new Float32Array(P.count * 4);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i),
        y = P.getY(i);
      const l = Math.hypot(x, y) || 1;
      tg[i * 4] = -y / l;
      tg[i * 4 + 1] = x / l;
      tg[i * 4 + 3] = 1;
    }
    discG.setAttribute('tangent', new THREE.BufferAttribute(tg, 4));
  }
  const gold = metalMat(k.env, F0.gold, { rough: 0.15, env: 1.05, smear: 0.08, scratch: 0.1 });
  gold.anisotropy = 0.38;
  gold.anisotropyRotation = Math.PI / 2; // stretched across the grooves: the radial sheen of a pressed disc
  const prev = gold.onBeforeCompile;
  gold.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    // grooves: tracks with smooth gaps between them, fine rings faded by their own footprint
    sh.fragmentShader = sh.fragmentShader.replace(
      'diffuseColor.rgb = mix(diffuseColor.rgb, uTarnishCol, pat);',
      `diffuseColor.rgb = mix(diffuseColor.rgb, uTarnishCol, pat);
       float rr = length(vMP.xy);
       float face = step(0.5, abs(normalize(vMN).z));
       float gp = rr * 5200.0; float gpx = fwidth(gp);
       float fine = (0.5 + 0.5 * sin(gp)) * (1.0 - smoothstep(0.3, 1.2, gpx));
       float gaps = 0.0;
       for (int i = 0; i < 5; i++) { float c = 0.074 + float(i) * 0.0158; gaps += 1.0 - smoothstep(0.0004, 0.0011, abs(rr - c)); }
       float lead = smoothstep(0.052, 0.056, rr) * (1.0 - smoothstep(0.062, 0.064, rr));
       float grooved = smoothstep(0.063, 0.065, rr) * (1.0 - smoothstep(0.146, 0.148, rr));
       float ramp = smoothstep(0.06, 0.15, rr) * 0.07;   /* the outer grooves are a little more worn */
       roughnessFactor = mix(roughnessFactor, clamp(0.15 + ramp + fine * 0.1 - gaps * 0.08, 0.04, 1.0) * grooved + (1.0 - grooved) * mix(0.1, 0.22, lead), face);
       diffuseColor.rgb *= mix(1.0, 0.86 + 0.14 * (1.0 - gaps), face * grooved);`,
    );
  };
  gold.customProgramCacheKey = () => 'ws-record';
  const disc = mesh(discG, gold);
  // the label: matte cream paper with a printed gold ring, very slightly proud of the vinyl
  const lc = document.createElement('canvas');
  lc.width = lc.height = 256;
  const g = lc.getContext('2d')!;
  g.fillStyle = '#e9dcc2';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#a87a2c';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(128, 128, 100, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(80,52,20,0.55)';
  for (let i = 0; i < 3; i++) g.fillRect(70, 150 + i * 14, 116 - i * 22, 3);
  const labelTex = new THREE.CanvasTexture(lc);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.8 });
  const labelG = new THREE.RingGeometry(HOLE, 0.05, 64, 1);
  const front = mesh(labelG, labelMat, 0, 0, H / 2 + 0.0002, false);
  const back = mesh(labelG, labelMat, 0, 0, -H / 2 - 0.0002, false);
  back.rotation.y = Math.PI;
  const spin = new THREE.Group();
  spin.add(disc, front, back);
  const inner = new THREE.Group();
  inner.add(spin);
  const b = finish('golden-record', inner, -0.22, { spin }, [labelTex], [spin]);
  b.tilt = -0.2;
  b.z = -0.1;
  return b;
}

/* --------------------------------------------------------------------------------- 2. cargo truck */
function cargoTruck(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const pale = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.hinoki, seed: 21, axis: 0, grain: 3.2, ringFreq: 30 });
  const dark = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.walnut, seed: 22, axis: 0, grain: 3 });
  const crateW = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.sugi, seed: 23, axis: 0, grain: 3.4, oil: false });
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x3f6f68, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  paint.envMap = k.env;
  paint.envMapIntensity = 0.5;
  // chassis
  inner.add(mesh(chamferBox(0.25, 0.022, 0.1), dark, 0, 0.036, 0));
  // cab + bonnet (painted, generously rounded like a turned toy), windows inset dark in painted frames
  inner.add(mesh(chamferBox(0.072, 0.074, 0.098, 0.009), paint, -0.075, 0.084, 0));
  inner.add(mesh(chamferBox(0.078, 0.007, 0.104, 0.003), paint, -0.075, 0.1225, 0)); // roof lip
  inner.add(mesh(chamferBox(0.05, 0.04, 0.092, 0.0095), paint, -0.128, 0.066, 0));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1215, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 });
  glass.envMap = k.env;
  glass.envMapIntensity = 1.2;
  inner.add(mesh(chamferBox(0.046, 0.032, 0.1, 0.002), glass, -0.072, 0.098, 0, false));
  inner.add(mesh(chamferBox(0.004, 0.03, 0.082, 0.0015), glass, -0.1115, 0.098, 0, false));
  const trim = new THREE.MeshPhysicalMaterial({ color: 0x2c524c, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.45 });
  trim.envMap = k.env;
  trim.envMapIntensity = 0.5;
  for (const s of [-1, 1]) {
    // side window frame: sill, header and two pillars, just proud of the glass
    const z = s * 0.0508;
    inner.add(mesh(chamferBox(0.054, 0.0045, 0.0026, 0.001), trim, -0.072, 0.1155, z, false));
    inner.add(mesh(chamferBox(0.054, 0.0045, 0.0026, 0.001), trim, -0.072, 0.0805, z, false));
    inner.add(mesh(chamferBox(0.0045, 0.039, 0.0026, 0.001), trim, -0.0965, 0.098, z, false));
    inner.add(mesh(chamferBox(0.0045, 0.039, 0.0026, 0.001), trim, -0.0475, 0.098, z, false));
    // windscreen pillars
    inner.add(mesh(chamferBox(0.003, 0.038, 0.0045, 0.001), trim, -0.1138, 0.098, s * 0.0425, false));
  }
  inner.add(mesh(chamferBox(0.003, 0.0045, 0.089, 0.001), trim, -0.1138, 0.1155, 0, false));
  inner.add(mesh(chamferBox(0.003, 0.0045, 0.089, 0.001), trim, -0.1138, 0.0805, 0, false));
  // the face: two lamps, a grille of three steel bars and a bumper
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xf1e2bd, roughness: 0.25, emissive: 0x5a3c12, emissiveIntensity: 0.5 });
  const lampG = new THREE.CylinderGeometry(0.0062, 0.0068, 0.004, 20);
  lampG.rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) inner.add(mesh(lampG, lampMat, -0.1535, 0.072, s * 0.031, false));
  // flatbed and crate
  inner.add(mesh(chamferBox(0.13, 0.012, 0.1), pale, 0.055, 0.053, 0));
  const slats = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const y = 0.068 + i * 0.019;
    slats.add(mesh(chamferBox(0.11, 0.016, 0.004, 0.0015), crateW, 0, y, 0.043));
    slats.add(mesh(chamferBox(0.11, 0.016, 0.004, 0.0015), crateW, 0, y, -0.043));
    slats.add(mesh(chamferBox(0.004, 0.016, 0.082, 0.0015), crateW, 0.053, y, 0));
    slats.add(mesh(chamferBox(0.004, 0.016, 0.082, 0.0015), crateW, -0.053, y, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) slats.add(mesh(chamferBox(0.01, 0.078, 0.01, 0.002), dark, sx * 0.052, 0.098, sz * 0.042));
  slats.position.x = 0.058;
  inner.add(slats);
  // wheels: turned walnut with a rounded tread and a dished face, steel axle caps
  const wp: THREE.Vector2[] = [new THREE.Vector2(0.0001, -0.0065), new THREE.Vector2(0.016, -0.0065), new THREE.Vector2(0.0175, -0.008)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI;
    wp.push(new THREE.Vector2(0.0205 + Math.cos(a) * 0.0035, Math.sin(a) * 0.008));
  }
  wp.push(new THREE.Vector2(0.0175, 0.008), new THREE.Vector2(0.016, 0.0065), new THREE.Vector2(0.0001, 0.0065));
  const wheelG = new THREE.LatheGeometry(wp, 32);
  wheelG.rotateX(Math.PI / 2);
  const capG = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 16);
  capG.rotateX(Math.PI / 2);
  const steel = metalMat(k.env, F0.steel, { rough: 0.3, env: 0.8 });
  for (let i = 0; i < 3; i++) inner.add(mesh(chamferBox(0.0016, 0.0022, 0.05, 0.0006), steel, -0.1532, 0.058 + i * 0.0048, 0, false));
  inner.add(mesh(chamferBox(0.007, 0.009, 0.104, 0.0025), steel, -0.1545, 0.046, 0));
  for (const x of [-0.105, 0.07]) {
    for (const s of [-1, 1]) {
      inner.add(mesh(wheelG, dark, x, 0.024, s * 0.055));
      inner.add(mesh(capG, steel, x, 0.024, s * 0.0645, false));
    }
  }
  return finish('cargo-truck', inner, 0.5);
}

/* ---------------------------------------------------------------------------------- 3. brass lens */
function brassLens(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const brass = metalMat(k.env, F0.brass, { rough: 0.2, env: 1.0, smear: 0.14, scratch: 0.2, tarnish: 0.35 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.78 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1418, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
  lensMat.envMap = k.env;
  lensMat.envMapIntensity = 1.3;
  const seg = k.isMobile ? 24 : 36;
  const tube = (r0: number, r1: number, len: number, x: number, mat: THREE.Material) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    g.rotateZ(-Math.PI / 2); // axis along x, r0 at -x
    inner.add(mesh(g, mat, x + len / 2, 0, 0));
  };
  // objective end at -x, eyepiece at +x
  tube(0.024, 0.024, 0.016, -0.15, brass); // dew cap ring
  tube(0.022, 0.022, 0.11, -0.134, brass);
  tube(0.0225, 0.0225, 0.07, -0.115, leather); // leather grip over the main barrel
  tube(0.0235, 0.0235, 0.008, -0.03, brass); // collar
  tube(0.018, 0.018, 0.075, -0.022, brass);
  tube(0.0195, 0.0195, 0.006, 0.05, brass);
  tube(0.0145, 0.0145, 0.06, 0.053, brass);
  tube(0.016, 0.016, 0.006, 0.11, brass);
  tube(0.012, 0.0105, 0.03, 0.113, brass); // eyepiece
  const lensG = new THREE.CircleGeometry(0.0205, seg);
  lensG.rotateY(-Math.PI / 2);
  inner.add(mesh(lensG, lensMat, -0.149, 0, 0, false));
  // the wooden cradle it rests on: two V blocks
  const wood = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.keyaki, seed: 31, axis: 2, grain: 3 });
  for (const x of [-0.09, 0.04]) {
    const blk = mesh(chamferBox(0.022, 0.018, 0.06, 0.002), wood, x, -0.0245 - 0.009, 0);
    inner.add(blk);
  }
  const b = finish('brass-lens', inner, -0.35);
  return b;
}

/* --------------------------------------------------------------------------------- 4. wheat sheaf */
function wheatSheaf(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const N = k.isMobile ? 26 : 38;
  const rnd = mulberry(7);
  const straw = new THREE.MeshStandardMaterial({ color: 0xc7a159, roughness: 0.62 });
  const ear = new THREE.MeshStandardMaterial({ color: 0xd2a650, roughness: 0.55 });
  const stalkG = new THREE.CylinderGeometry(0.0014, 0.0018, 1, 5, 1);
  stalkG.translate(0, 0.5, 0);
  const earG = new THREE.SphereGeometry(1, 7, 6);
  earG.translate(0, 1, 0);
  const stalks = new THREE.InstancedMesh(stalkG, straw, N);
  const ears = new THREE.InstancedMesh(earG, ear, N);
  // phones: the sheaf's soft wall shadow read as a blurred double at that scale; the contact pool grounds it there
  stalks.castShadow = ears.castShadow = !k.isMobile;
  stalks.receiveShadow = ears.receiveShadow = true;
  const Hh = 0.235;
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    a = new THREE.Vector3(),
    bTop = new THREE.Vector3(),
    dir = new THREE.Vector3(),
    s = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2 + rnd() * 0.5;
    const rb = 0.018 + rnd() * 0.016,
      rt = 0.03 + rnd() * 0.03;
    const h = Hh * (0.86 + rnd() * 0.16);
    a.set(Math.cos(th) * rb, 0, Math.sin(th) * rb);
    bTop.set(-Math.cos(th + (rnd() - 0.5) * 0.4) * rt, h, -Math.sin(th + (rnd() - 0.5) * 0.4) * rt);
    dir.subVectors(bTop, a);
    const len = dir.length();
    dir.normalize();
    q.setFromUnitVectors(up, dir);
    m4.compose(a, q, s.set(1, len, 1));
    stalks.setMatrixAt(i, m4);
    // the ear continues the stalk, nodding outward a little
    dir.x *= 1.35;
    dir.z *= 1.35;
    dir.normalize();
    q.setFromUnitVectors(up, dir);
    m4.compose(bTop, q, s.set(0.0052, 0.021 + rnd() * 0.006, 0.0052));
    ears.setMatrixAt(i, m4);
  }
  inner.add(stalks, ears);
  // twine at the waist (where the stalks cross)
  const twine = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
  const tw = mesh(new THREE.TorusGeometry(0.0085, 0.0022, 6, 20), twine, 0, 0.093, 0);
  tw.rotation.x = Math.PI / 2;
  inner.add(tw);
  const tw2 = mesh(new THREE.TorusGeometry(0.0088, 0.0018, 6, 20), twine, 0, 0.099, 0);
  tw2.rotation.x = Math.PI / 2;
  inner.add(tw2);
  // the tiny rain cloud above it
  const parts: THREE.BufferGeometry[] = [];
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.032],
    [0.032, -0.006, 0.004, 0.024],
    [-0.033, -0.007, -0.002, 0.025],
    [0.012, 0.014, -0.006, 0.026],
    [-0.014, 0.01, 0.01, 0.022],
    [0.052, -0.012, 0, 0.016],
    [-0.052, -0.013, 0.004, 0.016],
    [0.0, -0.012, 0.018, 0.02],
  ];
  for (const [x, y, z, r] of puffs) {
    const sg = new THREE.SphereGeometry(r, 14, 10);
    sg.translate(x, y, z);
    parts.push(sg);
  }
  const cloudG = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  cloudG.scale(0.85, 0.7, 0.7);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0x7d8792, roughness: 1, emissive: 0x161c24, emissiveIntensity: 0.6 });
  const cloud = new THREE.Mesh(cloudG, cloudMat);
  cloud.castShadow = false;
  cloud.receiveShadow = false;
  const CY = Hh + 0.095;
  cloud.position.set(0, CY, 0);
  inner.add(cloud);
  // rain: short streaks from the cloud's belly to the ears, recycled on the CPU (10 instances)
  const NR = 12;
  const dropG = new THREE.BoxGeometry(0.0007, 0.014, 0.0007);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xc9d8e4, transparent: true, opacity: 0.8, depthWrite: false });
  const drops = new THREE.InstancedMesh(dropG, dropMat, NR);
  drops.castShadow = false;
  drops.frustumCulled = false;
  const seeds = Array.from({ length: NR }, () => [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.035, rnd()]);
  const top = CY - 0.02,
    bottom = Hh - 0.005;
  const place = (time: number) => {
    for (let i = 0; i < NR; i++) {
      const [x, z, ph] = seeds[i];
      const f = (time * 1.6 + ph) % 1;
      m4.makeTranslation(x, top - f * (top - bottom), z);
      drops.setMatrixAt(i, m4);
    }
    drops.instanceMatrix.needsUpdate = true;
  };
  place(0.37);
  inner.add(drops);
  const b = finish('wheat-sheaf', inner, 0.2, {}, [], [cloud, drops]);
  b.animate = (time, _t, _lift, reduced) => {
    if (reduced) return false;
    cloud.position.y = CY + Math.sin(time * 0.9) * 0.003;
    place(time);
    return true;
  };
  return b;
}

/* --------------------------------------------------------------------------------- 5. pudding cup */
function puddingCup(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const seg = k.isMobile ? 40 : 64;
  const prof = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.027, 0.0),
    new THREE.Vector2(0.03, 0.002),
    new THREE.Vector2(0.0405, 0.06),
    new THREE.Vector2(0.0412, 0.0628),
    new THREE.Vector2(0.0398, 0.0636),
    new THREE.Vector2(0.038, 0.062),
    new THREE.Vector2(0.0285, 0.006),
    new THREE.Vector2(0.0, 0.006),
  ];
  const cupG = new THREE.LatheGeometry(prof, seg);
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf1ebe0, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  ceramic.envMap = k.env;
  ceramic.envMapIntensity = 0.7;
  inner.add(mesh(cupG, ceramic));
  // custard, slightly domed, with a glossy caramel pool on top
  const custardG = new THREE.SphereGeometry(0.0378, seg, 6, 0, Math.PI * 2, 0, 0.42);
  custardG.scale(1, 0.25, 1);
  const custard = new THREE.MeshPhysicalMaterial({ color: 0xeac46e, roughness: 0.42, sheen: 0.4, sheenColor: new THREE.Color(0xfff0c0) });
  custard.envMap = k.env;
  custard.envMapIntensity = 0.5;
  const cu = mesh(custardG, custard, 0, 0.0523, 0, false);
  inner.add(cu);
  const caraG = new THREE.CircleGeometry(0.023, 40);
  const P = caraG.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < P.count; i++) {
    const x = P.getX(i),
      y = P.getY(i);
    const an = Math.atan2(y, x);
    const f = 1 + 0.12 * Math.sin(an * 3 + 0.6) + 0.07 * Math.sin(an * 7 + 2.1);
    P.setXY(i, x * f, y * f);
  }
  caraG.rotateX(-Math.PI / 2);
  const caramel = new THREE.MeshPhysicalMaterial({ color: 0x5a2a0c, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  caramel.envMap = k.env;
  caramel.envMapIntensity = 1.1;
  inner.add(mesh(caraG, caramel, 0, 0.0618, 0, false));
  // the paw print on the front of the cup: one pad, four toes, following the wall's curve and slope
  const pawMat = new THREE.MeshStandardMaterial({ color: 0x8a5232, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
  const slope = Math.atan2(0.0105, 0.058);
  const rAt = (y: number) => 0.03 + ((y - 0.002) / 0.058) * 0.0105;
  const stamp = (x: number, y: number, rx: number, ry: number) => {
    const g = new THREE.CircleGeometry(1, 20);
    g.scale(rx, ry, 1);
    const r = rAt(y);
    const m = mesh(g, pawMat, x, y, Math.sqrt(Math.max(0, r * r - x * x)) + 0.0004, false);
    m.rotation.order = 'YXZ';
    m.rotation.y = Math.asin(x / r);
    m.rotation.x = -slope;
    inner.add(m);
  };
  stamp(0, 0.026, 0.0082, 0.0068);
  stamp(-0.0105, 0.036, 0.0033, 0.0039);
  stamp(-0.0037, 0.0405, 0.0034, 0.0041);
  stamp(0.0037, 0.0405, 0.0034, 0.0041);
  stamp(0.0105, 0.036, 0.0033, 0.0039);
  // a pulse for the keepsake pickup (additive halo, off until collected)
  const halo = haloSprite(0xf2a93b);
  halo.scale.setScalar(0.0001);
  halo.position.set(0, 0.035, 0);
  inner.add(halo);
  const b = finish('pudding-cup', inner, -0.28);
  let pulseAt = -1;
  (b as ArtifactBuild & { pulse: (time: number) => void }).pulse = (time: number) => {
    pulseAt = time;
  };
  b.animate = (time) => {
    if (pulseAt < 0) return false;
    const u = (time - pulseAt) / 1.4;
    if (u > 1) {
      pulseAt = -1;
      halo.scale.setScalar(0.0001);
      return true;
    }
    const e = Math.sin(Math.PI * Math.min(1, u)) * (1 - u * 0.3);
    halo.scale.setScalar(0.06 + u * 0.16);
    (halo.material as THREE.SpriteMaterial).opacity = e * 0.9;
    return true;
  };
  return b;
}

/* -------------------------------------------------------------------------------- 6. seed cloche */
function seedCloche(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const seg = k.isMobile ? 40 : 64;
  const base = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.walnut, seed: 61, axis: 0, grain: 3 });
  const baseG = new THREE.CylinderGeometry(0.07, 0.072, 0.016, seg, 1);
  inner.add(mesh(baseG, base, 0, 0.008, 0));
  const soil = new THREE.MeshStandardMaterial({ color: 0x24170e, roughness: 1 });
  const soilG = new THREE.SphereGeometry(0.036, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  soilG.scale(1, 0.32, 1);
  inner.add(mesh(soilG, soil, 0, 0.016, 0));
  const seedMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.5, emissive: 0x3a2008, emissiveIntensity: 0.6 });
  const seedG = new THREE.SphereGeometry(1, 12, 8);
  seedG.scale(0.0068, 0.0042, 0.0045);
  const seed = mesh(seedG, seedMat, 0.003, 0.0275, 0, false);
  seed.rotation.z = 0.5;
  inner.add(seed);
  // the sprout: a curved stem and two leaves, glowing faintly; it grows a little as you reach it
  const sprout = new THREE.Group();
  sprout.position.set(0.001, 0.028, 0);
  const green = new THREE.MeshStandardMaterial({ color: 0x9bc56a, roughness: 0.55, emissive: 0x6c9a34, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.004, 0.016, 0), new THREE.Vector3(0.002, 0.034, 0));
  const stem = mesh(new THREE.TubeGeometry(curve, 10, 0.0011, 5), green, 0, 0, 0, false);
  sprout.add(stem);
  const leafG = new THREE.CircleGeometry(1, 16);
  leafG.scale(0.0095, 0.0045, 1);
  leafG.translate(0.0095, 0, 0);
  for (const s of [-1, 1]) {
    const leaf = mesh(leafG, green, 0.002, 0.034, 0, false);
    leaf.rotation.set(-0.5, s > 0 ? 0.2 : Math.PI - 0.2, s * 0.35);
    sprout.add(leaf);
  }
  inner.add(sprout);
  const glow = haloSprite(0xd8e48a);
  glow.position.set(0, 0.06, 0);
  glow.scale.setScalar(0.13);
  (glow.material as THREE.SpriteMaterial).opacity = 0.32;
  inner.add(glow);
  // a small warm light kept under the glass: it lifts the soil and the walnut base, so the bell glows on the shelf
  const ember = haloSprite(0xffb867);
  ember.position.set(0, 0.024, 0.004);
  ember.scale.set(0.15, 0.07, 1);
  (ember.material as THREE.SpriteMaterial).opacity = 0.4;
  inner.add(ember);
  // the glass bell: fresnel-only additive shell (no transmission pass), plus a rim highlight
  const bell: THREE.Vector2[] = [];
  bell.push(new THREE.Vector2(0.06, 0.016));
  for (let i = 0; i <= 10; i++) bell.push(new THREE.Vector2(0.06, 0.016 + (i / 10) * 0.085));
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    bell.push(new THREE.Vector2(Math.cos(a) * 0.06, 0.101 + Math.sin(a) * 0.052));
  }
  const bellG = new THREE.LatheGeometry(bell, seg);
  const glassMat = glassMaterial();
  const glass = mesh(bellG, glassMat, 0, 0, 0, false);
  glass.renderOrder = 2;
  inner.add(glass);
  const knob = mesh(new THREE.SphereGeometry(0.009, 16, 12), glassMat, 0, 0.161, 0, false);
  knob.renderOrder = 2;
  inner.add(knob);
  const b = finish('seed-cloche', inner, 0, {}, [], [sprout, glow, ember]);
  b.animate = (time, t, _lift, reduced) => {
    // grows a little as the visitor reaches it (pure function of chapter progress); drawn at about 2.3x the
    // modelled size so the seedling reads as the shelf's quiet closer, not a few pixels under the glass
    const g = 0.7 + 0.3 * smooth(0.5, 0.8, t);
    sprout.scale.setScalar(2.3 * g);
    const br = reduced ? 1 : 0.85 + 0.15 * Math.sin(time * 1.3);
    (glow.material as THREE.SpriteMaterial).opacity = 0.34 * br * (0.6 + 0.4 * g);
    (ember.material as THREE.SpriteMaterial).opacity = 0.42 * (0.75 + 0.25 * br);
    return !reduced;
  };
  return b;
}

/* ------------------------------------------------------------------------------------ 7. diploma */
function diploma(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const seg = k.isMobile ? 28 : 40;
  const tubeMat = new THREE.MeshPhysicalMaterial({ color: 0x3a2238, roughness: 0.72, sheen: 0.3, sheenColor: new THREE.Color(0x6a4a68) });
  tubeMat.envMap = k.env;
  tubeMat.envMapIntensity = 0.4;
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0x1e121f, roughness: 0.32, clearcoat: 0.6 });
  capMat.envMap = k.env;
  capMat.envMapIntensity = 0.6;
  const tubeG = new THREE.CylinderGeometry(0.028, 0.028, 0.28, seg, 1, true);
  tubeG.rotateZ(Math.PI / 2);
  inner.add(mesh(tubeG, tubeMat));
  const capG = new THREE.CylinderGeometry(0.0298, 0.0298, 0.024, seg, 1);
  capG.rotateZ(Math.PI / 2);
  inner.add(mesh(capG, capMat, -0.14, 0, 0));
  inner.add(mesh(capG, capMat, 0.14, 0, 0));
  const brass = metalMat(k.env, F0.brass, { rough: 0.25, env: 0.9 });
  const rimG = new THREE.TorusGeometry(0.0296, 0.0012, 6, seg);
  rimG.rotateY(Math.PI / 2);
  for (const x of [-0.152, -0.128, 0.128, 0.152]) inner.add(mesh(rimG, brass, x, 0, 0, false));
  // satin ribbon: a band, a bow and two tails, in the lantern gold
  const satin = new THREE.MeshPhysicalMaterial({ color: 0xb98228, roughness: 0.38, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(0xffd590), side: THREE.DoubleSide });
  satin.envMap = k.env;
  satin.envMapIntensity = 0.6;
  const bandG = new THREE.CylinderGeometry(0.0293, 0.0293, 0.012, seg, 1, true);
  bandG.rotateZ(Math.PI / 2);
  inner.add(mesh(bandG, satin, 0.035, 0, 0));
  const loopG = new THREE.TorusGeometry(0.011, 0.0035, 6, 20);
  loopG.scale(1, 0.62, 0.3);
  for (const s of [-1, 1]) {
    const l = mesh(loopG, satin, 0.035 + s * 0.011, 0.012, 0.027);
    l.rotation.set(-0.45, 0, s * 0.35);
    inner.add(l);
  }
  inner.add(mesh(new THREE.SphereGeometry(0.0045, 10, 8), satin, 0.035, 0.012, 0.03));
  const tailG = new THREE.PlaneGeometry(0.009, 0.042, 1, 4);
  const TP = tailG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < TP.count; i++) TP.setZ(i, Math.pow((0.021 - TP.getY(i)) / 0.042, 2) * 0.012);
  tailG.computeVertexNormals();
  for (const s of [-1, 1]) {
    const tl = mesh(tailG, satin, 0.035 + s * 0.008, -0.008, 0.031, false);
    tl.rotation.set(0.15, 0, s * 0.25);
    inner.add(tl);
  }
  const b = finish('diploma', inner, 0.32);
  return b;
}

/* ------------------------------------------------------------------------------------ 8. toolbox */
function toolbox(k: Kit): ArtifactBuild {
  const inner = new THREE.Group();
  const body = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.keyaki, seed: 81, axis: 0, grain: 5, ringFreq: 30, offAxis: 1.6 });
  const side = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.keyaki, seed: 82, axis: 0, grain: 5, ringFreq: 30, offAxis: 1.8 });
  const pale = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.kuri, pale: 0x9a6c40, dark: 0x4a2c14, seed: 83, axis: 0, grain: 5, offAxis: 2.2 });
  const W = 0.21,
    D = 0.12;
  // drawer housing: bottom, top, two sides and a back, so the drawer really slides out of a cavity
  inner.add(mesh(chamferBox(W, 0.008, D), body, 0, 0.004, 0));
  inner.add(mesh(chamferBox(W, 0.008, D), body, 0, 0.054, 0));
  inner.add(mesh(chamferBox(0.008, 0.042, D), side, -W / 2 + 0.004, 0.029, 0));
  inner.add(mesh(chamferBox(0.008, 0.042, D), side, W / 2 - 0.004, 0.029, 0));
  inner.add(mesh(chamferBox(W - 0.016, 0.042, 0.006), body, 0, 0.029, -D / 2 + 0.003));
  // the drawer
  const drawer = new THREE.Group();
  const front = mesh(chamferBox(W - 0.018, 0.04, 0.009), pale, 0, 0.029, D / 2 - 0.0045);
  drawer.add(front);
  const dIn = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.hinoki, seed: 84, axis: 0, grain: 3, oil: false });
  drawer.add(mesh(chamferBox(W - 0.024, 0.004, D - 0.016), dIn, 0, 0.011, -0.004));
  drawer.add(mesh(chamferBox(0.004, 0.028, D - 0.016), dIn, -(W - 0.03) / 2, 0.023, -0.004));
  drawer.add(mesh(chamferBox(0.004, 0.028, D - 0.016), dIn, (W - 0.03) / 2, 0.023, -0.004));
  drawer.add(mesh(chamferBox(W - 0.026, 0.028, 0.004), dIn, 0, 0.023, -D / 2 + 0.006));
  const brass = metalMat(k.env, F0.brass, { rough: 0.22, env: 1.0, tarnish: 0.25 });
  drawer.add(mesh(new THREE.SphereGeometry(0.0055, 16, 12), brass, 0, 0.029, D / 2 + 0.004, false));
  // a steel rule and a few brass screws inside the drawer
  const steel = metalMat(k.env, F0.steel, { rough: 0.28, env: 0.8, scratch: 0.3 });
  drawer.add(mesh(chamferBox(0.15, 0.0012, 0.016, 0.0004), steel, -0.005, 0.0136, 0.01, false));
  for (let i = 0; i < 5; i++) {
    const sc = mesh(new THREE.CylinderGeometry(0.0022, 0.0006, 0.011, 8), brass, 0.03 + (i % 3) * 0.012, 0.0145, -0.025 + (i % 2) * 0.01, false);
    sc.rotation.z = Math.PI / 2;
    sc.rotation.y = i * 0.7;
    drawer.add(sc);
  }
  inner.add(drawer);
  // open tray above with a carry handle
  const TH = 0.05;
  inner.add(mesh(chamferBox(W, TH, 0.008), side, 0, 0.058 + TH / 2, D / 2 - 0.004));
  inner.add(mesh(chamferBox(W, TH, 0.008), side, 0, 0.058 + TH / 2, -D / 2 + 0.004));
  const endG = new THREE.Shape();
  endG.moveTo(-D / 2, 0);
  endG.lineTo(D / 2, 0);
  endG.lineTo(D / 2, TH);
  endG.lineTo(0.012, 0.095);
  endG.lineTo(-0.012, 0.095);
  endG.lineTo(-D / 2, TH);
  endG.closePath();
  const endGeo = new THREE.ExtrudeGeometry(endG, { depth: 0.009, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 2 });
  endGeo.rotateY(Math.PI / 2);
  for (const s of [-1, 1]) inner.add(mesh(endGeo, body, s * (W / 2) - (s > 0 ? 0.009 : 0), 0.058, 0));
  const dowelG = new THREE.CylinderGeometry(0.0055, 0.0055, W - 0.004, 20);
  dowelG.rotateZ(Math.PI / 2);
  inner.add(mesh(dowelG, pale, 0, 0.058 + 0.083, 0));
  // tools in the tray: a hammer, a screwdriver, a marking pencil
  const handle = woodMat(k.field, k.env, { fine: FINE, ...SPECIES.hinoki, seed: 85, axis: 0, grain: 4 });
  const hamH = new THREE.CylinderGeometry(0.0055, 0.0065, 0.17, 14);
  hamH.rotateZ(Math.PI / 2);
  inner.add(mesh(hamH, handle, 0.01, 0.105, 0.03));
  inner.add(mesh(chamferBox(0.016, 0.016, 0.06, 0.002), steel, -0.068, 0.105, 0.03));
  const sdH = new THREE.CylinderGeometry(0.0075, 0.0075, 0.06, 6);
  sdH.rotateZ(Math.PI / 2);
  const sdS = new THREE.CylinderGeometry(0.002, 0.002, 0.08, 8);
  sdS.rotateZ(Math.PI / 2);
  const amber = new THREE.MeshPhysicalMaterial({ color: 0x7a3a10, roughness: 0.25, clearcoat: 0.8 });
  amber.envMap = k.env;
  inner.add(mesh(sdH, amber, 0.055, 0.1, -0.028));
  inner.add(mesh(sdS, steel, -0.015, 0.1, -0.028));
  const b = finish('toolbox', inner, -0.42, { drawer }, [], [drawer]);
  return b;
}

/* ------------------------------------------------------------------------------------- helpers */

let haloTex: THREE.Texture | null = null;
function haloSprite(color: number): THREE.Sprite {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.SpriteMaterial({ map: haloTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.castShadow = false;
  return s;
}
export function disposeHaloTexture() {
  haloTex?.dispose();
  haloTex = null;
}

/** Fresnel glass shell: additive reflections of the lamp and the window, no transmission pass. */
function glassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float c = abs(dot(n, vV));
        float fr = 0.04 + 0.96 * pow(1.0 - c, 5.0);
        float rimL = pow(1.0 - c, 2.2) * 0.22; /* a broad rim so the bell's outline holds against the dark wall */
        vec3 L = normalize(vec3(-0.55, 0.72, 0.42));
        vec3 H = normalize(L + vV);
        float spec = pow(max(dot(n, H), 0.0), 220.0) * 6.0;
        vec3 W = normalize(vec3(0.1, 0.4, -1.0));
        vec3 R = reflect(-vV, n);
        float win = smoothstep(0.78, 0.9, dot(R, W));
        vec3 col = vec3(1.0, 0.82, 0.6) * spec + vec3(0.42, 0.55, 0.78) * (win * 0.7 + fr * 0.7) + vec3(0.95, 0.72, 0.48) * (fr * 0.24 + rimL);
        gl_FragColor = vec4(col * (gl_FrontFacing ? 1.0 : 0.45) * uFade, 1.0);
      }`,
  });
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export type ArtifactWithPulse = ArtifactBuild & { pulse?: (time: number) => void };

export function buildArtifacts(kit: Kit): ArtifactWithPulse[] {
  return [goldenRecord(kit), cargoTruck(kit), brassLens(kit), wheatSheaf(kit), puddingCup(kit), seedCloche(kit), diploma(kit), toolbox(kit)];
}
