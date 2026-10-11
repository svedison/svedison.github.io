// Terrain for the Seattle set: land around Lake Washington (one extruded slab with the lake cut out), two distant
// ridge bands, and Mt. Rainier as a low-contrast silhouette (3d-sky-background: distant silhouettes stay close to the
// horizon in hue and value). Ridges and the mountain do their own haze toward the live horizon colour (scene fog
// would erase them entirely at this distance).
import type * as THREE_NS from 'three';
import { GLSL_NOISE, valueNoise2, fbm2 } from '../../systems/noise';

type THREE = typeof THREE_NS;

export const LAND_Y = 0.3;
const FAR_SHORE = -56;

/** Half-width of the lake at z (lake runs from the far shore toward +z). */
export function lakeHalfWidth(z: number) {
  return 50 + 0.3 * (z + 42);
}
/** Far-shore z at x (curves toward the camera at the corners). */
export function farShoreZ(x: number) {
  const k = Math.min(1, Math.abs(x) / 50);
  return FAR_SHORE + 14 * k * k * k * k + (valueNoise2(x * 0.09, 3.1) - 0.5) * 2.4;
}
export function inLake(x: number, z: number, margin = 0) {
  if (z > 250) return false;
  if (z < farShoreZ(x) - margin) return false;
  return Math.abs(x) < lakeHalfWidth(z) + margin;
}

export interface Terrain {
  group: THREE_NS.Group;
  land: THREE_NS.Mesh;
  landMat: THREE_NS.MeshLambertMaterial;
  /** Haze colour + strength for the ridges and the mountain (call per frame with the fog colour). */
  setHaze(c: THREE_NS.Color, sunDir: THREE_NS.Vector3, snow: number): void;
  /** Warm window spill on the snow along the hall facades (window glow * settled snow). */
  setGlow(k: number): void;
  dispose(): void;
}

