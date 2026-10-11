// Below the surface (3d-underwater-god-rays): one drifting swell field marched along every view ray at half
// resolution, so the shafts converge on the light above and parallax with the camera; the surface underside
// shimmers and bends the light; the paper boat and the two lanterns hang overhead as silhouettes and glows;
// marine snow and the glyph field give depth; the hidden sea glass is dappled by the same light.
import type * as THREE_NS from 'three';
import { createUnderwaterLight, LIGHT_GLSL, WATER_GLSL } from '../../vendor/underwater-light.mjs';
import { createGlyphField, type GlyphField } from './glyphs';

type THREE = typeof THREE_NS;

interface UnderwaterLightHandle {
  uniforms: Record<string, THREE_NS.IUniform>;
  target: THREE_NS.WebGLRenderTarget;
  setSize(w: number, h: number): { width: number; height: number };
  render(renderer: THREE_NS.WebGLRenderer): void;
  dispose(): void;
}

const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uSunDirection, uCameraPosition;
uniform mat4 uCameraWorld, uInverseProjection;
uniform float uTime, uShaftOn, uUnderGain;
uniform sampler2D uShafts; uniform vec2 uShaftTexel;
uniform vec3 uDeep, uUp, uDiskCol, uCorona, uLantCol;
uniform vec4 uLant[3];
${LIGHT_GLSL}
${WATER_GLSL}
void main(){
  vec4 viewRay = uInverseProjection * vec4(vUv * 2. - 1., 1., 1.);
  vec3 ray = normalize((uCameraWorld * vec4(viewRay.xyz, 0.)).xyz);
  float up = smoothstep(-.55, .64, ray.y);
  vec3 color = mix(uDeep, uUp, up);
  vec3 sunRay = ray;
  color += surfaceUnderside(ray, sunRay) * uUnderGain;
  float facing = max(dot(sunRay, uSunDirection), 0.);
  color += uCorona * pow(facing, 48.) + uDiskCol * pow(facing, 260.);
  // the lanterns above, seen through the moving surface: a warm core and a wide soft bloom
  for (int i = 0; i < 3; i++){
    vec3 d = uLant[i].xyz - uCameraPosition;
    float dist = length(d);
    float c = max(dot(sunRay, d / dist), 0.);
    float att = exp(-dist * 0.06);
    color += uLantCol * uLant[i].w * att * (pow(c, 2600.) * 2.2 + pow(c, 220.) * 0.3 + pow(c, 18.) * 0.035);
  }
  color += underwaterShafts(vUv, ray) * uShaftOn;
  gl_FragColor = vec4(color, 1.);
}`;

export interface UnderwaterOptions {
  isMobile: boolean;
  shafts: boolean;
}

export interface Underwater {
  scene: THREE_NS.Scene;
  uniforms: Record<string, THREE_NS.IUniform>;
  glyphs: GlyphField;
  seaGlass: THREE_NS.Mesh;
  /** Copy the fleet's current world matrices onto the silhouettes. */
  syncSilhouettes(): void;
  setShafts(on: boolean): void;
  /** Sea glass glint level (hover / collected flourish). */
  setGlint(v: number): void;
  setSize(w: number, h: number): void;
  /** Run the half-res march (only when shafts are on). */
  march(renderer: THREE_NS.WebGLRenderer): void;
  dispose(): void;
}

export function createUnderwater(
  THREE: THREE,
  camera: THREE_NS.PerspectiveCamera,
  fleet: { boat: THREE_NS.Object3D; lanterns: THREE_NS.Object3D[]; skip?: THREE_NS.Object3D },
  opts: UnderwaterOptions,
): Underwater {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0.006, 0.03, 0.045);
  scene.fog = new THREE.FogExp2(fogColor, 0.06);

  const uniforms: Record<string, THREE_NS.IUniform> = {
    uSunDirection: { value: new THREE.Vector3(0, 0.7, 0.7).normalize() },
    uTime: { value: 0 },
    uCameraPosition: { value: camera.position },
    uCameraWorld: { value: camera.matrixWorld },
    uInverseProjection: { value: camera.projectionMatrixInverse },
    uShaftOn: { value: opts.shafts ? 1 : 0 },
    uUnderGain: { value: 1 },
    uDeep: { value: new THREE.Vector3(0.0012, 0.008, 0.016) },
    uUp: { value: new THREE.Vector3(0.005, 0.03, 0.048) },
    uDiskCol: { value: new THREE.Vector3(0.8, 0.95, 1.05) },
    uCorona: { value: new THREE.Vector3(0.03, 0.07, 0.09) },
    uLantCol: { value: new THREE.Vector3(3.2, 1.55, 0.45) },
    uLant: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uGlint: { value: 1 },
    uGlassCol: { value: new THREE.Vector3(0.1, 0.62, 0.48) },
    uFogCol: { value: new THREE.Vector3(0.006, 0.03, 0.045) },
  };
  const light = createUnderwaterLight(THREE, {
    uniforms,
    surfaceY: 0,
    shaftScale: 0.85,
    gain: 2.6,
    color: [0.16, 0.4, 0.47],
    resolution: opts.isMobile ? 0.35 : 0.5,
  }) as unknown as UnderwaterLightHandle;

  // full-screen water (drawn first, no depth)
  const waterMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: WATER_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const water = new THREE.Mesh(quadGeo, waterMat);
  water.frustumCulled = false;
  water.renderOrder = -100;
  scene.add(water);

  // silhouettes of the fleet: share geometry, follow the real meshes' world matrices.
  // The boat is folded washi seen from below against the Snell window: a dark body where the folds stack up, the
  // thin single sheets letting cool moonlight (and the bow lantern's warmth) through, a refracted rim of light, and
  // a slow wobble on everything above the waterline (it is seen through the moving surface).
  const SIL_VERT = /* glsl */ `
    uniform float uTime;
    varying vec3 vN; varying vec3 vW; varying vec3 vL;
    void main(){
      vL = position;
      vec4 w = modelMatrix * vec4(position, 1.0);
      float above = smoothstep(-0.3, 0.4, w.y);
      w.x += above * (sin(w.z * 0.9 + uTime * 1.3) * 0.07 + sin(w.x * 1.7 - uTime * 0.9) * 0.04);
      w.z += above * cos(w.x * 0.8 + uTime * 1.1) * 0.07;
      vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const silMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: SIL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uCameraPosition, uSunDirection, uDiskCol, uLantCol, uFogCol; uniform vec4 uLant[3]; uniform float uTime;
      varying vec3 vN; varying vec3 vW; varying vec3 vL;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + 1.0), u.x), u.y); }
      void main(){
        vec3 N = vN / max(length(vN), 1e-4); vec3 V = normalize(uCameraPosition - vW);
        float nv = clamp(abs(dot(N, V)), 0.0, 1.0);
        // washi formation: cloudy fibre density decides how much light the sheet lets through
        float fib = vn(vL.xz * 34.0) * 0.6 + vn(vL.xy * 90.0) * 0.4;
        // Back-lit washi (3d-paper-material): light from the bright surface passes THROUGH the sheet, so the paper
        // glows a soft cream from below, evenly across a face (not by view angle, which made every facet a different
        // blue and the boat read as a crystal). Faces that lie flatter catch more of the sky above; folds where the
        // sheet doubles stay darker; the fibre cloud mottles it.
        float sky = 0.35 + 0.65 * abs(N.y);
        float layers = 0.55 + 0.45 * smoothstep(0.1, 0.8, nv);
        float thin = sky * layers * (0.6 + 0.4 * fib);
        vec3 body = vec3(0.004, 0.009, 0.013);
        vec3 paper = vec3(0.86, 0.8, 0.66);
        vec3 through = paper * (uDiskCol * 0.11) * thin;
        // the bow lantern's warmth glows through the hull from inside: a wide, soft warm patch on the paper
        float dl = length(vW - uLant[0].xyz);
        vec3 warm = uLantCol * uLant[0].w * (exp(-dl * 0.45) * 0.1 + exp(-dl * 1.4) * 0.16) * (0.55 + 0.45 * fib);
        // a thin refracted edge only where the sheet turns fully edge-on (outlines the folded shape)
        float rim = pow(1.0 - nv, 5.0);
        vec3 col = body + through + warm + paper * uDiskCol * rim * 0.09;
        float d = length(uCameraPosition - vW);
        col = mix(col, uFogCol, 1.0 - exp(-d * 0.05));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // the companion lanterns from below: paper globes lit from inside, brightest where the sheet faces you
  const warmMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: SIL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uCameraPosition, uLantCol, uFogCol;
      varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){
        vec3 N = vN / max(length(vN), 1e-4); vec3 V = normalize(uCameraPosition - vW);
        float nv = clamp(abs(dot(N, V)), 0.0, 1.0);
        float ribs = 0.82 + 0.18 * sin(vL.y * 70.0);
        vec3 col = uLantCol * (0.12 + 0.5 * pow(nv, 1.6)) * ribs;
        float d = length(uCameraPosition - vW);
        col = mix(col, uFogCol, 1.0 - exp(-d * 0.05));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const pairs: { src: THREE_NS.Object3D; dst: THREE_NS.Mesh }[] = [];
  const skip = new Set<THREE_NS.Object3D>();
  fleet.skip?.traverse((o) => skip.add(o));
  const addSil = (root: THREE_NS.Object3D, mat: THREE_NS.Material) =>
    root.traverse((o) => {
      const m = o as THREE_NS.Mesh;
      if (!m.isMesh || skip.has(m)) return;
      const dst = new THREE.Mesh(m.geometry, mat);
      dst.matrixAutoUpdate = false;
      dst.frustumCulled = false;
      scene.add(dst);
      pairs.push({ src: m, dst });
    });
  addSil(fleet.boat, silMat);
  fleet.lanterns.forEach((l) => addSil(l, warmMat));
  if (fleet.skip) addSil(fleet.skip, warmMat);

  // marine snow: tiny motes wrapped in a box that rides with the camera
  const moteCount = opts.isMobile ? 220 : 420;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    motePos[i * 3 + 1] = (Math.sin(i * 78.233) * 12543.1234) % 1;
    motePos[i * 3 + 2] = (Math.sin(i * 39.425) * 31337.777) % 1;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uPx: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec3 uSunDirection; uniform vec3 uCameraPosition; uniform float uTime, uPx;
      ${LIGHT_GLSL}
      varying float vA;
      void main(){
        vec3 box = vec3(14.0, 10.0, 14.0);
        vec3 p = position * box * 0.5 + vec3(sin(uTime * 0.2 + position.x * 9.0) * 0.3, -uTime * 0.05, cos(uTime * 0.17 + position.z * 7.0) * 0.3);
        vec3 rel = mod(p - uCameraPosition + box * 0.5, box) - box * 0.5;
        vec3 wp = uCameraPosition + rel;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        float d = -mv.z;
        vA = (0.25 + 0.75 * shaftLight(wp, uTime)) * smoothstep(0.4, 1.5, d) * exp(-d * 0.16) * step(wp.y, -0.2);
        gl_PointSize = clamp(uPx * 2.2 / max(d, 0.5), 1.0, 5.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c)) * vA;
        gl_FragColor = vec4(vec3(0.55, 0.8, 0.85) * 0.6, a);
      }`,
  });
  // share the live uniform objects (the spread above copies references, so values stay in sync)
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 4;
  scene.add(motes);

  // the glyph field
  const glyphs = createGlyphField(THREE, opts.isMobile ? 40 : 64);
  scene.add(glyphs.mesh);

  // the hidden sea glass: a small worn shard of bottle-green glass. Frosted skin, a light trapped inside it (it
  // glows from within where it is thickest), and a caustic glint that crawls over it with the shafts.
  const glassGeo = new THREE.IcosahedronGeometry(0.11, 3);
  {
    const p = glassGeo.getAttribute('position') as THREE_NS.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const w = 1 + 0.1 * Math.sin(x * 40 + z * 31) * Math.cos(y * 37);
      p.setXYZ(i, x * 1.25 * w, y * 0.55 * w, z * 0.9 * w);
    }
    glassGeo.computeVertexNormals();
  }
  const glassMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDirection, uCameraPosition, uGlassCol, uFogCol; uniform float uTime, uGlint;
      ${LIGHT_GLSL}
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = vN / max(length(vN), 1e-4); vec3 V = normalize(uCameraPosition - vW);
        float nv = clamp(dot(N, V), 0.0, 1.0);
        float caustic = shaftLight(vW * 3.0, uTime * 1.4);
        float fres = pow(1.0 - nv, 2.5);
        vec3 R = reflect(-V, N);
        float spec = pow(max(dot(R, uSunDirection), 0.0), 40.0);
        // inner glow: the thick (facing) body carries the trapped light; the edges go clear and pick up the sea
        vec3 inner = uGlassCol * (0.25 + 0.9 * pow(nv, 2.0)) * (0.6 + 0.5 * uGlint);
        vec3 col = inner + uGlassCol * fres * 0.6
                 + vec3(0.85, 1.0, 0.92) * (spec * 1.8 + caustic * 0.9) * (0.5 + 0.5 * uGlint);
        float d = length(uCameraPosition - vW);
        col = mix(col, uFogCol, 1.0 - exp(-d * 0.035));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // a soft halo around it (screen-facing sprite) so a small stone still reads as "something glints"
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(150,255,215,0.85)');
    gr.addColorStop(0.22, 'rgba(80,200,170,0.3)');
    gr.addColorStop(1, 'rgba(30,110,100,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: new THREE.Color(0.35, 0.5, 0.45),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(0.8);
  halo.renderOrder = 2;
  const seaGlass = new THREE.Mesh(glassGeo, glassMat);
  seaGlass.renderOrder = 3;
  seaGlass.add(halo);
  scene.add(seaGlass);

  return {
    scene,
    uniforms,
    glyphs,
    seaGlass,
    syncSilhouettes() {
      for (const { src, dst } of pairs) {
        dst.matrix.copy(src.matrixWorld);
        dst.matrixWorld.copy(src.matrixWorld);
        dst.visible = src.visible;
      }
    },
    setShafts(on) {
      uniforms.uShaftOn.value = on ? 1 : 0;
    },
    setGlint(v) {
      uniforms.uGlint.value = v;
      haloMat.opacity = Math.min(1, 0.45 + 0.3 * v);
    },
    setSize(w, h) {
      light.setSize(w, h);
      moteMat.uniforms.uPx.value = h / 900 * 6;
    },
    march(renderer) {
      if (uniforms.uShaftOn.value > 0) light.render(renderer);
    },
    dispose() {
      light.dispose();
      waterMat.dispose();
      quadGeo.dispose();
      silMat.dispose();
      warmMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      glyphs.dispose();
      glassGeo.dispose();
      glassMat.dispose();
      haloTex.dispose();
      haloMat.dispose();
    },
  };
}
