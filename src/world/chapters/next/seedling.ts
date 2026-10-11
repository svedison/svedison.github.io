// The seed under glass (the well-being app): a bell cloche on a slate plinth over a clay dish of soil.
// Growth is a pure function of three scalars set by the chapter from scroll progress (reversible):
//   stem   0..1  the tapered stem is drawn ring by ring (drawRange), a bud rides the growing tip
//   leaves 0..1  two cotyledons unfold like a book and grow from 35% to full size
//   glow   0..1  a faint warm light gathers inside the glass
// The glass is a cheap Fresnel shader (sky reflection + sun glint + backlit rim), no transmission pass.
import type * as THREE_NS from 'three';
import type { SkyState } from '../../systems/sky';
import { smoothstep } from '../../systems/noise';

type THREE = typeof THREE_NS;

export interface Seedling {
  group: THREE_NS.Group;
  /** Invisible raycast proxy around the cloche. */
  proxy: THREE_NS.Mesh;
  /** World-space point at the heart of the plant (for glow / labels). */
  heart: THREE_NS.Vector3;
  setGrowth(stem: number, leaves: number, glow: number): void;
  setSky(s: SkyState): void;
  /** hover / pulse are 0..1 envelopes owned by the chapter. */
  update(time: number, hover: number, pulse: number): void;
  dispose(): void;
}

export const CLOCHE_HEIGHT = 0.456;
/** How deep the plinth is set into the sand: the chapter places the group this far below the beach surface. */
export const SAND_LOCAL = 0.032;
const STEM_RINGS = 44;
const STEM_SIDES = 8;