export function createTerrain(THREE: THREE, mobile: boolean): Terrain {
  const group = new THREE.Group();
  group.name = 'terrain';
  const disposables: { dispose(): void }[] = [];

  // ---- land slab with the lake cut out. Shape lives in (x, -z); extrusion becomes +y after rotateX(-90°).
  const outer = new THREE.Shape();
  outer.moveTo(-480, -300);
  outer.lineTo(480, -300);
  outer.lineTo(480, 760);
  outer.lineTo(-480, 760);
  outer.lineTo(-480, -300);
  const hole = new THREE.Path();
  const pts: [number, number][] = [];
  // right bank, from near the camera up to the far shore
  for (let z = 260; z > -42; z -= 8) {
    const w = lakeHalfWidth(z) + (valueNoise2(z * 0.07, 7.7) - 0.5) * 6;
    pts.push([w, z]);
  }
  for (let x = 50; x >= -50; x -= 2.5) pts.push([x, farShoreZ(x)]);
  for (let z = -42; z <= 260; z += 8) {
    const w = lakeHalfWidth(z) + (valueNoise2(z * 0.07, 2.3) - 0.5) * 6;
    pts.push([-w, z]);
  }
  hole.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) hole.lineTo(pts[i][0], -pts[i][1]);
  hole.lineTo(pts[0][0], -pts[0][1]);
  outer.holes.push(hole);
  const landGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.5, bevelEnabled: false, curveSegments: 4 });
  landGeo.rotateX(-Math.PI / 2);
  landGeo.translate(0, LAND_Y - 0.5, 0);
  const landMat = new THREE.MeshLambertMaterial({ color: '#4d6a49' });
  // under snow the grass mottle flattens out, so the white ground never shows dark smudges
  const landSnowU = { value: 0 };
  const landGlowU = { value: 0 };
  landMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLandSnow = landSnowU;
    sh.uniforms.uLandGlow = landGlowU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\nuniform float uLandSnow, uLandGlow;\nfloat gSpill;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float n = fbm(vWp.xz * 0.11, 4);
        float m = vnoise(vWp.xz * 0.9);
        diffuseColor.rgb *= mix(0.72 + 0.5 * n + 0.08 * m, 0.94 + 0.1 * n + 0.03 * m, uLandSnow);
        // wet, darker bank where land meets the lake
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(${(LAND_Y - 0.05).toFixed(2)}, ${LAND_Y.toFixed(2)}, vWp.y));
        // the quad's walls (wing L face x=-16, wing R + arcade face x=15, the hall front z=-128): occlusion where the
        // ground meets them, a brighter drift bank just beyond, wind-shaped drifts, and warm window spill in winter
        float dL = (vWp.z > -124.0 && vWp.z < -84.0 && vWp.x > -16.0) ? vWp.x + 16.0 : 99.0;
        float dR = (vWp.z > -111.0 && vWp.z < -77.0 && vWp.x < 15.0) ? 15.0 - vWp.x : 99.0;
        float dH = (vWp.x > -30.0 && vWp.x < 44.0 && vWp.z > -128.0) ? vWp.z + 128.0 : 99.0;
        float dw = min(dL, min(dR, dH));
        diffuseColor.rgb *= 1.0 - (0.12 + 0.18 * uLandSnow) * (1.0 - smoothstep(0.0, 1.7, dw));
        float drift = fbm(vWp.xz * vec2(0.32, 0.22) + 3.0, 3);
        float bank = smoothstep(0.9, 1.9, dw) * (1.0 - smoothstep(2.0, 3.6, dw));
        diffuseColor.rgb *= mix(1.0, 0.86 + 0.2 * drift + 0.06 * bank, uLandSnow);
        float along = dw == dH ? vWp.x / 3.5 : vWp.z / 3.4;
        float bayK = pow(0.5 + 0.5 * cos(along * 6.2832), 3.0);
        gSpill = uLandGlow * bayK * (1.0 - smoothstep(0.4, 4.2, dw)) * (0.7 + 0.3 * m);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.64, 0.32) * 0.16 * gSpill;`,
      );
  };
  const land = new THREE.Mesh(landGeo, landMat);
  land.name = 'land';
  group.add(land);
  disposables.push(landGeo, landMat);

  // ---- ridges: vertical strips with a noisy top edge, hazed toward the horizon
  const hazeUniforms = {
    uHaze: { value: new THREE.Color('#aab4b3') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8) },
    uSnow: { value: 0 },
  };
  const ridgeMat = new THREE.ShaderMaterial({
    uniforms: { ...hazeUniforms, uBody: { value: new THREE.Color('#2a3a34') } },
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aHaze;
      varying float vH; varying float vY;
      void main(){ vH = aHaze; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHaze, uBody;
      varying float vH; varying float vY;
      void main(){
        // valleys hold more mist than the crests
        float k = clamp(vH + 0.18 * (1.0 - smoothstep(0.0, 26.0, vY)), 0.0, 1.0);
        vec3 c = mix(uBody, uHaze, k);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  disposables.push(ridgeMat);
  const ridge = (z: number, base: number, amp: number, freq: number, treeAmp: number, haze: number, seed: number) => {
    const segs = mobile ? 180 : 320;
    const width = 1500;
    const pos: number[] = [];
    const hz: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const x = -width / 2 + (width * i) / segs;
      const h =
        base +
        amp * fbm2(x * freq, seed, 4) +
        treeAmp * Math.pow(valueNoise2(x * 0.9, seed + 3), 2) +
        (treeAmp * 0.5) * valueNoise2(x * 2.3, seed + 5);
      pos.push(x, -6, z, x, h, z + (valueNoise2(x * 0.02, seed) - 0.5) * 30);
      hz.push(haze, haze);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aHaze', new THREE.Float32BufferAttribute(hz, 1));
    g.setIndex(idx);
    disposables.push(g);
    const m = new THREE.Mesh(g, ridgeMat);
    m.renderOrder = -900;
    group.add(m);
    return m;
  };
  ridge(-560, 2, 34, 0.006, 3.0, 0.8, 11);
  ridge(-330, 2, 22, 0.012, 3.2, 0.62, 23);

  // ---- Mt. Rainier: a broad stratovolcano with a glacier cap, far to the south-east (right of the hall)
  const R = 360;
  const PEAK = 118;
  const mg = new THREE.PlaneGeometry(R * 2, R * 2, mobile ? 72 : 120, mobile ? 72 : 120);
  mg.rotateX(-Math.PI / 2);
  const mp = mg.getAttribute('position');
  for (let i = 0; i < mp.count; i++) {
    const x = mp.getX(i);
    const z = mp.getZ(i);
    const r = Math.hypot(x, z) / R;
    let h = PEAK * Math.pow(Math.max(0, 1 - r), 1.75);
    // a shoulder on the right (Little Tahoma-ish) and ridged gullies
    const sx = (x - 70) / (R * 0.45);
    const sz = (z + 20) / (R * 0.45);
    h += 16 * Math.pow(Math.max(0, 1 - Math.hypot(sx, sz)), 2);
    const ang = Math.atan2(z, x);
    h *= 1 - 0.08 * (valueNoise2(ang * 6, 9) - 0.5) * Math.min(1, r * 3);
    h += (fbm2(x * 0.03, z * 0.03, 3) - 0.5) * 10 * (1 - r);
    // flat summit, not a needle
    h = Math.min(h, PEAK * 0.94 + (fbm2(x * 0.08, z * 0.08, 2) - 0.5) * 3);
    mp.setY(i, Math.max(-4, h - 4));
  }
  mg.computeVertexNormals();
  disposables.push(mg);
  const mMat = new THREE.ShaderMaterial({
    uniforms: { ...hazeUniforms, uPeak: { value: PEAK } },
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vN;
      void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uHaze, uSunDir; uniform float uPeak, uSnow;
      varying vec3 vP; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float gully = fbm(vec2(atan(vP.z, vP.x) * 9.0, length(vP.xz) * 0.04), 4);
        float line = uPeak * mix(0.42, 0.18, uSnow) + (gully - 0.5) * 22.0;
        float snow = smoothstep(line - 3.0, line + 3.0, vP.y);
        vec3 rock = vec3(0.24, 0.28, 0.32);
        vec3 ice = vec3(0.95, 0.97, 1.0);
        float lit = 0.72 + 0.4 * max(dot(n, normalize(uSunDir)), 0.0);
        vec3 c = mix(rock, ice, snow) * lit;
        // stays low-contrast: mostly horizon haze, more at the foot than at the summit
        float haze = mix(0.78, 0.4, smoothstep(0.0, uPeak, vP.y));
        c = mix(c, uHaze, haze);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  disposables.push(mMat);
  const mountain = new THREE.Mesh(mg, mMat);
  mountain.position.set(95, -6, -800);
  mountain.renderOrder = -950;
  mountain.name = 'rainier';
  group.add(mountain);

  return {
    group,
    land,
    landMat,
    setHaze(c, sunDir, snow) {
      hazeUniforms.uHaze.value.copy(c);
      hazeUniforms.uSunDir.value.copy(sunDir);
      hazeUniforms.uSnow.value = snow;
      landSnowU.value = snow;
    },
    setGlow(k) {
      landGlowU.value = k;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}
