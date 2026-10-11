// Jiangyin (SPEC §3 ch.1 prologue + ch.2 river, §7): one set served continuously across both chapters.
//
// World bible (build-threejs-scroll-worlds):
//  - Scale: metres; water y = 0. The Yangtze flows toward -z; Jiangyin's bank runs along the right of a
//    downstream-facing camera, the north bank 1.7 km away is only haze. A canal leaves the river into the town.
//  - Light: one sun shared by sky, water glint, directional key and paper back-light; hemisphere fill from the
//    sky; practicals = Jay's lantern (a real point light) and ONE lit window. The prologue sky is the visitor's
//    own hour (skyStateForHour), graded toward the jade mist; the river settles into an authored jade dusk.
//  - Atmosphere: exp² fog whose colour is the sky's horizon haze (so silhouettes, fog and the DOM veil agree),
//    plum-rain drizzle at very low density, dimples on the water.
//  - Materials: whitewash with damp plinths and eave streaks, black tile, dark timber, grey stone (materials.ts).
//  - Camera: forward glide (path.ts), authored desktop + portrait rigs, small damped pointer parallax.
// Hotspots: 'paper-boat', 'oil-paper-umbrella', 'grandparents-window' -> bus 'keepsake:activate'.
// Listens: 'keepsake:collected' (flourish), 'keepsakes:sync' (restore found glints quietly), 'ripple' (pointer
// rings), 'light:pulse' (a ripple across the river; for 'love' also the Love-earned beat, jiangyin/loveBeat.ts).
// DOM: sets html[data-jy-walls] while the canal walls own the frame, so main.css can lift the 爱 seal off the busy
// house fronts (absent with no WebGL / no JS: the static seal stays), and html[data-jy-dusk] in twilight haze so the
// prologue copy's scrim thickens (main.css).
import type * as THREE_NS from 'three';
import { bus } from '../../bus';
import { KEEPSAKES } from '../../content/keepsakes';
import type { QualityTier } from '../../bus';
import { createCalmWater } from '../systems/calmWater';
import { createPaperBoat } from '../systems/paperBoat';
import { createRainField } from '../systems/rain';
import { createSky, lerpSkyState, makeSkyState, skyPresets, skyStateForHour, type SkyState } from '../systems/sky';
import type { FrameInfo, Hotspot, WorldModuleFactory } from '../types';
import { createDistant } from './jiangyin/distant';
import { createKeepObjects, haloTexture, type JyKeepId } from './jiangyin/keepsakes';
import { createKoi } from './jiangyin/koi';
import { createLoveBeat } from './jiangyin/loveBeat';
import { createPetals } from './jiangyin/petals';
import { BANK_X, CANAL_HALF, CANAL_Z, CROSS_X0, CROSS_X1, KEEP_BOAT, WINDOW } from './jiangyin/layout';
import { createTownMaterials } from './jiangyin/materials';
import { createBoatPath, type Rig } from './jiangyin/path';
import { createReflection } from './jiangyin/reflection';
import { buildTown } from './jiangyin/town';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (b === a ? 1 : (x - a) / (b - a))));
  return t * t * (3 - 2 * t);
};

