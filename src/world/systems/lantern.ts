// Paper lanterns.
//  createLantern     one small floating chōchin-style lantern (Jay's, parents', friends', the CSO red one):
//                    washi body lit from inside (emissive through the transmission map + bamboo ribs), ink caps,
//                    a soft additive halo so it still reads at distance, optional real point light.
//  createLanternPool many rising lanterns on the GPU (one instanced body draw + one instanced halo draw).
//                    Motion is closed-form in the vertex shader: no per-frame CPU work beyond one uniform.
import type * as THREE_NS from 'three';
import { valueNoise2 } from './noise';
import { acquireWashi, releaseWashi } from './washi';

type THREE = typeof THREE_NS;

export interface LanternOptions {
  /** Glow colour. Default lantern gold #F2A93B. */
  color?: THREE_NS.ColorRepresentation;
  /** Body height in world units. Default 0.12. */
  size?: number;
  /** Starting intensity (0 = unlit, 1 = normal, 2 = bright). Default 1. */
  intensity?: number;
  /** Add a real PointLight (costly: affects every lit material in the scene). Default false. */
  light?: boolean;
  /** PointLight range (world units). Default 3. */
  lightDistance?: number;
  /** PointLight intensity at lantern intensity 1. Default 1.2. */
  lightIntensity?: number;
  /** Candle flicker (turn off for reduced motion). Default true. */
  flicker?: boolean;
  /** Halo sprite (additive). Default true. */
  halo?: boolean;
  /** Seed for flicker phase. */
  seed?: number;
}

export interface Lantern {
  group: THREE_NS.Group;
  /** The PointLight if `light` was requested. */
  light: THREE_NS.PointLight | null;
  setIntensity(intensity: number): void;
  setColor(color: THREE_NS.ColorRepresentation): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

/** Chōchin profile (radius, y) for a body of height 1 and max radius 0.42. */
export function lanternProfile(THREE: THREE, segments = 10): THREE_NS.Vector2[] {
  const pts: THREE_NS.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = 0.27 + 0.15 * Math.sin(Math.PI * t);
    pts.push(new THREE.Vector2(r, t - 0.5));
  }
  return pts;
}

let haloTex: { tex: THREE_NS.Texture; refs: number } | null = null;
function acquireHalo(THREE: THREE): THREE_NS.Texture {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    haloTex = { tex, refs: 0 };
  }
  haloTex.refs++;
  return haloTex.tex;
}
function releaseHalo() {
  if (!haloTex) return;
  if (--haloTex.refs <= 0) {
    haloTex.tex.dispose();
    haloTex = null;
  }
}

let ribTex: { tex: THREE_NS.Texture; refs: number } | null = null;
/** Emissive mask along the lathe's v: bamboo ribs hold light back, the paper between them glows. */
function acquireRibs(THREE: THREE): THREE_NS.Texture {
  if (!ribTex) {
    const H = 128;
    const data = new Uint8Array(4 * H * 4);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      const rib = Math.abs(((v * 7) % 1) - 0.5) * 2; // 1 at gaps' centres, 0 on the ribs
      const edge = Math.min(1, Math.min(v, 1 - v) * 9); // darker towards the caps
      const val = (0.45 + 0.55 * Math.pow(rib, 0.35)) * (0.35 + 0.65 * edge);
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.round(val * 255);
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, 4, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    ribTex = { tex, refs: 0 };
  }
  ribTex.refs++;
  return ribTex.tex;
}
function releaseRibs() {
  if (!ribTex) return;
  if (--ribTex.refs <= 0) {
    ribTex.tex.dispose();
    ribTex = null;
  }
}

