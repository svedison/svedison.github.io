// Trees for the Seattle set.
//  - Evergreens (Douglas fir / western red cedar silhouettes): one InstancedMesh of stacked tiers, per-instance tone,
//    settled snow on up-facing tiers in winter (3d-four-seasons: evergreens keep their coverage).
//  - Cherry trees on the quad: merged gnarled trunks + branches (always visible: bare in winter), and one instanced
//    canopy of alpha-cut leaf-card clusters round small dark cores, whose colour and coverage follow the shared season weights. Coverage thins by a stable
//    per-instance threshold (no random per frame), so leaves leave in the same order every time you scroll.
//  - Litter: small leaf / petal flecks under each cherry (petals in spring, leaves in fall; gone under snow).
import type * as THREE_NS from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, makeRng, valueNoise2 } from '../../systems/noise';
import { LAND_Y, inLake } from './terrain';

type THREE = typeof THREE_NS;

export interface CherrySpot {
  x: number;
  z: number;
  s: number;
}

/** Two rows lining the main brick path (x = 5), plus a few around the fountain. */
export const CHERRIES: CherrySpot[] = (() => {
  const out: CherrySpot[] = [];
  const rng = makeRng(404);
  // gaps at the cross path (z ≈ -77) and on the right near the camera, so the arcade stays in view
  const left = [-61, -68, -84, -91, -98, -112, -119];
  const right = [-71, -88, -97, -112, -119];
  for (const z of left) out.push({ x: -1.2 + (rng() - 0.5) * 0.8, z: z + (rng() - 0.5) * 1.0, s: 0.92 + rng() * 0.22 });
  for (const z of right) out.push({ x: 11.2 + (rng() - 0.5) * 0.8, z: z + (rng() - 0.5) * 1.0, s: 0.92 + rng() * 0.22 });
  out.push({ x: -9, z: -100, s: 1.05 }, { x: -10, z: -68, s: 0.95 }, { x: 17.5, z: -66, s: 0.9 });
  return out;
})();

export interface Trees {
  group: THREE_NS.Group;
  evergreens: THREE_NS.InstancedMesh;
  /** Per-frame seasonal state. cover = canopy coverage 0..1; colA/colB foliage tones; bloom = blossom speckle 0..1. */
  setSeason(o: {
    cover: number;
    colA: THREE_NS.Color;
    colB: THREE_NS.Color;
    bloom: number;
    snow: number;
    litter: THREE_NS.Color;
    litterAmount: number;
  }): void;
  setLight(sunDir: THREE_NS.Vector3, sunCol: THREE_NS.Color, sky: THREE_NS.Color, ground: THREE_NS.Color): void;
  setDensity(k: number): void;
  /** Extra aerial perspective on trunks and firs (0..1): values recede into the fog colour with distance. */
  setAerial(k: number): void;
  update(time: number): void;
  dispose(): void;
}

const UP = { x: 0, y: 1, z: 0 };