/** Visitor's local hour (a QA override `window.__JY_HOUR` lets screenshots check dawn/day/dusk/night). */
function localHour(): number {
  const o = (globalThis as { __JY_HOUR?: number }).__JY_HOUR;
  if (typeof o === 'number' && Number.isFinite(o)) return o;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

const create: WorldModuleFactory = (ctx) => {
  const { THREE, reducedMotion: rm } = ctx;
  const mobile = () => ctx.isMobile;
  const scene = new THREE.Scene();
  scene.name = 'jiangyin';
  const fog = new THREE.FogExp2('#c9d0c6', 0.0012);
  scene.fog = fog;

  // ---------------------------------------------------------------- sky states
  const presets = skyPresets(THREE);
  // Sun bearing: ahead-right over the water on desktop (well left of the hero seal column, top right); on a
  // portrait screen the seal owns the top-right corner, so the sun sits ahead-left over the open river instead.
  const SUN_DIR = (mobile() ? new THREE.Vector3(-0.07, 0.06, -0.99) : new THREE.Vector3(0.2, 0.06, -0.98)).normalize();
  /** The authored Jiangyin dusk: jade mist, a warm low band, a cool zenith; sun low, ahead-right. */
  const jade = makeSkyState(THREE, {
    horizon: '#d6cfb9',
    zenith: '#5b7880',
    ground: '#9db5a8',
    sunDir: SUN_DIR,
    sunColor: '#ffb27a',
    sun: 0.85,
    stars: 0,
    moon: 0,
    haze: 0.36,
  });
  /** Late river: the light going, blue-jade, so the one window and the lantern carry the warmth. */
  const late = makeSkyState(THREE, {
    horizon: '#b9bfae',
    zenith: '#3f5560',
    ground: '#7f978c',
    sunDir: [0.3, 0.0, -0.95],
    sunColor: '#f2a070',
    sun: 0.45,
    stars: 0.05,
    moon: 0,
    haze: 0.42,
  });
  const hourState = makeSkyState(THREE);
  const proState = makeSkyState(THREE);
  const cur = makeSkyState(THREE);
  /** Canal light: the sun has swung behind the right bank, so the left bank (and its keepsakes) catches it. */
  const canal = makeSkyState(THREE, {
    horizon: '#d3ccb6',
    zenith: '#5a767d',
    ground: '#9db5a8',
    sunDir: [0.52, 0.07, 0.85],
    sunColor: '#ffb27a',
    sun: 0.75,
    stars: 0,
    moon: 0,
    haze: 0.38,
  });
  let hourStamp = -1e9;
  let hourKey = -1;
  const refreshHour = () => {
    const hr = localHour();
    hourKey = hr;
    skyStateForHour(THREE, hr, hourState, presets);
    // keep the composition's sun bearing (ahead-right, over the water) and grade toward jade so it is Jiangyin;
    // night keeps most of its own depth (less jade), day and dusk take more of the mist
    const elev = hourState.sunDir.y;
    // a high midday sun would put its water glint right under the camera (a blown-out blob near the bottom of
    // the frame); the mist diffuses it anyway, so the disc and glint stay low over the river while the hour still
    // drives the colours
    hourState.sunDir.set(SUN_DIR.x, Math.min(elev, 0.16), SUN_DIR.z).normalize();
    const dayness = smooth(-0.12, 0.2, elev);
    lerpSkyState(hourState, jade, 0.1 + 0.22 * dayness, proState);
  };
  refreshHour();

  const sky = createSky(THREE, { ...jade, twinkle: !rm, radius: 1800 });
  scene.add(sky.mesh);
  // Sun in the mist: the sky's disc has a crisp limb; a haze card in the fog colour sits in front of it, thin over
  // the centre and densest just over the limb, so the edge melts into the jade mist (a sun seen through cloud, the
  // way ink paintings carry it) instead of reading as a hard white circle. A wide warm bloom keeps it glowing.
  const veilTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g2 = c.getContext('2d')!;
    const rg = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,0.16)');
    rg.addColorStop(0.18, 'rgba(255,255,255,0.28)');
    rg.addColorStop(0.28, 'rgba(255,255,255,0.6)');
    rg.addColorStop(0.36, 'rgba(255,255,255,0.72)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    rg.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = rg;
    g2.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sunVeilMat = new THREE.SpriteMaterial({ map: veilTex, color: '#d6cfb9', transparent: true, depthWrite: false, depthTest: true, fog: false });
  const sunVeil = new THREE.Sprite(sunVeilMat);
  const SUN_VEIL_D = 1500;
  // disc radius ~1.5 deg -> ~39 m at 1500 m; the card's densest ring (r ~0.33 of its half-size) sits on the limb
  sunVeil.scale.setScalar(240);
  sunVeil.renderOrder = 1;
  scene.add(sunVeil);
  const sunBloomMat = new THREE.SpriteMaterial({ color: '#ffd9b0', transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const sunBloom = new THREE.Sprite(sunBloomMat);
  sunBloom.scale.setScalar(560);
  sunBloom.renderOrder = 1;
  scene.add(sunBloom);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight('#c9d3cc', '#3b4a44', 1.25);
  const sun = new THREE.DirectionalLight('#ffd2a8', 1.4);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(hemi, sun, sun.target);

  // ---------------------------------------------------------------- water + reflection
  const water = createCalmWater(THREE, {
    size: [9000, 9000],
    color: '#33463f',
    roughness: 0.28,
    rippleScale: 1.3,
    flow: [0.05, -0.32],
    animate: !rm,
  });
  water.mesh.position.set(-1500, 0, -2500);
  water.mesh.updateMatrixWorld();
  water.mesh.matrixAutoUpdate = false;
  scene.add(water.mesh);
  const refl = createReflection(THREE, water.mesh.material as THREE_NS.ShaderMaterial, 0, mobile() ? 0.34 : 0.5);

  // ---------------------------------------------------------------- town, distance, boat, rain, koi, keepsakes
  const mats = createTownMaterials(THREE);
  const town = buildTown(THREE, mats, mobile() ? 1 : 0);
  town.meshes.forEach((m) => {
    m.updateMatrix();
    scene.add(m);
  });
  scene.add(town.window);
  const distant = createDistant(THREE);
  scene.add(distant.group);

  const boat = createPaperBoat(THREE, { flicker: !rm, light: true, lightDistance: 7, lightIntensity: 1.4 });
  boat.group.scale.setScalar(0.95);
  scene.add(boat.group);
  // Paper, not gilt (3d-paper-material, Transmit): the lantern is the hero practical, so it reads at twice the size
  // in an emissive paper shade, and its real point light hangs above the hull (a light 0.3 m from the sail floods
  // the whole sheet orange). The glow through the paper stays local to the bow pocket, so the hull and sail keep
  // their washi cream and only the paper beside the flame warms from inside.
  boat.lantern.group.scale.setScalar(1.9);
  boat.lantern.group.position.y += 0.05;
  if (boat.lantern.light) boat.lantern.light.position.y += 0.75;
  const boatMat = (boat.group.children.find((c) => (c as THREE_NS.Mesh).isMesh) as THREE_NS.Mesh | undefined)?.material as THREE_NS.MeshStandardMaterial | undefined;
  if (boatMat) {
    const base = boatMat.onBeforeCompile;
    boatMat.onBeforeCompile = (shader, r) => {
      base.call(boatMat, shader, r);
      // uniform values only (the program and its cache key stay the shared ones)
      if (shader.uniforms.uGlowRadius) shader.uniforms.uGlowRadius.value = 0.2;
    };
  }

  const rain = createRainField(THREE, {
    // drizzle only (instanceCount = count x density <= 0.45): ~210 streaks on a phone, ~800 on desktop
    count: mobile() ? 480 : 1800,
    width: 16,
    depth: 34,
    height: 16,
    speed: 7.5,
    length: 0.42,
    thickness: 0.009,
    opacity: 0.32,
    color: '#e3e8e4',
    wind: [0.25, 0.08],
    density: 0.2,
  });
  scene.add(rain.mesh);

  const koi = createKoi(THREE);
  scene.add(koi.mesh);

  const keeps = createKeepObjects(THREE, mats.window, rm);
  scene.add(keeps.group);

  // the Love-earned beat (ember -> gold 爱 brushed into the courtyard sky); screen-space, main pass only
  const loveBeat = createLoveBeat(THREE, rm);
  scene.add(loveBeat.mesh);

  // pointer petals: lifted by the ripple events, drifting with the water's own flow (main pass only, no reflection)
  const petals = rm ? null : createPetals(THREE, mobile() ? 32 : 56, [0.05, -0.32]);
  if (petals) scene.add(petals.mesh);

  // ---------------------------------------------------------------- the two warm practicals as story beats
  // "Love earned": the boat's lantern blooms gold (halo + its point light ramp) as the boat turns to show it.
  const haloTex = haloTexture(THREE);
  const loveHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTex, color: '#ffc46b', transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  loveHalo.renderOrder = 6;
  scene.add(loveHalo);
  sunBloomMat.map = haloTex;
  sunBloomMat.needsUpdate = true;
  // The grandparents' window: a warm light that spills onto the house front and a soft glow card on the wall.
  const winLight = new THREE.PointLight('#ffb35c', 0, 11, 1.6);
  winLight.position.set(WINDOW.x - 1.1, WINDOW.y - 0.3, WINDOW.z);
  scene.add(winLight);
  const spillGeo = new THREE.PlaneGeometry(WINDOW.w * 3.6, WINDOW.h * 3.4);
  const spillMat = new THREE.MeshBasicMaterial({ map: haloTex, color: '#ffb35c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const spill = new THREE.Mesh(spillGeo, spillMat);
  spill.position.set(WINDOW.x - 0.06, WINDOW.y - 0.15, WINDOW.z);
  spill.rotation.y = -Math.PI / 2;
  spill.renderOrder = 3;
  scene.add(spill);

  // Reading-column mist (desktop river): the river copy sits in the right column over the town (rooftops at the
  // start, the dark right-hand houses at the courtyard). A bank of the frame's own mist drifts over that column,
  // densest behind the text block and gone toward the boat, so the eyebrow and body keep 4.5:1 without a box.
  // Screen-space quad (clip coords), main pass only (layer 0: never in the reflection).
  const colVeilMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#c9d0c6') }, uOpacity: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1.6 } },
    vertexShader: `varying vec2 vS; void main(){ vS = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // mist, not a panel: an elliptical bank centred behind the text block whose edge is broken up by drifting fbm,
    // thinning toward the canal (left) so the right bank stays in tone instead of washing out as a rectangle
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime, uAspect; varying vec2 vS;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){
        vec2 c = vec2(0.78, 0.45);
        vec2 d = (vS - c) * vec2(uAspect / 1.6, 1.0) / vec2(0.32, 0.42);
        float r = length(d);
        vec2 q = vS * vec2(uAspect, 1.0) * 2.4 + vec2(uTime * 0.012, uTime * 0.004);
        float n = fbm(q) + 0.5 * fbm(q * 2.7 - uTime * 0.01);
        float bank = 1.0 - smoothstep(0.35, 1.05, r + (n - 0.75) * 0.55);
        float toCanal = smoothstep(0.46, 0.7, vS.x + (n - 0.75) * 0.1);
        float a = bank * toCanal * (0.82 + 0.18 * n);
        gl_FragColor = vec4(uColor, uOpacity * a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const colVeil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), colVeilMat);
  colVeil.frustumCulled = false;
  colVeil.renderOrder = 50;
  colVeil.visible = false;
  scene.add(colVeil);

  const path = createBoatPath(THREE);
  const hideInRefl: THREE_NS.Object3D[] = [sky.mesh, water.mesh, rain.mesh, koi.mesh];
  // Reflection layers: 1 = town, window, boats, keepsakes and the lights that light them (every tier);
  // 2 = the distant hills and bridge (medium/high only). Sky, water, rain and koi stay on layer 0 and never enter
  // the reflection pass, so it costs a fraction of the main render.
  const REFL_TOWN = 1, REFL_FAR = 2;
  const onLayer = (o: THREE_NS.Object3D, l: number) => o.traverse((c) => c.layers.enable(l));
  town.meshes.forEach((m) => onLayer(m, REFL_TOWN));
  [town.window, spill, boat.group, keeps.group, loveHalo, hemi, sun, winLight].forEach((o) => onLayer(o, REFL_TOWN));
  onLayer(distant.group, REFL_FAR);

  // ---------------------------------------------------------------- per-frame scratch (no allocation)
  const B = new THREE.Vector3();
  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lanternPos = new THREE.Vector3();
  const fogCol = new THREE.Color();
  const tmpC = new THREE.Color();
  const CANAL_MIST = new THREE.Color('#9db5a8');
  const HALO_WARM = new THREE.Color('#ffd9a0');
  const smallBoatRel = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const loveGold = new THREE.Color('#F2A93B');
  const winPos = new THREE.Vector3(WINDOW.x - 0.1, WINDOW.y, WINDOW.z);
  const rig: Rig = { back: 0, side: 0, height: 0, ahead: 0, lookSide: 0, lookY: 0, fov: 40 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const drawSize = new THREE.Vector2();
  let px = 0, py = 0; // damped pointer parallax
  let owner = false;
  let lastTime = 0;
  // koi easter egg: pointer held still over water ~3 s
  let still = 0, lastPX = 9, lastPY = 9;
  // light:pulse ripples (scheduled rings) + lantern flare
  const pulseAt = new Float32Array(4).fill(-1);
  let pulseFlare = 0;
  let mistStr = '#c9d0c6';
  let mistHex = -1;
  let frameNo = 0;
  let beatSwell = 0;
  // the beat also plays on reaching the earn point itself (river t 0.8, hud.ts LOVE_AT), once per visit, so a set
  // that finished loading after the light was earned (poster up at the time) still lands the moment
  let lovePlayed = false;
  const lanternScr = new THREE.Vector2();
  /** Flourishes for keepsakes collected from their DOM mirror while the object is not yet in frame. */
  const pendingFlourish: Record<JyKeepId, boolean> = { 'paper-boat': false, 'oil-paper-umbrella': false, 'grandparents-window': false };
  let tone: 'light' | 'dark' = 'dark';
  let fogLum = 0;
  let walls = false;
  const setWalls = (on: boolean) => {
    if (walls === on) return;
    walls = on;
    document.documentElement.toggleAttribute('data-jy-walls', on);
  };
  // twilight haze (luminance in the band where neither ink nor paper clears the water on its own): main.css doubles
  // the prologue copy's scrim while html[data-jy-dusk] is set, so the copy holds >= 4.5:1 at every visitor hour
  let dusk = false;
  const setDusk = (on: boolean) => {
    if (dusk === on) return;
    dusk = on;
    document.documentElement.toggleAttribute('data-jy-dusk', on);
  };

  const isWater = (x: number, z: number) =>
    x < BANK_X || (z > CANAL_Z - CANAL_HALF && z < CANAL_Z + CANAL_HALF && x < CROSS_X1) || (x > CROSS_X0 && x < CROSS_X1);

  const g = (f: FrameInfo) => (f.chapter === 'river' ? 1 + f.t : f.t);
  /** The authored (parallax-free) camera for frame f: a pure function of g, shared by pose() and update(). */
  const frameCam = (f: FrameInfo, outPos: THREE_NS.Vector3, outLook: THREE_NS.Vector3) => {
    const G = g(f);
    path.rig(G, mobile() || f.aspect < 0.8, rig);
    path.sample(path.u(G), B, T);
    T.y = 0;
    T.normalize();
    R.crossVectors(T, UP).normalize();
    outPos.copy(B).addScaledVector(T, -rig.back).addScaledVector(R, rig.side);
    outPos.y = rig.height;
    outLook.copy(B).addScaledVector(T, rig.ahead).addScaledVector(R, rig.lookSide);
    outLook.y = rig.lookY;
  };
  /** River tExact windows in which each keepsake MAY open: from where the glide first brings it into view (inside
   *  the canal, past the bank houses that would hide it from the open river) to the end of the chapter. Within a
   *  window a keepsake is only live while it is actually on screen in this frame's authored camera (refreshVisible:
   *  projected inside the visible band, big enough to aim at, and for the small boat not near-culled), so a keepsake
   *  that is visible is clickable and one that has slid out of frame is not. The window keepsake opens once lit. */
  const RANGE: Record<JyKeepId, [number, number]> = {
    'paper-boat': [0.44, 1],
    'oil-paper-umbrella': [0.5, 1],
    'grandparents-window': [0.6, 1],
  };
  const inScroll = (id: JyKeepId, f: FrameInfo) => f.chapter === 'river' && f.tExact >= RANGE[id][0] && f.tExact <= RANGE[id][1];
  // ...and actually on screen in this frame's authored camera: a portrait frustum is narrow and the copy owns its
  // lower half, so a hotspot (its glint, its "nearby" chip state, its raycast) only opens while the object's centre
  // projects inside the visible band and its proxy covers enough pixels to aim at. Computed once per frame in
  // update() from the parallax-free camera, so it is a pure function of the frame, like the camera itself.
  const visCam = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const visP = new THREE.Vector3();
  const visible: Record<JyKeepId, boolean> = { 'paper-boat': false, 'oil-paper-umbrella': false, 'grandparents-window': false };
  /** Projected proxy radius in CSS px per keepsake (dev readout). */
  const visPx: Record<JyKeepId, number> = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 };
  /** Smallest on-screen proxy radius (CSS px) that still counts as "in view": a speck in the haze is not a target. */
  const MIN_PX = 14;
  const refreshVisible = (f: FrameInfo, pos: THREE_NS.Vector3, at: THREE_NS.Vector3) => {
    const portrait = mobile() || f.aspect < 0.8;
    visCam.fov = rig.fov;
    visCam.aspect = f.aspect || 1;
    visCam.position.copy(pos);
    visCam.lookAt(at);
    visCam.updateMatrixWorld();
    visCam.updateProjectionMatrix();
    const halfH = (typeof window !== 'undefined' ? window.innerHeight : 800) / 2;
    const tanHalf = Math.tan((rig.fov * Math.PI) / 360);
    for (const id of Object.keys(visible) as JyKeepId[]) {
      const proxy = keeps.proxies[id];
      const dist = proxy.position.distanceTo(pos);
      visPx[id] = (proxy.scale.x / Math.max(0.001, dist * tanHalf)) * halfH;
      visP.copy(proxy.position).project(visCam);
      visible[id] = visP.z < 1 && Math.abs(visP.x) < 0.88 && visP.y < 0.86 && visP.y > (portrait ? 0.0 : -0.9) && visPx[id] >= MIN_PX;
    }
    // the moored small boat is culled once the glide is on top of it (update()): hidden means not clickable
    visible['paper-boat'] &&= keeps.smallBoat.group.visible;
  };
  const inRange = (id: JyKeepId, f: FrameInfo) => inScroll(id, f) && visible[id];
  let lastFrame: FrameInfo | null = null;
  /** Last range state per keepsake, so 'keepsake:inrange' fires only on change (the HUD chips can show "nearby"). */
  const rangeState: Record<JyKeepId, boolean> = { 'paper-boat': false, 'oil-paper-umbrella': false, 'grandparents-window': false };
  const emitRange = (id: JyKeepId, on: boolean) => {
    if (rangeState[id] === on) return;
    rangeState[id] = on;
    bus.emit('keepsake:inrange', { id, on });
  };
  const isJy = (id: string): id is JyKeepId => id === 'paper-boat' || id === 'oil-paper-umbrella' || id === 'grandparents-window';
  const playFlourish = (id: JyKeepId) => {
    keeps.flourish(id);
    if (id === 'paper-boat') water.ripple(keeps.smallBoat.group.position.x, keeps.smallBoat.group.position.z, 1.2);
  };

  // ---------------------------------------------------------------- bus
  const offs: (() => void)[] = [];
  offs.push(
    bus.on('keepsake:collected', ({ id }) => {
      if (!isJy(id)) return;
      keeps.setFound(id, true);
      // collected from the DOM mirror before the object is on screen: hold the flourish until it is in frame
      if (owner && lastFrame && inRange(id, lastFrame)) playFlourish(id);
      else pendingFlourish[id] = true;
    }),
  );
  offs.push(
    // boot, late module load and game reset: which pickups are already found (no flourish on restore)
    bus.on('keepsakes:sync', ({ ids }) => {
      for (const id of Object.keys(pendingFlourish) as JyKeepId[]) {
        const has = ids.includes(id);
        keeps.setFound(id, has);
        if (!has) pendingFlourish[id] = false;
      }
    }),
  );
  offs.push(
    bus.on('keepsake:focus', ({ id, on }) => {
      if (isJy(id)) keeps.setHover(id, on);
    }),
  );
  offs.push(
    bus.on('ripple', ({ x, y, strength }) => {
      if (!owner) return;
      water.rippleAtNdc(x, y, ctx.camera, Math.min(1.2, 0.35 + strength * 0.8));
      // ...and lifts a petal or two off the surface (not under reduced motion; petals is null then)
      if (petals) {
        ndc.set(x, y);
        ray.setFromCamera(ndc, ctx.camera);
        if (ray.ray.intersectPlane(waterPlane, hit) && hit.distanceTo(ctx.camera.position) < 45 && hit.distanceTo(ctx.camera.position) > 6 && isWater(hit.x, hit.z)) petals.spawn(hit.x, hit.z, strength);
      }
    }),
  );
  offs.push(
    bus.on('light:pulse', ({ id }) => {
      if (!owner) return;
      if (id === 'love') {
        lovePlayed = true;
        loveBeat.play();
      }
      // a ring that runs out from the boat across the water, three beats
      for (let i = 0; i < pulseAt.length; i++) pulseAt[i] = i < 3 ? i * 0.28 : -1;
      pulseFlare = 1;
    }),
  );

  // ---------------------------------------------------------------- hotspots
  const label = (id: JyKeepId) => KEEPSAKES.find((k) => k.id === id)?.title ?? id;
  const spot = (id: JyKeepId): Hotspot => ({
    id,
    proxy: keeps.proxies[id],
    label: label(id),
    enabled: (f) => inRange(id, f),
    onHover: (h) => keeps.setHover(id, h),
    onActivate: () => bus.emit('keepsake:activate', { id }),
  });
  const hotspots: Hotspot[] = [
    spot('paper-boat'),
    spot('oil-paper-umbrella'),
    spot('grandparents-window'),
  ];

  let curTier: QualityTier = ctx.tier;
  const dev = import.meta.env.DEV;
  // dev QA hook: replay the Love beat on demand (screenshots of the beat's hold)
  if (dev) (globalThis as { __JY_LOVE?: () => void }).__JY_LOVE = () => loveBeat.play();
  function setTierImpl(tier: QualityTier) {
    curTier = tier;
    // the reflection carries the water-town read, so it survives every tier: smaller, and town-only at low
    refl.enabled = true;
    refl.setScale(tier === 'high' ? (mobile() ? 0.4 : 0.5) : tier === 'medium' ? 0.33 : 0.25);
    // phones keep the town (the read that matters) and drop the far hills + bridge from the mirror pass: they are
    // a fogged sliver at the horizon there, and it saves a whole layer of draw calls on the busiest frames
    refl.setLayers(tier === 'low' || mobile() ? 1 << REFL_TOWN : (1 << REFL_TOWN) | (1 << REFL_FAR));
  }
  setTierImpl(ctx.tier);

  return {
    id: 'jiangyin',
    scene,
    enter() {
      owner = true;
    },
    leave() {
      owner = false;
      (Object.keys(rangeState) as JyKeepId[]).forEach((id) => emitRange(id, false));
      koi.release();
      still = 0;
      setWalls(false);
      setDusk(false);
    },
    update(f) {
      const G = g(f);
      const dt = f.dt;
      const realDt = Math.min(0.1, Math.max(0, f.time - lastTime));
      lastTime = f.time;

      // ---- sky: visitor's hour in the prologue, settling into the authored jade dusk along the river
      if (f.time - hourStamp > 60 || hourStamp < 0 || (globalThis as { __JY_HOUR?: number }).__JY_HOUR !== undefined && localHour() !== hourKey) {
        hourStamp = f.time;
        refreshHour();
      }
      if (f.chapter === 'prologue') lerpSkyState(proState, jade, 0, cur);
      else {
        lerpSkyState(proState, jade, smooth(0.0, 0.2, f.t), cur);
        lerpSkyState(cur, canal, smooth(0.12, 0.42, f.t), cur);
        lerpSkyState(cur, late, smooth(0.6, 1.0, f.t) * 0.8, cur);
        // the river is the plum-rain drizzle: a night visitor's stars go as the cloud and rain come in (over the
        // same stretch the sky settles into jade), so the frame never shows clear stars and rain at once
        cur.stars *= 1 - smooth(0.0, 0.16, f.t);
      }
      sky.setState(cur);
      sky.update(dt, f.time);
      water.setSky(cur);
      sky.fogColor(fogCol);
      // canal mist is a touch greener (jade) than the open-river haze
      const inCanal = smooth(1.25, 1.5, G);
      fogCol.lerp(CANAL_MIST, 0.34 * inCanal);
      fog.color.copy(fogCol);
      const night = 1 - smooth(-0.08, 0.12, cur.sunDir.y) * (1 - cur.stars * 0.6);
      // open river: the far town sits deep in the Yangtze haze (ink-wash greys, not black tile), which is also what
      // keeps the hero seal and the river eyebrow legible over it; the haze thins as the boat nears the canal mouth
      const riverHaze = 0.0036 * (1 - smooth(1.0, 1.3, G));
      fog.density = (0.0024 + riverHaze + 0.0022 * inCanal) * (1 + night * 0.3);
      // last stretch: the mist closes in (the seam into the crossing is hidden in it)
      // (starts at 0.88 and grows as a power so the window beat at ~0.95 still reads through the first of it)
      if (f.chapter === 'river') fog.density += 0.024 * Math.pow(smooth(0.88, 1.0, f.t), 1.6);
      distant.tint(fogCol);
      // mid-prologue beat: the long bridge resolves out of the haze downstream
      distant.setBridge(f.chapter === 'prologue' ? smooth(0.18, 0.62, f.t) : 1);

      // ---- lights from the same sun
      const sunUp = smooth(-0.06, 0.3, cur.sunDir.y);
      sun.position.copy(cur.sunDir).multiplyScalar(100);
      sun.color.copy(cur.sunColor);
      sun.intensity = 0.3 + 1.7 * sunUp * cur.sun;
      hemi.color.copy(cur.zenith).lerp(cur.horizon, 0.5);
      hemi.groundColor.copy(cur.ground).multiplyScalar(0.55);
      hemi.intensity = 1.35 + 0.65 * sunUp;
      boat.setSun(cur.sunDir, cur.sunColor, 0.12 + 0.18 * sunUp);

      // ---- boat on its path (camera uses the un-bobbed path point, so pose stays pure)
      const u = path.u(G);
      path.sample(u, B, T);
      boat.group.position.copy(B);
      // a little crabwise, so the camera sees the folded flank rather than the stern edge
      // and at the courtyard it turns to lay its flank (and the lantern in its bow) toward the camera
      const turn = f.chapter === 'river' ? 0.95 * smooth(0.8, 1.0, f.t) : 0;
      boat.group.rotation.set(0, Math.atan2(-T.z, T.x) + (f.chapter === 'prologue' ? 0.5 : 0.5 - 0.25 * smooth(0.3, 0.9, f.t)) + turn, 0);
      if (!rm) {
        boat.group.position.y = 0.012 * Math.sin(f.time * 1.3);
        boat.group.rotation.z = 0.03 * Math.sin(f.time * 0.9 + 0.4) + (f.pointer.active ? f.pointer.x * 0.03 : 0);
        boat.group.rotation.x = 0.02 * Math.sin(f.time * 1.1);
      }
      // the lantern: lit from the start; gold (love earned) as the river chapter closes
      const love = f.chapter === 'river' ? smooth(0.78, 0.95, f.t) : 0;
      pulseFlare = Math.max(0, pulseFlare - realDt * 0.7);
      boat.setLantern(0.6 + night * 0.6 + love * 1.2 + pulseFlare * 0.6 + beatSwell * 0.8);
      boat.update(dt, f.time);
      // glow through the hull is a warmth beside the flame, not a gold wash over the sheet
      if (boatMat) boatMat.emissiveIntensity *= 0.4;
      boat.lantern.group.getWorldPosition(lanternPos);
      water.setGlow(0, lanternPos, '#F2A93B', 0.8 + love * 1.2 + pulseFlare * 0.5);
      // love bloom: a gold halo around the lantern, swelling with `love`
      const lh = 0.12 + 0.88 * love + pulseFlare * 0.4 + beatSwell * 0.6;
      loveHalo.position.copy(lanternPos);
      // (kept about lantern-sized: an additive sprite as large as the boat washes the whole paper gold)
      loveHalo.scale.setScalar(0.42 + 0.5 * love + pulseFlare * 0.4 + beatSwell * 0.9);
      (loveHalo.material as THREE_NS.SpriteMaterial).opacity = Math.min(0.9, (0.2 + 0.45 * love) * lh + pulseFlare * 0.2 + beatSwell * 0.2);
      tmpC.copy(HALO_WARM).lerp(loveGold, Math.min(1, love + beatSwell));
      (loveHalo.material as THREE_NS.SpriteMaterial).color.copy(tmpC);
      // the window: lit from the canal on; spills warm light onto the wall and a streak across the water
      const winOn = f.chapter === 'river' ? smooth(0.45, 0.8, f.t) : 0;
      const winK = winOn * (1 + 0.35 * smooth(0.82, 0.95, f.t));
      // (kept visible at 0 intensity: toggling a light's visibility changes the light count and recompiles every
      // lit material mid-scroll)
      winLight.intensity = 7 * winK;
      spillMat.opacity = 0.42 * winK;
      spill.visible = winOn > 0.001;
      water.setGlow(1, winOn > 0.001 ? winPos : null, '#ffb35c', 1.25 * winK);

      // ---- weather: plum-rain drizzle, very light
      // (a starry sky is a clear sky: the drizzle only falls once the stars have gone; see the sky block above)
      const clear = smooth(0.0, 0.05, cur.stars);
      const drizzle = (f.chapter === 'river' ? 0.15 + 0.3 * smooth(0.15, 0.5, f.t) : 0.08) * (1 - clear);
      rain.setDensity(rm ? drizzle * 0.4 : drizzle);
      rain.update(dt, f.time, ctx.camera);
      water.setRain(f.chapter === 'river' ? 0.06 * smooth(0.15, 0.5, f.t) : 0);

      // ---- light:pulse rings
      for (let i = 0; i < pulseAt.length; i++) {
        if (pulseAt[i] < 0) continue;
        pulseAt[i] -= realDt;
        if (pulseAt[i] <= 0) {
          pulseAt[i] = -1;
          water.ripple(B.x + T.x * (1.5 + i * 2), B.z + T.z * (1.5 + i * 2), 1.5 - i * 0.25);
        }
      }

      // ---- koi easter egg
      const p = f.pointer;
      if (p.active) {
        const moved = Math.hypot(p.x - lastPX, p.y - lastPY);
        if (moved > 0.006) {
          still = 0;
          lastPX = p.x;
          lastPY = p.y;
          if (koi.gathering && moved > 0.08) koi.release();
        } else still += realDt;
        if (still > 3 && !koi.gathering) {
          ndc.set(p.x, p.y);
          ray.setFromCamera(ndc, ctx.camera);
          if (ray.ray.intersectPlane(waterPlane, hit) && hit.distanceTo(ctx.camera.position) < 60 && isWater(hit.x, hit.z)) {
            koi.gather(hit.x, hit.z);
            water.ripple(hit.x, hit.z, 0.5);
          }
        }
      } else {
        still = 0;
        if (koi.gathering) koi.release();
      }
      koi.update(rm ? realDt : dt, f.time, !rm);

      // ---- pointer parallax, damped here (the dt-integrated state lives in update; pose() only reads it)
      if (!rm) {
        const k = Math.min(1, dt * 2.2);
        px += ((p.active ? Math.max(-1, Math.min(1, p.x)) : 0) - px) * k;
        py += ((p.active ? Math.max(-1, Math.min(1, p.y)) : 0) - py) * k;
      }

      // ---- the moored keepsake boat: as the glide passes it (out past the lower-left corner) it would fill the
      // near plane for a moment, so it is culled once it is within ~7 m in front of (or behind) the camera
      frameCam(f, camPos, look);
      camFwd.copy(look).sub(camPos).normalize();
      smallBoatRel.set(KEEP_BOAT.x, 0, KEEP_BOAT.z).sub(camPos);
      keeps.smallBoat.group.visible = smallBoatRel.dot(camFwd) > 7;
      refreshVisible(f, camPos, look);
      if (!lovePlayed && owner && f.chapter === 'river' && f.t >= 0.8 && f.t < 0.97) {
        lovePlayed = true;
        loveBeat.play();
      }
      // the Love beat rides the authored camera: the ember leaves from where the lantern sits on screen
      if (loveBeat.running) {
        visP.copy(lanternPos).project(visCam);
        const onScr = visP.z < 1 && Math.abs(visP.x) < 1 && Math.abs(visP.y) < 1;
        if (onScr) lanternScr.set(visP.x * 0.5 + 0.5, visP.y * 0.5 + 0.5);
        beatSwell = loveBeat.update(realDt, onScr ? lanternScr : null, f.aspect || 1, mobile() || f.aspect < 0.8);
      } else beatSwell = 0;

      // ---- sun haze card + bloom ride the sky with the camera, on the sun's bearing
      sunVeil.position.copy(camPos).addScaledVector(cur.sunDir, SUN_VEIL_D);
      sunBloom.position.copy(sunVeil.position);
      sunVeilMat.color.copy(fogCol);
      sunVeil.visible = cur.sun > 0.02 && cur.sunDir.y > -0.03;
      sunBloom.visible = sunVeil.visible;
      sunBloomMat.color.copy(cur.sunColor);
      sunBloomMat.opacity = 0.32 * cur.sun * smooth(-0.03, 0.05, cur.sunDir.y);

      // ---- reading-column mist (desktop river only; portrait copy has its own DOM veil at the bottom)
      const colK = f.chapter === 'river' && !(mobile() || f.aspect < 0.8) ? smooth(0.0, 0.06, f.t) : 0;
      colVeil.visible = colK > 0.001;
      colVeilMat.uniforms.uOpacity.value = 0.55 * colK;
      colVeilMat.uniforms.uTime.value = rm ? 0 : f.time;
      colVeilMat.uniforms.uAspect.value = f.aspect || 1.6;
      (colVeilMat.uniforms.uColor.value as THREE_NS.Color).copy(fogCol);

      lastFrame = f;
      for (const h of hotspots) {
        const id = h.id as JyKeepId;
        const open = inRange(id, f);
        emitRange(id, open);
        keeps.setActive(id, open);
        if (open && pendingFlourish[id]) {
          pendingFlourish[id] = false;
          playFlourish(id);
        }
      }
      keeps.update(dt, f.time, !rm);
      petals?.update(realDt, f.time);
      water.update(dt, f.time);

      // ---- DOM: veil colour + copy tone from the frame's own haze
      // quantized (4 levels per 8-bit step) so a new string is only built when the veil colour visibly changes
      const hex = fogCol.getHex() & 0xfcfcfc;
      if (hex !== mistHex) {
        mistHex = hex;
        mistStr = '#' + fogCol.getHexString();
      }
      const lum = 0.2126 * fogCol.r + 0.7152 * fogCol.g + 0.0722 * fogCol.b; // linear
      fogLum = lum;
      // ink copy on lit haze (dawn, day, dusk: the frame is pale mist); paper copy (with its dark scrim) as soon as
      // the haze has dimmed past the point where ink and paper read equally (haze luminance ~0.18: ink #1c1b19 and
      // paper #f3ede2 both give ~3.8:1 there before their scrims). Switching later left a deep-dusk visitor (~20:00)
      // with ink on a dim sky at ~3:1. A hysteresis band keeps a sky sitting near the threshold from flipping the
      // tone (and every scrim with it) frame to frame.
      if (tone === 'light' ? lum > 0.2 : lum < 0.16) tone = tone === 'light' ? 'dark' : 'light';
      setDusk(owner && lum > 0.1 && lum < 0.38);

      // the canal walls own the frame: from the canal mouth on desktop; on a portrait screen the seal's corner (top
      // right) meets the bank's roofs as soon as the glide leaves the open river, so it lifts away there first
      setWalls(owner && f.chapter === 'river' && G > (mobile() || f.aspect < 0.8 ? 1.15 : 1.43));
    },
    pose(f, camera) {
      frameCam(f, camPos, look);
      // small pointer parallax (damped in update(); pose only reads it, so it stays a function of f + that state)
      camPos.addScaledVector(R, px * 0.18);
      camPos.y += py * 0.08;
      look.addScaledVector(R, px * 0.6);
      look.y += py * 0.25;
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      if (camera.fov !== rig.fov) {
        camera.fov = rig.fov;
        camera.updateProjectionMatrix();
      }
    },
    environment() {
      return { mist: mistStr, tone };
    },
    hotspots: () => hotspots,
    render(renderer, camera) {
      camera.updateMatrixWorld();
      renderer.getDrawingBufferSize(drawSize);
      refl.setSize(drawSize.x, drawSize.y);
      // planar reflection of the town and window; the low tier relies on the water's sky term alone
      // mobile: refresh the reflection every other frame (the water's ripple distortion hides the 1-frame lag)
      frameNo++;
      const doRefl = !mobile() || frameNo % 2 === 0 || curTier === 'high';
      if (!dev) {
        if (doRefl) refl.render(renderer, scene, camera, hideInRefl);
        renderer.render(scene, camera);
        return true;
      }
      // dev readout (window.__JY_INFO): draw calls + triangles for the frame, both passes summed.
      // Budget on a phone at river 0.55 with the reflection on: <= 90 calls, <= 300k triangles.
      let calls = 0, tris = 0;
      if (doRefl) {
        refl.render(renderer, scene, camera, hideInRefl);
        calls += renderer.info.render.calls;
        tris += renderer.info.render.triangles;
      }
      renderer.render(scene, camera);
      calls += renderer.info.render.calls;
      tris += renderer.info.render.triangles;
      (globalThis as { __JY_INFO?: unknown }).__JY_INFO = { g: lastFrame ? +g(lastFrame).toFixed(3) : -1, calls, triangles: tris, refl: doRefl, tier: curTier, mobile: mobile(), lum: +fogLum.toFixed(3), tone, keep: lastFrame ? Object.fromEntries((Object.keys(visible) as JyKeepId[]).map((id) => [id, { open: inRange(id, lastFrame!), vis: visible[id], px: Math.round(visPx[id]) }])) : null };
      return true;
    },
    setTier(tier) {
      setTierImpl(tier);
      rain.setOpacity(tier === 'low' ? 0.22 : 0.32);
    },
    dispose() {
      offs.forEach((o) => o());
      setWalls(false);
      setDusk(false);
      sky.dispose();
      water.dispose();
      refl.dispose();
      town.dispose();
      mats.dispose();
      distant.dispose();
      boat.dispose();
      rain.dispose();
      koi.dispose();
      keeps.dispose();
      loveBeat.dispose();
      petals?.dispose();
      haloTex.dispose();
      veilTex.dispose();
      sunVeilMat.dispose();
      sunBloomMat.dispose();
      (loveHalo.material as THREE_NS.SpriteMaterial).dispose();
      spillGeo.dispose();
      colVeil.geometry.dispose();
      colVeilMat.dispose();
      spillMat.dispose();
    },
  };
};

export default create;
