// Camera-correct procedural sky dome (3d-sky-background).
// - Inward sphere that follows camera translation (onBeforeRender) but keeps world orientation; depthWrite/fog off,
//   drawn first. Colour comes from the normalised view direction only, so no parallax and no seam.
// - Pale warm horizon -> muted middle band -> cooler zenith; lower hemisphere blends into a ground/haze colour so a
//   low camera never sees a hard edge.
// - One shared sun direction: small disk + broad halo as separate terms (no white blob). Optional moon disk + stars.
// - States are plain data; lerpSkyState / skyStateForHour give continuous day/dusk/night weights.
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from './noise';

type THREE = typeof THREE_NS;

export interface SkyState {
  horizon: THREE_NS.Color;
  zenith: THREE_NS.Color;
  /** Below-horizon / ground haze colour. */
  ground: THREE_NS.Color;
  /** Unit vector toward the sun (also feed your DirectionalLight from this). */
  sunDir: THREE_NS.Vector3;
  sunColor: THREE_NS.Color;
  /** 0..1 visible sun disk + glow strength. */
  sun: number;
  /** 0..1 star visibility. */
  stars: number;
  /** 0..1 moon visibility. */
  moon: number;
  moonDir: THREE_NS.Vector3;
  /** Horizon haze band thickness, ~0.05..0.4. */
  haze: number;
}

export interface SkyStateInput {
  horizon?: THREE_NS.ColorRepresentation;
  zenith?: THREE_NS.ColorRepresentation;
  ground?: THREE_NS.ColorRepresentation;
  sunDir?: THREE_NS.Vector3 | [number, number, number];
  sunColor?: THREE_NS.ColorRepresentation;
  sun?: number;
  stars?: number;
  moon?: number;
  moonDir?: THREE_NS.Vector3 | [number, number, number];
  haze?: number;
}

export interface SkyOptions extends SkyStateInput {
  /** Dome radius. Must sit inside camera.far. Default 900. */
  radius?: number;
  /** Twinkle stars (off under reduced motion). Default true. */
  twinkle?: boolean;
}

export interface Sky {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  /** The live state (mutate + call apply(), or use setState). */
  state: SkyState;
  setState(s: SkyStateInput | SkyState): void;
  /** Writes the horizon colour into `out` (handy for scene.fog.color / the DOM veil). */
  fogColor(out: THREE_NS.Color): THREE_NS.Color;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function makeSkyState(THREE: THREE, s: SkyStateInput = {}): SkyState {
  const v = (x: SkyStateInput['sunDir'], d: [number, number, number]) =>
    x instanceof THREE.Vector3 ? x.clone().normalize() : new THREE.Vector3(...(x ?? d)).normalize();
  return {
    horizon: new THREE.Color(s.horizon ?? '#d9c7b0'),
    zenith: new THREE.Color(s.zenith ?? '#5d7a8c'),
    ground: new THREE.Color(s.ground ?? s.horizon ?? '#9aa79f'),
    sunDir: v(s.sunDir, [0.6, 0.12, -0.8]),
    sunColor: new THREE.Color(s.sunColor ?? '#ffd2a0'),
    sun: s.sun ?? 1,
    stars: s.stars ?? 0,
    moon: s.moon ?? 0,
    moonDir: v(s.moonDir, [-0.4, 0.35, -0.85]),
    haze: s.haze ?? 0.18,
  };
}

/** out = a→b at t. No allocation. Directions are slerp-ish (lerp + normalise). */
export function lerpSkyState(a: SkyState, b: SkyState, t: number, out: SkyState): SkyState {
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.ground.copy(a.ground).lerp(b.ground, t);
  out.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.moonDir.copy(a.moonDir).lerp(b.moonDir, t).normalize();
  out.sun = a.sun + (b.sun - a.sun) * t;
  out.stars = a.stars + (b.stars - a.stars) * t;
  out.moon = a.moon + (b.moon - a.moon) * t;
  out.haze = a.haze + (b.haze - a.haze) * t;
  return out;
}

/** Authored key states. Sun azimuth convention: -z is "ahead" (east in the crossing). */
export function skyPresets(THREE: THREE) {
  return {
    night: makeSkyState(THREE, {
      horizon: '#22344a',
      zenith: '#060d18',
      ground: '#0b1a2a',
      sunDir: [0.2, -0.3, -0.9],
      sunColor: '#6d7fa0',
      sun: 0,
      stars: 1,
      moon: 1,
      moonDir: [-0.35, 0.42, -0.84],
      haze: 0.22,
    }),
    dawn: makeSkyState(THREE, {
      horizon: '#f2b98f',
      zenith: '#4d6688',
      ground: '#7d8a99',
      sunDir: [0.15, 0.03, -1],
      sunColor: '#ffc89a',
      sun: 1,
      stars: 0.15,
      moon: 0,
      haze: 0.26,
    }),
    day: makeSkyState(THREE, {
      horizon: '#dfe4e0',
      zenith: '#7f9fb6',
      ground: '#b9c2bf',
      sunDir: [0.3, 0.75, -0.6],
      sunColor: '#fff3dd',
      sun: 0.8,
      stars: 0,
      moon: 0,
      haze: 0.2,
    }),
    /** Jiangyin river dusk: jade mist, warm low horizon, cool zenith. */
    dusk: makeSkyState(THREE, {
      horizon: '#cfc4ad',
      zenith: '#56707c',
      ground: '#9db5a8',
      sunDir: [0.55, 0.05, -0.83],
      sunColor: '#ffae70',
      sun: 1,
      stars: 0.05,
      moon: 0,
      haze: 0.3,
    }),
    /** OC golden hour. */
    golden: makeSkyState(THREE, {
      horizon: '#f6c08f',
      zenith: '#6f93b4',
      ground: '#c9a07c',
      sunDir: [-0.7, 0.12, -0.7],
      sunColor: '#ffcf8f',
      sun: 1,
      stars: 0,
      moon: 0,
      haze: 0.24,
    }),
    /** Seattle overcast rain: low contrast, cool green-grey. */
    overcast: makeSkyState(THREE, {
      horizon: '#aab4b3',
      zenith: '#6d7b7f',
      ground: '#5b6b66',
      sunDir: [0.2, 0.5, -0.8],
      sunColor: '#d9dde0',
      sun: 0.08,
      stars: 0,
      moon: 0,
      haze: 0.45,
    }),
  };
}

/**
 * Continuous state for a local hour 0..24 (visitor's clock): night → dawn (≈6) → day (≈12) → dusk (≈18.5) → night.
 * Pass `out` to avoid allocation (presets are cached per call site by the caller if called per frame).
 */
export function skyStateForHour(THREE: THREE, hour: number, out?: SkyState, presets = skyPresets(THREE)): SkyState {
  const h = ((hour % 24) + 24) % 24;
  const P = presets;
  const keys: [number, SkyState][] = [
    [0, P.night],
    [4.8, P.night],
    [6.3, P.dawn],
    [9, P.day],
    [16, P.day],
    [18.6, P.dusk],
    [20.2, P.night],
    [24, P.night],
  ];
  const o = out ?? makeSkyState(THREE);
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, s0] = keys[i];
    const [h1, s1] = keys[i + 1];
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      return lerpSkyState(s0, s1, t * t * (3 - 2 * t), o);
    }
  }
  return lerpSkyState(P.night, P.night, 0, o);
}

