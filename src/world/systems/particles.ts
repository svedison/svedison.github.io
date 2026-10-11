// Falling petals / leaves (3d-falling-leaves + ambient-section-particles), fully closed-form on the GPU.
//  - real two-sided quads (not point sprites) so each one turns through face, edge and back
//  - lateral slip is COUPLED to the tumble: sideOffset = -(slip/ω)·cos(φ+ωt) → slips fastest when edge-on
//  - separate slow roll; shared wind as a closed-form drift; seeded per-instance values uploaded once
//  - procedural silhouettes (petal: notched oval; leaf: pointed blade with midrib), alpha rejected in-shader with
//    depth writes on (no sorting); back face paler; soft sun transmission
//  - recycled in a box around a movable centre; reset hidden by a scale fade near the box top/bottom
//  - density = instanceCount; nothing allocated after creation
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface FallingQuadsOptions {
  /** Capacity. Default 220. */
  count?: number;
  /** Palette; each instance picks one and varies it slightly. Default cherry pinks. */
  colors?: THREE_NS.ColorRepresentation[];
  /** Quad size in world units. Default 0.09. */
  size?: number;
  /** Box (width, height, depth) the field recycles in. Default [14, 9, 14]. */
  area?: [number, number, number];
  /** Box centre (world). Move it with setCenter (e.g. ahead of the camera). */
  center?: THREE_NS.Vector3;
  shape?: 'petal' | 'leaf';
  /** Fall speed (units/s). Default 0.55. */
  fallSpeed?: number;
  /** Shared wind (xz units/s). Default [0.35, 0.08]. */
  wind?: [number, number];
  /** Sun direction for lighting. */
  sunDir?: THREE_NS.Vector3;
  sunColor?: THREE_NS.ColorRepresentation;
  ambient?: THREE_NS.ColorRepresentation;
  /** Initial active fraction 0..1. Default 1. */
  density?: number;
}

export interface FallingQuads {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  /** Active fraction 0..1 (draw range). */
  setDensity(d: number): void;
  setCenter(x: number, y: number, z: number): void;
  setWind(x: number, z: number): void;
  /** Replace up to 4 palette colours (season change) without reallocating. */
  setColors(colors: THREE_NS.ColorRepresentation[]): void;
  setLight(sunDir: THREE_NS.Vector3, sunColor: THREE_NS.ColorRepresentation, ambient: THREE_NS.ColorRepresentation): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function createFallingQuads(THREE: THREE, opts: FallingQuadsOptions = {}): FallingQuads {
  const count = opts.count ?? 220;
  const palette = (opts.colors ?? ['#f6c9d0', '#f2b5c0', '#fbe3e6', '#e9a3b3']).slice(0, 4);
  while (palette.length < 4) palette.push(palette[palette.length - 1]);
  const [aw, ah, ad] = opts.area ?? [14, 9, 14];

  const seedA = new Float32Array(count * 4); // x, y, z position seeds, palette pick
  const seedB = new Float32Array(count * 4); // phase, omega, slip, roll rate
  for (let i = 0; i < count; i++) {
    const r = (n: number) => {
      const x = Math.sin((i + 1) * 63.71 + n * 19.19) * 43758.5453;
      return x - Math.floor(x);
    };
    seedA[i * 4] = r(1);
    seedA[i * 4 + 1] = r(2);
    seedA[i * 4 + 2] = r(3);
    seedA[i * 4 + 3] = r(4);
    seedB[i * 4] = r(5) * 6.2832;
    seedB[i * 4 + 1] = (1.6 + r(6) * 2.6) * (r(7) < 0.5 ? -1 : 1); // ω bounded away from 0
    seedB[i * 4 + 2] = 0.25 + r(8) * 0.45; // slip
    seedB[i * 4 + 3] = (r(9) - 0.5) * 1.6; // roll rate
  }
  const geo = new THREE.InstancedBufferGeometry();
  // slightly bent quad (2x2 segments) so a petal is cupped, not a card
  const base = new THREE.PlaneGeometry(1, 1, 2, 2);
  const bp = base.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    bp.setZ(i, x * x * 0.35);
  }
  geo.index = base.index;
  geo.setAttribute('position', bp);
  geo.setAttribute('uv', base.getAttribute('uv'));
  geo.setAttribute('aSeedA', new THREE.InstancedBufferAttribute(seedA, 4));
  geo.setAttribute('aSeedB', new THREE.InstancedBufferAttribute(seedB, 4));
  geo.instanceCount = Math.round(count * (opts.density ?? 1));

