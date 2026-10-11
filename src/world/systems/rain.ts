// Rain (threejs-weather): a narrow, deep, tall volume carried in front of the camera, facing where it faces.
// Drops are world-fixed under camera translation (the volume wraps around them), so walking/dollying through rain
// looks right. Everything is closed-form in the vertex shader: per frame the CPU writes 4 uniforms, nothing else.
//   - density is a draw range (instanceCount), never a reallocation
//   - slant grows with speed² (sells wind, not "rain but quicker")
//   - each drop is a camera-facing streak quad of world-space width (DPR-agnostic), tapered head-to-tail
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface RainOptions {
  /** Pool capacity (worst case). Default 9000 (desktop); pass less on mobile. */
  count?: number;
  /** Volume width across view / depth along view / height. Default 18 / 40 / 22. */
  width?: number;
  depth?: number;
  height?: number;
  /** Distance of the volume centre ahead of the camera. Default depth*0.45. */
  ahead?: number;
  /** Fall speed (units/s). Default 16. */
  speed?: number;
  /** Streak length at speed 16 (scales with speed). Default 0.55. */
  length?: number;
  /** Streak width (world units). Default 0.016. */
  thickness?: number;
  color?: THREE_NS.ColorRepresentation;
  opacity?: number;
  /** Wind direction in xz (unit-ish). Slant = baseSlant * (speed/16)². Default [0.35, 0.1]. */
  wind?: [number, number];
  /** Initial density 0..1. Default 0.6. */
  density?: number;
}

export interface RainField {
  mesh: THREE_NS.Mesh;
  /** 0..1 → fraction of the pool drawn. */
  setDensity(d: number): void;
  /** Fall speed multiplier (1 = rain, 1.42 = storm). */
  setSpeed(mul: number): void;
  setWind(x: number, z: number): void;
  setOpacity(o: number): void;
  /** Anchor to the camera and advance. Call every frame while visible. */
  update(dt: number, time: number, camera: THREE_NS.Camera): void;
  dispose(): void;
}

export function createRainField(THREE: THREE, opts: RainOptions = {}): RainField {
  const count = opts.count ?? 9000;
  const width = opts.width ?? 18;
  const depth = opts.depth ?? 40;
  const height = opts.height ?? 22;
  const ahead = opts.ahead ?? depth * 0.45;
  const baseSpeed = opts.speed ?? 16;

  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = (n: number) => {
      const x = Math.sin((i + 1) * 91.345 + n * 47.853) * 43758.5453;
      return x - Math.floor(x);
    };
    seeds[i * 4] = r(1);
    seeds[i * 4 + 1] = r(2);
    seeds[i * 4 + 2] = r(3);
    seeds[i * 4 + 3] = r(4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  // base quad: x = -1..1 across, y = 0 (head) .. 1 (tail)
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  const density = opts.density ?? 0.6;
  geo.instanceCount = Math.round(count * density);

  const uniforms: Record<string, THREE_NS.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uFall: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uYaw: { value: 0 },
    uSize: { value: new THREE.Vector3(width, height, depth) },
    uVel: { value: new THREE.Vector3(0, -1, 0) },
    uLen: { value: opts.length ?? 0.55 },
    uThick: { value: opts.thickness ?? 0.016 },
    uColor: { value: new THREE.Color(opts.color ?? '#d5dde2') },
    uOpacity: { value: opts.opacity ?? 0.65 },
    uCamPos: { value: new THREE.Vector3() },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // streak winding depends on view vs velocity
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 aSeed;
      uniform float uFall, uYaw, uLen, uThick;
      uniform vec3 uCenter, uSize, uVel, uCamPos;
      varying float vAlong; varying float vAcross; varying float vFade;
      void main(){
        // volume local frame (yaw only), wrap world-fixed drops into it
        float c = cos(uYaw), s = sin(uYaw);
        vec3 ext = uSize;
        // camera-relative offset in local frame so translation keeps drops world-fixed
        vec3 cen = uCenter;
        vec3 cl = vec3(c*cen.x - s*cen.z, cen.y, s*cen.x + c*cen.z);
        vec3 lp = aSeed.xyz * ext;
        lp.y -= uFall * (0.85 + 0.3 * aSeed.w);
        lp -= cl;
        lp = mod(lp, ext) - ext * 0.5;
        vec3 wp = cen + vec3(c*lp.x + s*lp.z, lp.y, -s*lp.x + c*lp.z);
        // streak: head at wp, tail back along velocity
        vec3 vdir = normalize(uVel);
        float len = uLen * (0.7 + 0.6 * aSeed.w);
        vec3 toCam = normalize(uCamPos - wp);
        vec3 side = normalize(cross(vdir, toCam));
        vec3 p = wp - vdir * len * position.y + side * uThick * position.x;
        vAlong = position.y; vAcross = position.x;
        // fade near the camera (no giant streaks), near volume edges (hidden wrap)
        float dc = length(uCamPos - wp);
        vec3 edge = abs(lp) / (ext * 0.5);
        float e = max(max(edge.x, edge.y), edge.z);
        vFade = smoothstep(1.2, 4.0, dc) * (1.0 - smoothstep(0.82, 1.0, e)) * (0.55 + 0.45 * aSeed.w);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity;
      varying float vAlong; varying float vAcross; varying float vFade;
      void main(){
        float across = 1.0 - vAcross * vAcross;
        float along = smoothstep(0.0, 0.12, vAlong) * (1.0 - vAlong);
        float a = across * along * vFade * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  let speedMul = 1;
  let wx = (opts.wind ?? [0.35, 0.1])[0];
  let wz = (opts.wind ?? [0.35, 0.1])[1];
  let fall = 0;
  const fwd = new THREE.Vector3();
  const baseLen = opts.length ?? 0.55;

  const updateVel = () => {
    const v = speedMul;
    const slant = v * v; // slant ∝ speed²
    (uniforms.uVel.value as THREE_NS.Vector3).set(wx * slant, -1, wz * slant);
    uniforms.uLen.value = baseLen * v;
  };
  updateVel();

  return {
    mesh,
    setDensity(d) {
      geo.instanceCount = Math.round(count * Math.min(1, Math.max(0, d)));
      mesh.visible = geo.instanceCount > 0;
    },
    setSpeed(mul) {
      speedMul = mul;
      updateVel();
    },
    setWind(x, z) {
      wx = x;
      wz = z;
      updateVel();
    },
    setOpacity(o) {
      uniforms.uOpacity.value = o;
    },
    update(dt, _time, camera) {
      fall += dt * baseSpeed * speedMul;
      if (fall > 1e5) fall -= 1e5 - (1e5 % height);
      uniforms.uFall.value = fall;
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      uniforms.uYaw.value = yaw;
      const cp = camera.getWorldPosition(uniforms.uCamPos.value as THREE_NS.Vector3);
      (uniforms.uCenter.value as THREE_NS.Vector3).set(cp.x + fwd.x * ahead, cp.y, cp.z + fwd.z * ahead);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