export function createSky(THREE: THREE, opts: SkyOptions = {}): Sky {
  const radius = opts.radius ?? 900;
  const state = makeSkyState(THREE, opts);
  const uniforms: Record<string, THREE_NS.IUniform> = {
    uHorizon: { value: state.horizon.clone() },
    uZenith: { value: state.zenith.clone() },
    uGround: { value: state.ground.clone() },
    uSunDir: { value: state.sunDir.clone() },
    uSunColor: { value: state.sunColor.clone() },
    uSun: { value: state.sun },
    uStars: { value: state.stars },
    uMoon: { value: state.moon },
    uMoonDir: { value: state.moonDir.clone() },
    uHaze: { value: state.haze },
    uTime: { value: 0 },
  };
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w * 0.99999; // pin to the far plane
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uHorizon, uZenith, uGround, uSunDir, uSunColor, uMoonDir;
      uniform float uSun, uStars, uMoon, uHaze, uTime;
      varying vec3 vDir;
      vec3 skyColor(vec3 d){
        float y = d.y;
        // horizon -> muted middle band -> zenith
        float t = pow(clamp(y, 0.0, 1.0), 0.55);
        vec3 mid = mix(uHorizon, uZenith, 0.42) * 0.96;
        vec3 c = y > 0.0 ? mix(mix(uHorizon, mid, smoothstep(0.0, 0.45, t)), uZenith, smoothstep(0.35, 1.0, t)) : uHorizon;
        // lower hemisphere melts into ground haze
        c = mix(c, uGround, smoothstep(0.0, -0.18, y));
        // horizon haze band, warmed toward the sun
        float sunAz = max(0.0, dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5)));
        float band = exp(-abs(y) / max(0.02, uHaze * 0.35));
        c = mix(c, mix(uHorizon, uSunColor, 0.35 * pow(sunAz, 3.0) * uSun) * 1.04, band * 0.55);
        return c;
      }
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // sun: broad halo + small disk as separate terms
        float cs = dot(d, uSunDir);
        float halo = pow(max(cs, 0.0), 8.0) * 0.32 + pow(max(cs, 0.0), 90.0) * 0.55;
        float disk = smoothstep(0.99955, 0.99975, cs);
        float above = smoothstep(-0.02, 0.02, d.y);
        c += uSunColor * (halo + disk * 6.0 * above) * uSun;
        // stars: cell-hashed points on the direction sphere, fading toward the horizon haze
        if (uStars > 0.001 && d.y > -0.05) {
          // cube-face 2D grid: jittered point per cell, radius + jitter < 0.5 so no star is clipped by its cell
          vec3 ad = abs(d); vec2 uv; float face;
          if (ad.x >= ad.y && ad.x >= ad.z) { uv = d.yz / ad.x; face = sign(d.x); }
          else if (ad.y >= ad.z) { uv = d.xz / ad.y; face = 2.0 + sign(d.y); }
          else { uv = d.xy / ad.z; face = 4.0 + sign(d.z); }
          vec2 g = uv * 95.0;
          vec2 cell = floor(g);
          vec2 key = cell + face * 131.0;
          float h = hash12(key);
          if (h > 0.9) {
            vec2 ctr = 0.5 + (hash22(key + 7.0) - 0.5) * 0.5;
            float r = length(g - cell - ctr);
            float fw = max(fwidth(g.x), 1e-4);
            float mag = pow(hash12(key + 9.3), 6.0);
            float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
            float rad = 0.05 + mag * 0.12;
            float s = (1.0 - smoothstep(rad, rad + fw * 1.2, r)) * (0.35 + 1.4 * mag) * tw;
            c += vec3(0.95, 0.96, 1.0) * s * uStars * smoothstep(0.02, 0.25, d.y);
          }
        }
        // moon: soft disk with faint maria, plus a cool glow
        if (uMoon > 0.001) {
          float cm = dot(d, normalize(uMoonDir));
          float md = smoothstep(0.99935, 0.99952, cm);
          vec3 mt = normalize(uMoonDir);
          vec3 tu = normalize(cross(mt, vec3(0.0,1.0,0.0)));
          vec3 tv = cross(tu, mt);
          vec2 mp = vec2(dot(d, tu), dot(d, tv)) * 900.0;
          float maria = fbm(mp * 0.12 + 3.0, 3);
          vec3 moonCol = vec3(1.0, 0.97, 0.9) * (0.85 - 0.25 * smoothstep(0.45, 0.7, maria));
          float mglow = pow(max(cm, 0.0), 400.0) * 0.35 + pow(max(cm, 0.0), 30.0) * 0.06;
          c = mix(c, moonCol * 2.2, md * uMoon);
          c += vec3(0.75, 0.82, 0.95) * mglow * uMoon;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };

  const push = () => {
    (uniforms.uHorizon.value as THREE_NS.Color).copy(state.horizon);
    (uniforms.uZenith.value as THREE_NS.Color).copy(state.zenith);
    (uniforms.uGround.value as THREE_NS.Color).copy(state.ground);
    (uniforms.uSunDir.value as THREE_NS.Vector3).copy(state.sunDir).normalize();
    (uniforms.uSunColor.value as THREE_NS.Color).copy(state.sunColor);
    (uniforms.uMoonDir.value as THREE_NS.Vector3).copy(state.moonDir).normalize();
    uniforms.uSun.value = state.sun;
    uniforms.uStars.value = state.stars;
    uniforms.uMoon.value = state.moon;
    uniforms.uHaze.value = state.haze;
  };
  push();
  const twinkle = opts.twinkle ?? true;

  return {
    mesh,
    uniforms,
    state,
    setState(s) {
      if (s.horizon !== undefined) state.horizon.set(s.horizon);
      if (s.zenith !== undefined) state.zenith.set(s.zenith);
      if (s.ground !== undefined) state.ground.set(s.ground);
      if (s.sunColor !== undefined) state.sunColor.set(s.sunColor);
      if (s.sunDir !== undefined) {
        if (Array.isArray(s.sunDir)) state.sunDir.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]);
        else state.sunDir.copy(s.sunDir);
        state.sunDir.normalize();
      }
      if (s.moonDir !== undefined) {
        if (Array.isArray(s.moonDir)) state.moonDir.set(s.moonDir[0], s.moonDir[1], s.moonDir[2]);
        else state.moonDir.copy(s.moonDir);
        state.moonDir.normalize();
      }
      if (s.sun !== undefined) state.sun = s.sun;
      if (s.stars !== undefined) state.stars = s.stars;
      if (s.moon !== undefined) state.moon = s.moon;
      if (s.haze !== undefined) state.haze = s.haze;
      push();
    },
    fogColor(out) {
      return out.copy(state.horizon).lerp(state.ground, 0.35);
    },
    update(_dt, time) {
      if (twinkle) uniforms.uTime.value = time;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