  const uniforms: Record<string, THREE_NS.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uDrift: { value: new THREE.Vector2() },
    uCenter: { value: (opts.center ?? new THREE.Vector3()).clone() },
    uArea: { value: new THREE.Vector3(aw, ah, ad) },
    uSize: { value: opts.size ?? 0.09 },
    uFall: { value: opts.fallSpeed ?? 0.55 },
    uPalette: { value: palette.map((c) => new THREE.Color(c)) },
    uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(0.4, 0.8, -0.3)).clone().normalize() },
    uSunColor: { value: new THREE.Color(opts.sunColor ?? '#fff1de') },
    uAmbient: { value: new THREE.Color(opts.ambient ?? '#b9b4ab') },
    uLeaf: { value: opts.shape === 'leaf' ? 1 : 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 aSeedA; attribute vec4 aSeedB;
      uniform float uTime, uSize, uFall;
      uniform vec2 uDrift;
      uniform vec3 uCenter, uArea;
      uniform vec3 uPalette[4];
      varying vec2 vUv; varying vec3 vN; varying vec3 vCol; varying vec3 vWorld;
      mat3 rotAxis(vec3 a, float ang){
        float c = cos(ang), s = sin(ang), t = 1.0 - c;
        return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                    t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                    t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
      }
      void main(){
        float phase = aSeedB.x, omega = aSeedB.y, slip = aSeedB.z, rollRate = aSeedB.w;
        float speed = uFall * (0.75 + 0.5 * aSeedA.w);
        // fall + shared wind drift, wrapped into the box around uCenter (world-fixed under centre motion)
        vec3 p = aSeedA.xyz * uArea;
        p.y -= uTime * speed;
        p.xz += uDrift * (0.8 + 0.4 * aSeedA.w);
        // tumble-coupled slip along a per-leaf horizontal heading
        float ang = phase + omega * uTime;
        float heading = aSeedA.w * 6.2832 + phase;
        vec2 hdir = vec2(cos(heading), sin(heading));
        p.xz += hdir * (-(slip / omega) * cos(ang));
        vec3 lo = uCenter - uArea * 0.5;
        p = mod(p - lo, uArea) + lo;
        // hide the wrap: shrink near the box top/bottom and sides
        vec3 q = abs((p - uCenter) / (uArea * 0.5));
        float fade = (1.0 - smoothstep(0.82, 1.0, q.y)) * (1.0 - smoothstep(0.9, 1.0, max(q.x, q.z)));
        // orientation: tumble about the heading-perpendicular axis + slow roll + fixed tilt
        vec3 tAxis = normalize(vec3(-hdir.y, 0.15, hdir.x));
        mat3 R = rotAxis(vec3(0.0, 1.0, 0.0), heading + rollRate * uTime) * rotAxis(tAxis, ang) ;
        float sc = uSize * (0.7 + 0.6 * fract(aSeedA.w * 7.13)) * fade;
        vec3 lp = position * vec3(1.0, 1.0, 1.0);
        vec3 wp = p + R * (lp * sc);
        vN = normalize(R * vec3(0.0, 0.0, 1.0));
        vUv = uv;
        int pi = int(floor(aSeedA.w * 3.999));
        vCol = uPalette[pi] * (0.9 + 0.2 * fract(aSeedA.x * 17.0));
        vWorld = wp;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uSunDir, uSunColor, uAmbient;
      uniform float uLeaf;
      varying vec2 vUv; varying vec3 vN; varying vec3 vCol; varying vec3 vWorld;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float a;
        float vein = 0.0;
        if (uLeaf > 0.5) {
          // pointed blade: width profile along y, stem at the bottom
          float y = p.y;
          float w = 0.62 * pow(max(0.0, 1.0 - y*y), 0.8) * (1.0 - 0.25 * max(0.0, y));
          a = step(abs(p.x), w) * step(-0.92, y) * step(y, 0.98);
          a = max(a, step(abs(p.x), 0.03) * step(-1.0, y) * step(y, -0.8)); // stem
          vein = (1.0 - smoothstep(0.0, 0.045, abs(p.x))) * step(-0.9, y) * 0.35;
          vein += (1.0 - smoothstep(0.0, 0.03, abs(abs(p.x) - (y + 0.6) * 0.35 + 0.05))) * 0.12 * step(abs(p.x), w * 0.85);
        } else {
          // cherry petal: oval with a notch at the tip
          vec2 q = p * vec2(1.25, 1.0);
          float body = length(q * vec2(1.0, 0.9) - vec2(0.0, -0.05));
          float notch = length((p - vec2(0.0, 0.98)) * vec2(1.4, 1.0));
          a = step(body, 0.92) * step(0.28, notch);
        }
        if (a < 0.5) discard;
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 base = vCol * (1.0 - vein);
        // paler, less saturated back
        if (!gl_FrontFacing) base = mix(base, vec3(dot(base, vec3(0.333))), 0.25) * 1.05;
        float ndl = max(dot(n, uSunDir), 0.0);
        float trans = max(dot(-n, uSunDir), 0.0) * 0.35; // soft transmission, linked to the sun
        vec3 col = base * (uAmbient * 0.9 + uSunColor * (ndl + trans));
        // edge darkening toward the rim for a little form
        col *= 0.85 + 0.15 * (1.0 - smoothstep(0.5, 1.0, length(p)));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'falling-quads';
  mesh.frustumCulled = false;

  let wx = (opts.wind ?? [0.35, 0.08])[0];
  let wz = (opts.wind ?? [0.35, 0.08])[1];
  let t = 0;
  const drift = uniforms.uDrift.value as THREE_NS.Vector2;

  return {
    mesh,
    uniforms,
    setDensity(d) {
      geo.instanceCount = Math.round(count * Math.min(1, Math.max(0, d)));
      mesh.visible = geo.instanceCount > 0;
    },
    setCenter(x, y, z) {
      (uniforms.uCenter.value as THREE_NS.Vector3).set(x, y, z);
    },
    setWind(x, z) {
      wx = x;
      wz = z;
    },
    setColors(colors) {
      const pal = uniforms.uPalette.value as THREE_NS.Color[];
      for (let i = 0; i < 4; i++) pal[i].set(colors[Math.min(i, colors.length - 1)]);
    },
    setLight(sunDir, sunColor, ambient) {
      (uniforms.uSunDir.value as THREE_NS.Vector3).copy(sunDir).normalize();
      (uniforms.uSunColor.value as THREE_NS.Color).set(sunColor);
      (uniforms.uAmbient.value as THREE_NS.Color).set(ambient);
    },
    update(dt) {
      // integrate wind (bounded dt from the engine) so wind changes never jump the field
      t += dt;
      drift.x += wx * dt;
      drift.y += wz * dt;
      // keep floats small: wrap drift by the box size (field wraps anyway)
      if (Math.abs(drift.x) > aw * 100) drift.x %= aw;
      if (Math.abs(drift.y) > ad * 100) drift.y %= ad;
      uniforms.uTime.value = t;
    },
    dispose() {
      base.dispose();
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