function radialTexture(THREE: THREE, stops: [number, string][], size = 64): THREE_NS.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => rg.addColorStop(o, col));
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cotyledon: length along +y, width along z, cupped toward -x (margins lift when the leaf lies open). */
function leafGeometry(THREE: THREE, len: number, wid: number): THREE_NS.BufferGeometry {
  const U = 12;
  const V = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    const w = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.96 + 0.04)), 0.7) * (1 - 0.12 * u) * (u < 0.08 ? u / 0.08 : 1);
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * 2 - 1;
      const z = v * wid * 0.5 * w;
      const cup = -(v * v) * wid * 0.32 * w; // margins up when open
      const droop = u * u * len * 0.18; // tip arches down
      const rib = -Math.abs(v) * wid * 0.04; // shallow midrib fold
      pos.push(cup + droop + rib, u * len, z);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + V + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createSeedling(THREE: THREE, opts: { reducedMotion: boolean }): Seedling {
  const group = new THREE.Group();
  group.name = 'seedling';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  // ---- slate plinth (flat, irregular) --------------------------------------------------------------------
  const plinthGeo = track(new THREE.CylinderGeometry(0.235, 0.255, 0.05, 13, 1));
  {
    const p = plinthGeo.attributes.position as THREE_NS.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.07 * Math.sin(a * 3 + 0.6) + 0.05 * Math.sin(a * 5 + 2.1);
      p.setX(i, x * k * 1.08);
      p.setZ(i, z * k * 0.92);
      if (p.getY(i) > 0) p.setY(i, 0.025 + 0.005 * Math.sin(a * 4));
    }
    plinthGeo.computeVertexNormals();
  }
  const plinthMat = track(new THREE.MeshStandardMaterial({ color: '#a08a7c', roughness: 0.78, flatShading: true }));
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.y = 0.025;
  group.add(plinth);
  const top = 0.05; // plinth top

  // ---- clay dish + soil ---------------------------------------------------------------------------------------
  const dishProfile = [
    [0.0, 0.0],
    [0.1, 0.0],
    [0.122, 0.006],
    [0.136, 0.03],
    [0.142, 0.044],
    [0.134, 0.046],
    [0.124, 0.03],
    [0.0, 0.026],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const dishGeo = track(new THREE.LatheGeometry(dishProfile, 32));
  const dishMat = track(new THREE.MeshStandardMaterial({ color: '#a7654a', roughness: 0.82 }));
  const dish = new THREE.Mesh(dishGeo, dishMat);
  dish.position.y = top;
  group.add(dish);

  const soilGeo = track(new THREE.SphereGeometry(0.126, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  {
    const p = soilGeo.attributes.position as THREE_NS.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(i, p.getY(i) + 0.012 * Math.sin(x * 70) * Math.cos(z * 60));
    }
    soilGeo.computeVertexNormals();
  }
  const soilMat = track(new THREE.MeshStandardMaterial({ color: '#3b2b21', roughness: 1 }));
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = top + 0.024;
  soil.scale.y = 0.16;
  group.add(soil);
  const soilTop = top + 0.024 + 0.126 * 0.16;

  // ---- seed ---------------------------------------------------------------------------------------------------
  const seedGeo = track(new THREE.SphereGeometry(0.02, 14, 10));
  const seedMat = track(new THREE.MeshStandardMaterial({ color: '#8d6a45', roughness: 0.55 }));
  const seed = new THREE.Mesh(seedGeo, seedMat);
  seed.scale.set(1, 0.62, 0.74);
  seed.position.set(0.018, soilTop + 0.006, 0.01);
  seed.rotation.set(0.2, 0.4, 0.35);
  group.add(seed);

  // ---- stem: tapered tube, rings ordered base → tip so drawRange grows it ---------------------------------------
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.006, 0.055, 0.003),
    new THREE.Vector3(-0.007, 0.115, -0.004),
    new THREE.Vector3(0.002, 0.17, 0.003),
    new THREE.Vector3(0.008, 0.205, 0.004),
  ]);
  const frames = curve.computeFrenetFrames(STEM_RINGS, false);
  const sPos: number[] = [];
  const sNor: number[] = [];
  const sIdx: number[] = [];
  const pt = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i <= STEM_RINGS; i++) {
    const u = i / STEM_RINGS;
    curve.getPointAt(u, pt);
    const r = 0.0068 * (1 - 0.4 * u) + 0.0012 * Math.exp(-u * 14);
    for (let j = 0; j < STEM_SIDES; j++) {
      const a = (j / STEM_SIDES) * Math.PI * 2;
      nrm
        .copy(frames.normals[i])
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a))
        .normalize();
      sPos.push(pt.x + nrm.x * r, pt.y + nrm.y * r, pt.z + nrm.z * r);
      sNor.push(nrm.x, nrm.y, nrm.z);
    }
  }
  for (let i = 0; i < STEM_RINGS; i++) {
    for (let j = 0; j < STEM_SIDES; j++) {
      const a = i * STEM_SIDES + j;
      const b = i * STEM_SIDES + ((j + 1) % STEM_SIDES);
      const a2 = a + STEM_SIDES;
      const b2 = b + STEM_SIDES;
      sIdx.push(a, a2, b, b, a2, b2);
    }
  }
  const stemGeo = track(new THREE.BufferGeometry());
  stemGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  stemGeo.setAttribute('normal', new THREE.Float32BufferAttribute(sNor, 3));
  stemGeo.setIndex(sIdx);
  const green = new THREE.Color('#86ad5c');
  const stemMat = track(
    new THREE.MeshStandardMaterial({ color: '#9fbf70', roughness: 0.55, emissive: green, emissiveIntensity: 0.12 }),
  );
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = soilTop - 0.004;
  stem.frustumCulled = false;
  group.add(stem);

  const budGeo = track(new THREE.SphereGeometry(0.0085, 10, 8));
  const bud = new THREE.Mesh(budGeo, stemMat);
  bud.scale.set(1, 1.35, 1);
  group.add(bud);

  // ---- two cotyledons on hinge pivots at the stem tip --------------------------------------------------------
  const leafGeo = track(leafGeometry(THREE, 0.088, 0.06));
  const leafMat = track(
    new THREE.MeshStandardMaterial({
      color: '#7fae58',
      roughness: 0.6,
      emissive: new THREE.Color('#a6d46a'),
      emissiveIntensity: 0.15,
      side: THREE.DoubleSide,
    }),
  );
  const tipPoint = curve.getPointAt(1, new THREE.Vector3());
  const crown = new THREE.Group();
  crown.position.set(tipPoint.x, soilTop - 0.004 + tipPoint.y, tipPoint.z);
  crown.rotation.y = -0.2; // leaves open across the view, not toward it
  group.add(crown);
  const pivotA = new THREE.Group();
  const pivotB = new THREE.Group();
  pivotB.rotation.y = Math.PI;
  const holdA = new THREE.Group();
  const holdB = new THREE.Group();
  holdA.add(new THREE.Mesh(leafGeo, leafMat));
  holdB.add(new THREE.Mesh(leafGeo, leafMat));
  pivotA.add(holdA);
  pivotB.add(holdB);
  crown.add(pivotA, pivotB);

  // ---- glow inside the glass ---------------------------------------------------------------------------------
  const glowTex = track(
    radialTexture(THREE, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.45)'],
      [0.6, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  const glowMat = track(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: '#ffd987',
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(0, soilTop + 0.13, 0);
  glow.scale.setScalar(0.42);
  glow.renderOrder = 5;
  group.add(glow);

  // ---- contact shadow (sun is behind: the shadow falls toward the viewer) -------------------------------------
  const shadowTex = track(
    radialTexture(THREE, [
      [0, 'rgba(0,0,0,0.75)'],
      [0.45, 'rgba(0,0,0,0.35)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
  );
  const shadowGeo = track(new THREE.PlaneGeometry(1, 1));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = track(
    new THREE.MeshBasicMaterial({ map: shadowTex, color: '#2a1c22', transparent: true, depthWrite: false, opacity: 0.5 }),
  );
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  // sized to the plinth (not just the dish) so the stone sits IN the sand rather than floating on it;
  // SAND_LOCAL is where the beach surface meets the group (the chapter sinks the plinth by that much)
  shadow.scale.set(0.98, 1, 0.8);
  shadow.position.set(-0.02, SAND_LOCAL + 0.003, 0.09);
  shadow.renderOrder = 1;
  group.add(shadow);

  // ---- the glass cloche ---------------------------------------------------------------------------------------
  const clocheProfile = [
    [0.172, 0.0],
    [0.177, 0.012],
    [0.176, 0.15],
    [0.172, 0.235],
    [0.161, 0.294],
    [0.138, 0.345],
    [0.1, 0.381],
    [0.05, 0.4],
    [0.017, 0.405],
    [0.014, 0.414],
    [0.025, 0.424],
    [0.028, 0.437],
    [0.021, 0.45],
    [0.0, CLOCHE_HEIGHT],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const clocheGeo = track(new THREE.LatheGeometry(clocheProfile, 56));
  const rimGeo = track(new THREE.TorusGeometry(0.176, 0.0055, 6, 56));
  rimGeo.rotateX(Math.PI / 2);
  const glassUniforms = {
    uHorizon: { value: new THREE.Color('#f3c9b2') },
    uZenith: { value: new THREE.Color('#93a6c2') },
    uGround: { value: new THREE.Color('#c9a99a') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.05, -1).normalize() },
    uSunColor: { value: new THREE.Color('#ffd0a0') },
    uGlow: { value: 0 },
    uGlowCol: { value: new THREE.Color('#ffd987') },
    uGlowPos: { value: new THREE.Vector3() },
    uBack: { value: 0.55 },
  };
  const glassVS = /* glsl */ `
    varying vec3 vN; varying vec3 vW; varying vec3 vVN;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      vVN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const glassFS = /* glsl */ `
    uniform vec3 uHorizon, uZenith, uGround, uSunDir, uSunColor, uGlowCol, uGlowPos;
    uniform float uGlow, uBack;
    varying vec3 vN; varying vec3 vW; varying vec3 vVN;
    vec3 sky(vec3 r){
      float y = r.y;
      vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, y));
      return mix(c, uGround, smoothstep(0.0, -0.25, y));
    }
    void main(){
      vec3 N = normalize(vN);
      vec3 VN = normalize(vVN);
      if (!gl_FrontFacing) { N = -N; VN = -VN; }
      vec3 V = normalize(cameraPosition - vW);
      float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
      float F = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
      vec3 R = reflect(-V, N);
      float rs = max(dot(R, uSunDir), 0.0);
      float spec = pow(rs, 380.0) * 7.0 + pow(rs, 30.0) * 0.18;
      // grazing edges: thicker glass, faintly green, glowing when the sun sits behind it
      float edge = smoothstep(0.42, 0.0, ndv);
      float back = pow(max(dot(-V, uSunDir), 0.0), 5.0);
      // a soft vertical window strip, as if the bright sky low on one side is mirrored in the bell
      float strip = smoothstep(0.42, 0.52, VN.x) * smoothstep(0.78, 0.62, VN.x) * smoothstep(-0.6, 0.2, VN.y);
      // warm light from the seedling caught on the inside of the glass
      float gd = length(vW - uGlowPos);
      float inner = uGlow * exp(-gd * 9.0);
      vec3 col = sky(R) * F * 1.15 + uSunColor * spec + vec3(0.86, 0.94, 0.88) * edge * 0.22;
      col += uSunColor * back * edge * uBack;
      col += vec3(1.0) * strip * 0.32;
      col += uGlowCol * inner * 0.6;
      float a = clamp(F * 0.85 + spec + edge * 0.2 + strip * 0.22 + inner * 0.25 + 0.025, 0.0, 0.92);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const glassBack = track(
    new THREE.ShaderMaterial({
      uniforms: glassUniforms,
      vertexShader: glassVS,
      fragmentShader: glassFS,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  const glassFront = track(
    new THREE.ShaderMaterial({
      uniforms: glassUniforms,
      vertexShader: glassVS,
      fragmentShader: glassFS,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  const clocheBack = new THREE.Mesh(clocheGeo, glassBack);
  const clocheFront = new THREE.Mesh(clocheGeo, glassFront);
  const rim = new THREE.Mesh(rimGeo, glassFront);
  clocheBack.position.y = clocheFront.position.y = top;
  rim.position.y = top + 0.005;
  clocheBack.renderOrder = 6;
  clocheFront.renderOrder = 8;
  rim.renderOrder = 8;
  group.add(clocheBack, clocheFront, rim);

  // ---- raycast proxy ------------------------------------------------------------------------------------------
  const proxyGeo = track(new THREE.CylinderGeometry(0.24, 0.3, 0.56, 10));
  const proxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.position.y = 0.28;
  proxy.name = 'next-cloche-proxy';
  group.add(proxy);

  // ---- state --------------------------------------------------------------------------------------------------
  let gStem = 0;
  let gLeaves = 0;
  let gGlow = 0;
  const heart = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const reduced = opts.reducedMotion;
  const stemIndexCount = STEM_RINGS * STEM_SIDES * 6;

  const api: Seedling = {
    group,
    proxy,
    heart,
    setGrowth(s, l, g) {
      gStem = s;
      gLeaves = l;
      gGlow = g;
      const visRings = Math.round(STEM_RINGS * s);
      stem.visible = visRings > 0;
      stemGeo.setDrawRange(0, (stemIndexCount * visRings) / STEM_RINGS);
      curve.getPointAt(Math.max(0.001, visRings / STEM_RINGS), tmp);
      bud.position.set(tmp.x, stem.position.y + tmp.y, tmp.z);
      bud.visible = s > 0.01 && l < 0.35;
      bud.scale.set(1, 1.35, 1).multiplyScalar(0.6 + 0.4 * smoothstep(0, 0.2, s));
      // seed coat splits and tips over as the shoot pushes out
      const crack = smoothstep(0.0, 0.25, s);
      seed.rotation.z = 0.35 + crack * 0.9;
      seed.position.x = 0.018 + crack * 0.012;
      // leaves: folded upright against each other → open nearly flat, slight upward set
      crown.visible = s > 0.97 || l > 0;
      const open = l * l * (3 - 2 * l);
      const ang = 0.1 + open * 0.86;
      pivotA.rotation.z = -ang;
      pivotB.rotation.z = -ang;
      const sc = 0.32 + 0.68 * smoothstep(0, 0.85, l);
      holdA.scale.setScalar(sc);
      holdB.scale.setScalar(sc * 0.94);
      leafMat.emissiveIntensity = 0.12 + 0.4 * g;
      stemMat.emissiveIntensity = 0.08 + 0.25 * g;
      group.updateMatrixWorld();
      glow.getWorldPosition(heart);
    },
    setSky(s) {
      glassUniforms.uHorizon.value.copy(s.horizon);
      glassUniforms.uZenith.value.copy(s.zenith);
      glassUniforms.uGround.value.copy(s.ground);
      glassUniforms.uSunDir.value.copy(s.sunDir);
      glassUniforms.uSunColor.value.copy(s.sunColor);
    },
    update(time, hover, pulse) {
      const breathe = reduced ? 0 : Math.sin(time * 0.9) * 0.5 + 0.5;
      const g = gGlow;
      const o = 0.04 + 0.36 * g + 0.08 * g * breathe + 0.16 * hover + 0.3 * pulse;
      glowMat.opacity = Math.min(1, o);
      glow.scale.setScalar(0.34 + 0.12 * g + 0.06 * pulse);
      glow.position.y = soilTop + 0.06 + 0.11 * Math.max(gStem, 0.2);
      glassUniforms.uGlow.value = Math.min(1.2, 0.15 + g + 0.4 * hover + 0.6 * pulse);
      group.updateMatrixWorld();
      glow.getWorldPosition(glassUniforms.uGlowPos.value);
      heart.copy(glassUniforms.uGlowPos.value);
      // leaves lift a hair with the pulse, as if breathing in
      if (gLeaves > 0) {
        const lift = 0.06 * pulse + (reduced ? 0 : 0.012 * Math.sin(time * 0.7));
        pivotA.rotation.z = -(0.1 + gLeaves * gLeaves * (3 - 2 * gLeaves) * 0.86) + lift;
        pivotB.rotation.z = pivotA.rotation.z;
      }
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
  api.setGrowth(0, 0, 0);
  return api;
}