export function createLantern(THREE: THREE, opts: LanternOptions = {}): Lantern {
  const size = opts.size ?? 0.12;
  const color = new THREE.Color(opts.color ?? '#F2A93B');
  const flicker = opts.flicker ?? true;
  const seed = opts.seed ?? Math.random() * 100;
  let intensity = opts.intensity ?? 1;

  const group = new THREE.Group();
  group.name = 'lantern';

  const washi = acquireWashi(THREE);
  const ribs = acquireRibs(THREE);
  const bodyGeo = new THREE.LatheGeometry(lanternProfile(THREE, 10), 14);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d8c7a6'),
    map: washi.albedo,
    roughness: 0.9,
    metalness: 0,
    emissive: color.clone(),
    emissiveMap: ribs,
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.setScalar(size);
  group.add(body);

  const capGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.045, 14);
  const capMat = new THREE.MeshStandardMaterial({ color: '#1c1b19', roughness: 0.7 });
  const capTop = new THREE.Mesh(capGeo, capMat);
  capTop.position.y = 0.5 * size;
  capTop.scale.setScalar(size);
  const capBot = new THREE.Mesh(capGeo, capMat);
  capBot.position.y = -0.5 * size;
  capBot.scale.setScalar(size);
  group.add(capTop, capBot);

  let halo: THREE_NS.Sprite | null = null;
  let haloMat: THREE_NS.SpriteMaterial | null = null;
  if (opts.halo ?? true) {
    haloMat = new THREE.SpriteMaterial({
      map: acquireHalo(THREE),
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: true,
    });
    halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(size * 5);
    halo.renderOrder = 2;
    group.add(halo);
  }

  let light: THREE_NS.PointLight | null = null;
  const lightBase = opts.lightIntensity ?? 1.2;
  if (opts.light) {
    light = new THREE.PointLight(color, lightBase, opts.lightDistance ?? 3, 1.6);
    light.position.y = 0;
    group.add(light);
  }

  let flick = 1;
  const apply = () => {
    const k = intensity * flick;
    bodyMat.emissiveIntensity = 1.35 * k;
    if (haloMat) haloMat.opacity = Math.min(1, 0.75 * k);
    if (light) light.intensity = lightBase * k;
  };
  apply();

  return {
    group,
    light,
    setIntensity(v) {
      intensity = Math.max(0, v);
      apply();
    },
    setColor(c) {
      color.set(c);
      bodyMat.emissive.copy(color);
      haloMat?.color.copy(color);
      light?.color.copy(color);
    },
    update(_dt, time) {
      if (!flicker) return;
      flick = 0.9 + 0.16 * valueNoise2(time * 6 + seed, seed * 3.1) + 0.04 * Math.sin(time * 17 + seed);
      apply();
    },
    dispose() {
      bodyGeo.dispose();
      bodyMat.dispose();
      capGeo.dispose();
      capMat.dispose();
      haloMat?.dispose();
      if (haloMat) releaseHalo();
      light?.dispose();
      releaseWashi();
      releaseRibs();
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Instanced pool of rising lanterns

export interface LanternPoolOptions {
  /** World point lanterns rise from. */
  origin?: THREE_NS.Vector3;
  /** Final horizontal spread (x, z) in world units. Default [30, 30]. */
  area?: [number, number];
  /** Rise height over one life. Default 18. */
  height?: number;
  /** Seconds per rise cycle (lanterns loop back to the origin). Default 26. */
  life?: number;
  /** Body height. Default 0.22. */
  size?: number;
  color?: THREE_NS.ColorRepresentation;
  /** 0..1 how much each lantern's hue wanders towards red/amber. Default 0.35. */
  hueJitter?: number;
  /** Bob and sway (turn down for reduced motion: lanterns still rise, slower). Default 1. */
  sway?: number;
}

export interface LanternPool {
  group: THREE_NS.Group;
  /** Activate n more lanterns that start rising from the origin now. Returns active count. */
  release(n?: number): number;
  /** Set the active count; newly activated ones are spread through their life (already aloft). */
  setActive(n: number): void;
  readonly active: number;
  readonly capacity: number;
  setOrigin(x: number, y: number, z: number): void;
  setIntensity(v: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

const POOL_COMMON = /* glsl */ `
uniform float uTime, uLife, uHeight, uSway, uSize;
uniform vec3 uOrigin;
uniform vec2 uArea;
attribute vec4 aSeed;   // x,z spread, phase, speed
attribute float aBirth; // seconds; lanterns loop every uLife
float lifeK(){ return fract(max(0.0, uTime - aBirth) / (uLife * (0.8 + 0.4*aSeed.w))); }
vec3 lanternCenter(float k){
  vec3 start = uOrigin + vec3((aSeed.x-0.5)*2.0, 0.0, (aSeed.y-0.5)*2.0);
  vec3 end = uOrigin + vec3((aSeed.x-0.5)*uArea.x, 0.0, (aSeed.y-0.5)*uArea.y);
  float spread = 1.0 - pow(1.0 - min(k / 0.7, 1.0), 2.0);
  vec3 p = mix(start, end, spread);
  p.y += k * uHeight * (0.8 + 0.4*aSeed.w);
  float ph = aSeed.z * 6.2832;
  p.x += sin(uTime*0.55 + ph) * 0.35 * uSway * k;
  p.z += cos(uTime*0.43 + ph*1.3) * 0.35 * uSway * k;
  return p;
}
float lanternScale(float k){ return smoothstep(0.0, 0.04, k) * (1.0 - smoothstep(0.86, 1.0, k)); }
`;

export function createLanternPool(THREE: THREE, count: number, opts: LanternPoolOptions = {}): LanternPool {
  const group = new THREE.Group();
  group.name = 'lantern-pool';
  const color = new THREE.Color(opts.color ?? '#F2A93B');
  const life = opts.life ?? 26;

  const seeds = new Float32Array(count * 4);
  const births = new Float32Array(count);
  const hues = new Float32Array(count * 3);
  const jitter = opts.hueJitter ?? 0.35;
  const red = new THREE.Color('#d9552e');
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = (n: number) => {
      const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    seeds[i * 4] = r(1);
    seeds[i * 4 + 1] = r(2);
    seeds[i * 4 + 2] = r(3);
    seeds[i * 4 + 3] = r(4);
    tmp.copy(color).lerp(red, r(5) * jitter);
    hues[i * 3] = tmp.r;
    hues[i * 3 + 1] = tmp.g;
    hues[i * 3 + 2] = tmp.b;
  }

  const uniforms = {
    uTime: { value: 0 },
    uLife: { value: life },
    uHeight: { value: opts.height ?? 18 },
    uSway: { value: opts.sway ?? 1 },
    uSize: { value: opts.size ?? 0.22 },
    uOrigin: { value: (opts.origin ?? new THREE.Vector3()).clone() },
    uArea: { value: new THREE.Vector2(...(opts.area ?? [30, 30])) },
    uIntensity: { value: 1 },
  };

  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 4);
  const birthAttr = new THREE.InstancedBufferAttribute(births, 1);
  birthAttr.setUsage(THREE.DynamicDrawUsage);
  const hueAttr = new THREE.InstancedBufferAttribute(hues, 3);

  // body
  const lathe = new THREE.LatheGeometry(lanternProfile(THREE, 6), 8);
  const bodyGeo = new THREE.InstancedBufferGeometry();
  bodyGeo.index = lathe.index;
  bodyGeo.setAttribute('position', lathe.getAttribute('position'));
  bodyGeo.setAttribute('uv', lathe.getAttribute('uv'));
  bodyGeo.setAttribute('aSeed', seedAttr);
  bodyGeo.setAttribute('aBirth', birthAttr);
  bodyGeo.setAttribute('aHue', hueAttr);
  bodyGeo.instanceCount = 0;

  const fogUniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms, ...uniforms },
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      ${POOL_COMMON}
      attribute vec3 aHue;
      varying vec3 vHue; varying float vV; varying float vK;
      void main(){
        float k = lifeK();
        vec3 c = lanternCenter(k);
        float s = lanternScale(k) * uSize;
        vec3 transformed = c + position * s;
        vHue = aHue; vV = uv.y; vK = k;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uIntensity;
      varying vec3 vHue; varying float vV; varying float vK;
      void main(){
        float rib = 0.55 + 0.45*pow(abs(fract(vV*6.0)-0.5)*2.0, 0.4);
        float hot = mix(1.5, 0.8, vV);              // candle sits low: bottom of the paper is brightest
        float cap = smoothstep(0.0, 0.08, vV) * smoothstep(1.0, 0.92, vV);
        vec3 col = vHue * rib * hot * uIntensity * mix(0.12, 1.0, cap) * 1.6;
        col *= 1.0 - 0.5*smoothstep(0.7, 1.0, vK);  // dims as it burns down
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  group.add(body);

  // halo
  const quad = new THREE.PlaneGeometry(1, 1);
  const haloGeo = new THREE.InstancedBufferGeometry();
  haloGeo.index = quad.index;
  haloGeo.setAttribute('position', quad.getAttribute('position'));
  haloGeo.setAttribute('aSeed', seedAttr);
  haloGeo.setAttribute('aBirth', birthAttr);
  haloGeo.setAttribute('aHue', hueAttr);
  haloGeo.instanceCount = 0;
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms, ...uniforms },
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      ${POOL_COMMON}
      attribute vec3 aHue;
      varying vec3 vHue; varying vec2 vP; varying float vA;
      void main(){
        float k = lifeK();
        vec3 c = lanternCenter(k);
        float s = lanternScale(k) * uSize * 4.0;
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        mvPosition.xy += position.xy * s;
        vHue = aHue; vP = position.xy * 2.0; vA = 1.0 - 0.6*smoothstep(0.6, 1.0, k);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uIntensity;
      varying vec3 vHue; varying vec2 vP; varying float vA;
      void main(){
        float d = length(vP);
        float a = exp(-d*d*9.0)*0.9 + exp(-d*3.5)*0.18;
        a *= 1.0 - smoothstep(0.85, 1.0, d);
        gl_FragColor = vec4(vHue * a * vA * uIntensity * 0.45, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.frustumCulled = false;
  halo.renderOrder = 2;
  group.add(halo);

  let active = 0;
  let now = 0;
  const setCountDraw = () => {
    bodyGeo.instanceCount = active;
    haloGeo.instanceCount = active;
  };

  return {
    group,
    get active() {
      return active;
    },
    capacity: count,
    release(n = 1) {
      const from = active;
      active = Math.min(count, active + n);
      for (let i = from; i < active; i++) births[i] = now - i * 0.0001;
      birthAttr.needsUpdate = true;
      setCountDraw();
      return active;
    },
    setActive(n) {
      const next = Math.max(0, Math.min(count, Math.floor(n)));
      for (let i = active; i < next; i++) births[i] = now - seeds[i * 4 + 2] * life;
      active = next;
      birthAttr.needsUpdate = true;
      setCountDraw();
    },
    setOrigin(x, y, z) {
      uniforms.uOrigin.value.set(x, y, z);
    },
    setIntensity(v) {
      uniforms.uIntensity.value = v;
    },
    update(_dt, time) {
      now = time;
      uniforms.uTime.value = time;
    },
    dispose() {
      lathe.dispose();
      bodyGeo.dispose();
      quad.dispose();
      haloGeo.dispose();
      bodyMat.dispose();
      haloMat.dispose();
      group.removeFromParent();
    },
  };
}