export function createTrees(THREE: THREE, mobile: boolean): Trees {
  const group = new THREE.Group();
  group.name = 'trees';
  const disposables: { dispose(): void }[] = [];
  const rng = makeRng(77);

  // ---------------- evergreens
  const tiers: THREE_NS.BufferGeometry[] = [];
  const tierDefs = [
    [0.36, 0.42, 0.3],
    [0.28, 0.36, 0.5],
    [0.2, 0.3, 0.68],
    [0.12, 0.24, 0.84],
  ];
  for (const [r, h, y] of tierDefs) {
    const c = new THREE.ConeGeometry(r, h, 7, 1, true);
    c.translate(0, y, 0);
    tiers.push(c);
  }
  const trunk = new THREE.CylinderGeometry(0.03, 0.05, 0.3, 5, 1, true);
  trunk.translate(0, 0.15, 0);
  tiers.push(trunk);
  // strip uvs so the pieces merge cleanly
  tiers.forEach((g) => g.deleteAttribute('uv'));
  const firGeo = mergeGeometries(tiers)!;
  tiers.forEach((g) => g.dispose());
  disposables.push(firGeo);

  const snowU = { value: 0 };
  const aerU = { value: 0.25 };
  // Aerial perspective beyond the scene's exp2 fog: a linear-in-distance pull toward the fog colour, so near
  // trunks keep their dark value and far ones recede (never #000 cut-outs on the snow).
  const AERIAL_GLSL = /* glsl */ `
    #include <fog_fragment>
    #ifdef USE_FOG
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uAer * (1.0 - exp(-vFogDepth * 0.045)));
    #endif`;
  const firMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  firMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = snowU;
    sh.uniforms.uAer = aerU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWp;\nvarying float vH;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vH = transformed.y;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnow, uAer;\nvarying vec3 vWN;\nvarying vec3 vWp;\nvarying float vH;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float nn = vnoise(vWp.xz * 2.7 + vWp.y * 1.3);
        diffuseColor.rgb *= 0.78 + 0.4 * nn;
        // upper tiers catch the open sky (and more snow); the skirt stays in the trunk-line gloom
        diffuseColor.rgb *= 0.82 + 0.3 * smoothstep(0.2, 0.9, vH);
        float sn = uSnow * smoothstep(0.32, 0.62, vWN.y) * smoothstep(0.25, 0.6, nn + 0.15 + 0.25 * vH);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.88), sn);`,
      )
      .replace('#include <fog_fragment>', AERIAL_GLSL);
  };
  disposables.push(firMat);

  type Fir = { x: number; z: number; h: number };
  const firs: Fir[] = [];
  const campus = (x: number, z: number) => x > -32 && x < 48 && z < -50 && z > -146;
  // keep the Rainier Vista open: no tall trees in the corridor from the quad toward the mountain
  const vista = (x: number, z: number) => z < -138 && Math.abs(x - (5 + 0.116 * (-z - 66))) < 26 + (-z - 138) * 0.22;
  const tryAdd = (x: number, z: number, h: number) => {
    if (inLake(x, z, 3) || campus(x, z) || vista(x, z)) return;
    firs.push({ x, z, h });
  };
  // hand-placed framing trees near the quad
  firs.push({ x: -16, z: -64, h: 15 }, { x: 27, z: -64, h: 17 }, { x: 33, z: -70, h: 13 }, { x: -24, z: -70, h: 12 });
  const target = mobile ? 260 : 460;
  let guard = 0;
  while (firs.length < target && guard++ < 20000) {
    const zone = rng();
    let x: number;
    let z: number;
    if (zone < 0.45) {
      // side shores of the lake
      z = -50 + rng() * 170;
      const side = rng() < 0.5 ? -1 : 1;
      x = side * (55 + 0.3 * (z + 42) + 2 + Math.pow(rng(), 1.6) * 60);
    } else if (zone < 0.8) {
      // far shore and the woods behind campus
      x = (rng() - 0.5) * 300;
      z = -58 - Math.pow(rng(), 1.3) * 170;
    } else {
      x = (rng() - 0.5) * 520;
      z = -150 - rng() * 120;
    }
    const clump = valueNoise2(x * 0.05, z * 0.05, 5);
    if (clump < 0.35) continue;
    tryAdd(x, z, 9 + rng() * 11 + clump * 6);
  }
  const evergreens = new THREE.InstancedMesh(firGeo, firMat, firs.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color('#2f4a3e');
  const dark = new THREE.Color('#1f322b');
  firs.forEach((f, i) => {
    const slim = 0.75 + rng() * 0.35;
    s3.set(f.h * 0.62 * slim, f.h, f.h * 0.62 * slim);
    q.setFromAxisAngle(p3.set(0, 1, 0), rng() * 6.28);
    p3.set(f.x, LAND_Y - 0.05, f.z);
    m4.compose(p3, q, s3);
    evergreens.setMatrixAt(i, m4);
    col.copy(base).lerp(dark, rng() * 0.8);
    evergreens.setColorAt(i, col);
  });
  evergreens.instanceMatrix.needsUpdate = true;
  if (evergreens.instanceColor) evergreens.instanceColor.needsUpdate = true;
  evergreens.computeBoundingSphere();
  evergreens.name = 'evergreens';
  group.add(evergreens);
  const firCount = firs.length;

  // ---------------- cherry trunks + branches (merged), and canopy blob anchors
  const wood: THREE_NS.BufferGeometry[] = [];
  const blobs: { x: number; y: number; z: number; r: number }[] = [];
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(UP.x, UP.y, UP.z);
  const limb = (ax: number, ay: number, az: number, d: THREE_NS.Vector3, len: number, r0: number, r1: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
    g.deleteAttribute('uv');
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, d);
    g.applyQuaternion(q);
    g.translate(ax, ay, az);
    wood.push(g);
    return [ax + d.x * len, ay + d.y * len, az + d.z * len] as const;
  };
  for (const c of CHERRIES) {
    const s = c.s;
    const lean = rng() * 6.28;
    dir.set(Math.cos(lean) * 0.18, 1, Math.sin(lean) * 0.18).normalize();
    const top = limb(c.x, LAND_Y, c.z, dir, 1.7 * s, 0.24 * s, 0.17 * s);
    const nb = 4 + Math.floor(rng() * 2);
    for (let b = 0; b < nb; b++) {
      const a = lean + (b / nb) * 6.28 + (rng() - 0.5) * 0.7;
      const rise = 0.55 + rng() * 0.45;
      dir.set(Math.cos(a), rise, Math.sin(a)).normalize();
      const len = (1.7 + rng() * 0.9) * s;
      const end = limb(top[0], top[1], top[2], dir, len, 0.13 * s, 0.06 * s);
      // two twigs from each branch end, spreading wide and flat (Yoshino habit)
      for (let k = 0; k < 2; k++) {
        const a2 = a + (k ? 0.55 : -0.55) + (rng() - 0.5) * 0.3;
        dir.set(Math.cos(a2), 0.3 + rng() * 0.4, Math.sin(a2)).normalize();
        const tl = (0.9 + rng() * 0.7) * s;
        const tip = limb(end[0], end[1], end[2], dir, tl, 0.06 * s, 0.025 * s);
        blobs.push({ x: tip[0], y: tip[1] + 0.15, z: tip[2], r: (0.8 + rng() * 0.35) * s });
        // a smaller satellite clump between twig and branch breaks the silhouette
        blobs.push({
          x: (tip[0] + end[0]) / 2 + (rng() - 0.5) * 0.5,
          y: (tip[1] + end[1]) / 2 + 0.45 * s,
          z: (tip[2] + end[2]) / 2 + (rng() - 0.5) * 0.5,
          r: (0.55 + rng() * 0.3) * s,
        });
      }
      blobs.push({ x: end[0], y: end[1] + 0.35 * s, z: end[2], r: (0.95 + rng() * 0.35) * s });
    }
    blobs.push({ x: top[0], y: top[1] + 1.2 * s, z: top[2], r: 1.2 * s });
  }
  const woodGeo = mergeGeometries(wood)!;
  wood.forEach((g) => g.dispose());
  // Bark: wet dark wood with value noise; in winter snow lies on the up-facing side of every limb and the upper
  // crown is lifted by the sky (snow-lit tops), and distance pulls the whole tree toward the fog.
  const woodMat = new THREE.MeshLambertMaterial({ color: '#3a302a' });
  woodMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = snowU;
    sh.uniforms.uAer = aerU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWp;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnow, uAer;\nvarying vec3 vWN;\nvarying vec3 vWp;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bk = vnoise(vec2(vWp.x * 7.0 + vWp.z * 5.0, vWp.y * 2.2));
        diffuseColor.rgb *= 0.78 + 0.44 * bk;
        float hgt = clamp((vWp.y - ${LAND_Y.toFixed(2)}) / 5.5, 0.0, 1.0);
        // sky-lit crown: the higher limbs read lighter and cooler than the trunk foot
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3(0.03, 0.035, 0.04), hgt * (0.35 + 0.65 * uSnow));
        float sn = uSnow * smoothstep(0.12, 0.5, vWN.y) * smoothstep(0.18, 0.5, bk + 0.18 * hgt);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.92), sn * 0.92);`,
      )
      .replace('#include <fog_fragment>', AERIAL_GLSL);
  };
  const woodMesh = new THREE.Mesh(woodGeo, woodMat);
  woodMesh.name = 'cherry-wood';
  group.add(woodMesh);
  disposables.push(woodGeo, woodMat);


  // ---------------- canopy
  // Two layers per clump: a small dark core (so the crown has depth and never reads see-through), and a shell of
  // camera-facing leaf cards whose alpha is cut by noise into florets / leaves with a ragged rim. The cards carry
  // the silhouette, so a crown reads as many small clusters rather than one smooth boulder. Per-card hue + value
  // jitter, outward normals bent across each card for volume, a little self-fill so overcast light never greys it.
  const blobRand = new Float32Array(blobs.length);
  for (let i = 0; i < blobs.length; i++) blobRand[i] = rng();

  const LIGHT_GLSL = /* glsl */ `
    uniform vec3 uSunDir, uSunCol, uSky, uGround;
    vec3 foliageLight(vec3 n){
      float hemi = n.y * 0.5 + 0.5;
      return mix(uGround, uSky, hemi) + uSunCol * max(dot(n, normalize(uSunDir)), 0.0);
    }`;
  // shared uniform objects (same references in both materials, so one write drives both)
  const shared = {
    uCover: { value: 1 },
    uColA: { value: new THREE.Color('#f1c4cf') },
    uColB: { value: new THREE.Color('#e7a9b9') },
    uBloom: { value: 1 },
    uSnow: { value: 0 },
    uCut: { value: 0 },
    uFill: { value: 0.16 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8) },
    uSunCol: { value: new THREE.Color('#ffffff') },
    uSky: { value: new THREE.Color('#9aa5a5') },
    uGround: { value: new THREE.Color('#3a4a40') },
    uTime: { value: 0 },
  };

  // core
  const coreGeo = new THREE.IcosahedronGeometry(1, 1);
  coreGeo.setAttribute('aRand', new THREE.InstancedBufferAttribute(blobRand, 1));
  disposables.push(coreGeo);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      ${GLSL_NOISE}
      uniform float uCover, uTime;
      attribute float aRand;
      varying vec3 vN; varying float vR;
      void main(){
        // the core only fills full crowns; sparse buds are cards alone (no bare blobs showing)
        float vis = smoothstep(aRand * 0.9, aRand * 0.9 + 0.1, uCover) * smoothstep(0.45, 0.8, uCover);
        vec3 p = position * (0.8 + 0.4 * vnoise(position.xy * 2.1 + aRand * 13.0));
        p.y *= 0.72;
        p *= vis;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        wp.x += sin(uTime * 0.9 + aRand * 6.28) * 0.04;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vR = aRand;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColA, uColB;
      uniform float uFill;
      ${LIGHT_GLSL}
      varying vec3 vN; varying float vR;
      void main(){
        vec3 n = normalize(vN);
        vec3 c = mix(uColA, uColB, 0.35 + 0.5 * vR);
        vec3 col = c * (foliageLight(n) * 0.5 + uFill * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  disposables.push(coreMat);
  const core = new THREE.InstancedMesh(coreGeo, coreMat, blobs.length);
  blobs.forEach((b, i) => {
    s3.set(b.r * 0.6, b.r * 0.6, b.r * 0.6);
    q.setFromAxisAngle(p3.set(0, 1, 0), blobRand[i] * 6.28);
    p3.set(b.x, b.y - 0.05 * b.r, b.z);
    m4.compose(p3, q, s3);
    core.setMatrixAt(i, m4);
  });
  core.instanceMatrix.needsUpdate = true;
  core.computeBoundingSphere();
  core.name = 'cherry-canopy-core';
  group.add(core);

  // leaf cards
  const perBlob = mobile ? 20 : 30;
  const nCards = blobs.length * perBlob;
  const aC = new Float32Array(nCards * 4);
  const aN = new Float32Array(nCards * 4);
  const aR = new Float32Array(nCards * 4);
  let ci = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  // card-major order, so lowering instanceCount (quality tier) thins every crown evenly instead of dropping trees
  for (let k = 0; k < perBlob; k++) {
    blobs.forEach((b, bi) => {
      // direction on the shell, biased up and out (a light-seeking crown); flattened like a cherry canopy
      let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      dy = dy * 0.8 + 0.18;
      const f = Math.min(1.02, 0.42 + 0.62 * Math.sqrt(rng()));
      const cx = b.x + dx * b.r * f;
      const cy = b.y + dy * b.r * f * 0.72;
      const cz = b.z + dz * b.r * f;
      const nl = Math.hypot(dx, dy / 0.72, dz) || 1;
      const o = ci * 4;
      aC[o] = cx;
      aC[o + 1] = cy;
      aC[o + 2] = cz;
      aC[o + 3] = b.r * (0.78 + 0.42 * rng());
      aN[o] = dx / nl;
      aN[o + 1] = dy / 0.72 / nl;
      aN[o + 2] = dz / nl;
      aN[o + 3] = Math.min(1, f * 0.65 + 0.35 * (0.5 + 0.5 * dy));
      aR[o] = 0.5 * blobRand[bi] + 0.5 * rng();
      aR[o + 1] = rng();
      aR[o + 2] = rng();
      aR[o + 3] = blobRand[bi];
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      minZ = Math.min(minZ, cz);
      maxZ = Math.max(maxZ, cz);
      ci++;
    });
  }
  const cardQuad = new THREE.PlaneGeometry(1, 1);
  const cardGeo = new THREE.InstancedBufferGeometry();
  cardGeo.index = cardQuad.index;
  cardGeo.setAttribute('position', cardQuad.getAttribute('position'));
  cardGeo.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
  cardGeo.setAttribute('aN', new THREE.InstancedBufferAttribute(aN, 4));
  cardGeo.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
  cardGeo.instanceCount = nCards;
  cardGeo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 3,
  );
  disposables.push(cardQuad, cardGeo);
  const canopyMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uCover, uTime;
      attribute vec4 aC; attribute vec4 aN; attribute vec4 aR;
      varying vec2 vP; varying vec3 vN; varying vec4 vR; varying float vAo;
      void main(){
        float vis = smoothstep(aR.x * 0.92, aR.x * 0.92 + 0.08, uCover);
        // thinning crowns also shrink their clusters (sparse buds, not full-size cards)
        float sz = aC.w * vis * mix(0.55, 1.0, clamp(uCover * 1.3, 0.0, 1.0));
        vec3 c = aC.xyz;
        float sway = 0.5 + aN.w;
        c.x += sin(uTime * 0.9 + aR.w * 6.28) * 0.05 * sway + sin(uTime * 2.3 + aR.z * 6.28) * 0.012;
        c.z += cos(uTime * 0.7 + aR.w * 4.0) * 0.03 * sway;
        float ang = aR.z * 6.2832;
        vec2 q = vec2(cos(ang) * position.x - sin(ang) * position.y, sin(ang) * position.x + cos(ang) * position.y);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 off = right * q.x + up * q.y;
        vec3 wp = c + off * sz;
        vP = position.xy * 2.0;
        // bend the outward normal across the card so each cluster is lit as a little dome
        vN = normalize(aN.xyz + off * 0.9);
        vR = aR;
        vAo = aN.w;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform vec3 uColA, uColB;
      uniform float uBloom, uSnow, uCut, uFill;
      ${LIGHT_GLSL}
      varying vec2 vP; varying vec3 vN; varying vec4 vR; varying float vAo;
      void main(){
        float r = length(vP);
        vec2 sd = vec2(vR.z * 37.0 + vR.y * 11.0, vR.y * 23.0);
        // rotated domains: value noise on the card's own axes reads as square texels at a distance
        vec2 pa = mat2(0.8, -0.6, 0.6, 0.8) * vP;
        vec2 pb = mat2(0.47, 0.88, -0.88, 0.47) * vP;
        float n1 = vnoise(pa * 2.2 + sd);
        float n2 = vnoise(pb * 4.4 + sd * 1.7);
        // leaves / florets: one rounded, turned leaf per jittered cell (organic, never a square noise texel)
        vec2 g = pa * 4.6 + sd * 2.3;
        vec2 cid = floor(g);
        vec2 h = hash22(cid);
        vec2 dl = fract(g) - (0.3 + 0.4 * h);
        float la = h.x * 6.2832;
        dl = mat2(cos(la), -sin(la), sin(la), cos(la)) * dl;
        float fl = (1.0 - smoothstep(0.12, 0.27, length(dl * vec2(1.0, 1.85)))) * (0.6 + 0.4 * h.y);
        // ragged cluster: two noise scales + the leaf cells, falling off to the rim
        float m = 0.5 * n1 + 0.3 * n2 + 0.24 * fl + (1.0 - r) * 0.9 - 0.77 - uCut;
        if (m < 0.0) discard;
        // per-card hue + value jitter (no two clusters the same)
        vec3 c = mix(uColA, uColB, smoothstep(0.1, 0.9, vR.y * 0.75 + n2 * 0.45));
        c *= 0.8 + 0.34 * fract(vR.y * 7.31 + vR.w * 3.1);
        // spring: florets catch the light; otherwise broken leaf texture with dark gaps
        float flo = smoothstep(0.6, 0.8, fl) * uBloom;
        c = mix(c, mix(c, vec3(1.0, 0.95, 0.96), 0.55), flo * 0.85);
        c *= mix(0.72 + 0.4 * smoothstep(0.3, 0.75, fl), 1.0, uBloom * 0.65);
        vec3 n = normalize(vN);
        float ao = 0.5 + 0.5 * vAo;
        float rimShade = 0.82 + 0.18 * clamp(m * 4.0, 0.0, 1.0);
        vec3 light = foliageLight(n);
        // thin leaves / petals pass a little sky light at the crown's edge
        light += uSky * 0.22 * (1.0 - abs(n.y));
        vec3 col = c * (light * ao * rimShade + uFill);
        col = mix(col, vec3(0.86, 0.89, 0.91) * light, uSnow * smoothstep(0.4, 0.9, n.y) * smoothstep(0.5, 0.65, fl));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  disposables.push(canopyMat);
  const canopy = new THREE.Mesh(cardGeo, canopyMat);
  canopy.name = 'cherry-canopy';
  group.add(canopy);

  // ---------------- litter: many small leaf / petal flecks under each cherry (never blotches)
  const discGeo = new THREE.CircleGeometry(1, 20);
  discGeo.rotateX(-Math.PI / 2);
  disposables.push(discGeo);
  const litterU = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uCol: { value: new THREE.Color('#f0c7cf') },
    uAmt: { value: 0.8 },
  };
  const litterMat = new THREE.ShaderMaterial({
    uniforms: litterU,
    fog: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vL; varying vec3 vWp;
      void main(){
        vL = position.xz;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform vec3 uCol; uniform float uAmt;
      varying vec2 vL; varying vec3 vWp;
      // one small leaf-shaped fleck per grid cell, randomly placed and turned, kept or dropped by density
      float fleck(vec2 wp, float sc, float dens, float seed, float rad, out float tone){
        vec2 g = wp * sc;
        vec2 cell = floor(g);
        vec2 h = hash22(cell + seed);
        tone = h.y;
        float on = step(hash12(cell * 1.31 + seed + 5.0), dens);
        vec2 d = fract(g) - (0.25 + 0.5 * h);
        float a = h.x * 6.2832;
        d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
        return on * (1.0 - smoothstep(rad * 0.75, rad, length(d * vec2(1.0, 2.1))));
      }
      void main(){
        float r = length(vL) + (vnoise(vWp.xz * 1.7) - 0.5) * 0.45;
        float dens = uAmt * (1.0 - smoothstep(0.2, 1.0, r));
        float t1, t2;
        float a1 = fleck(vWp.xz, 4.5, dens * 0.5, 3.0, 0.3, t1);
        float a2 = fleck(vWp.xz, 8.0, dens * 0.65, 9.0, 0.32, t2);
        float a = max(a1, a2);
        if (a < 0.05) discard;
        float tone = a1 > a2 ? t1 : t2;
        vec3 col = uCol * (0.7 + 0.5 * tone);
        gl_FragColor = vec4(col, a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  disposables.push(litterMat);
  const litter = new THREE.InstancedMesh(discGeo, litterMat, CHERRIES.length);
  CHERRIES.forEach((c, i) => {
    const r = 3.1 * c.s;
    s3.set(r, 1, r);
    q.identity();
    p3.set(c.x + 0.3, LAND_Y + 0.03, c.z);
    m4.compose(p3, q, s3);
    litter.setMatrixAt(i, m4);
  });
  litter.instanceMatrix.needsUpdate = true;
  litter.computeBoundingSphere();
  litter.renderOrder = 1;
  group.add(litter);

  return {
    group,
    evergreens,
    setSeason(o) {
      shared.uCover.value = o.cover;
      shared.uColA.value.copy(o.colA);
      shared.uColB.value.copy(o.colB);
      shared.uBloom.value = o.bloom;
      shared.uSnow.value = o.snow;
      // thinning crowns cut their clusters more raggedly too
      shared.uCut.value = 0.16 * Math.max(0, 1 - o.cover);
      snowU.value = o.snow;
      litterU.uCol.value.copy(o.litter);
      litterU.uAmt.value = o.litterAmount;
      litter.visible = o.litterAmount > 0.01;
      canopy.visible = core.visible = o.cover > 0.001;
    },
    setLight(sunDir, sunCol, sky, ground) {
      shared.uSunDir.value.copy(sunDir);
      shared.uSunCol.value.copy(sunCol);
      shared.uSky.value.copy(sky);
      shared.uGround.value.copy(ground);
    },
    setAerial(k) {
      aerU.value = k;
    },
    setDensity(k) {
      evergreens.count = Math.max(4, Math.round(firCount * k));
      cardGeo.instanceCount = Math.max(blobs.length, Math.round(nCards * (0.6 + 0.4 * k)));
    },
    update(time) {
      shared.uTime.value = time;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      evergreens.dispose();
      core.dispose();
      litter.dispose();
      group.removeFromParent();
    },
  };
}
