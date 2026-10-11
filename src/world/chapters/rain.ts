// Ch.4 "Then it started raining." Seattle / University of Washington (SPEC §3, §7 Ch.4).
//
// World bible (this set):
//   place      Lake Washington in rain -> the shore -> a cherry-tree quad on the axis of a vista, Mt. Rainier in the gap
//   palette    evergreen #2F4A3E masses, rain-silver #BFC7CC air, brick + cast stone, cherry pink / summer green /
//              amber / snow, practical warm windows and lamps, ONE red accent (the CSO lantern) + the lantern gold
//   light      overcast hemisphere key, a weak seasonal sun, warm practicals; fog is the depth separator
//   camera     "slow push into rain": low across the lake behind the lantern convoy, over the shore, then a slowing walk
//              down the path, nearly still for the forgive ritual (desktop + portrait poses authored separately)
//   seasons    one 4-weight blend [spring, summer, fall, winter] = f(t) drives foliage, litter, sky, light, fog,
//              ground, roofs, windows and which particles fall (3d-four-seasons)
//   weather    rain density from bus 'weather' (live Seattle, default authored 0.6); winter falls as snow
//   beats      t 0-0.2 lake + convoy (friends' and parents' lanterns sail in to the pier) · 0.2-0.58 the quad from
//              the pier, four seasons, CSO lantern + Dean's List letter + umbrella · 0.5-0.92 quiet winter while the
//              DOM forgive ritual card scrolls through; rain turns silver on 'forgive:done' · 0.9-1 first buds (the loop)
import type * as THREE_NS from 'three';
import { bus } from '../../bus';
import { KEEPSAKES, type KeepsakeId } from '../../content/keepsakes';
import type { FrameInfo, Hotspot, WorldModule, WorldModuleFactory } from '../types';
import { createSky, makeSkyState } from '../systems/sky';
import { createCalmWater } from '../systems/calmWater';
import { createRainField } from '../systems/rain';
import { createFallingQuads } from '../systems/particles';
import { createLantern, createLanternPool, type Lantern } from '../systems/lantern';
import { createPaperBoat } from '../systems/paperBoat';
import { seasonAt, PAL, blendColor, blendNum, groundWeights, type Weights } from './rain/seasons';
import { DESKTOP, PORTRAIT, sampleCam } from './rain/camera';
import { createTerrain, LAND_Y } from './rain/terrain';
import { createTrees, CHERRIES } from './rain/trees';
import { createCampus, ANCHOR } from './rain/campus';
import { createGlows } from './rain/glows';
import { createContact, type ContactSpot } from './rain/contact';

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const titleOf = (id: KeepsakeId) => KEEPSAKES.find((k) => k.id === id)?.title ?? id;

/** Last live reading cached by src/ui/eggs.ts (same key + TTL), or null. Read-only; eggs.ts owns the cache. */
const WEATHER_CACHE_KEY = 'tlwh.weather';
const WEATHER_CACHE_TTL = 30 * 60 * 1000;
function readCachedWeather(): number | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at?: number; w?: { rain?: number } };
    if (!c || typeof c.at !== 'number' || Date.now() - c.at > WEATHER_CACHE_TTL) return null;
    const r = c.w?.rain;
    return typeof r === 'number' && isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
  } catch {
    return null;
  }
}

/** Hotspot windows (exact progress): from arrival on the pier until the forgive card owns the frame. */
const GATE = {
  'red-lantern': [0.17, 0.72],
  'rain-umbrella': [0.2, 0.64],
  'deans-list-letter': [0.22, 0.66],
} as const;

const create: WorldModuleFactory = (ctx) => {
  const { THREE, camera } = ctx;
  const reduced = ctx.reducedMotion;
  const mobile = ctx.isMobile;
  const scene = new THREE.Scene();
  scene.name = 'rain';
  const fog = new THREE.FogExp2('#aab4b3', 0.012);
  scene.fog = fog;

  // ---------------- sky + light
  const skyState = makeSkyState(THREE, { horizon: PAL.skyHorizon[0], zenith: PAL.skyZenith[0], sun: 0.1, haze: 0.42 });
  const sky = createSky(THREE, { ...skyState, radius: 900, twinkle: false });
  scene.add(sky.mesh);
  const hemi = new THREE.HemisphereLight('#c3cbc8', '#3c4a42', 3.2);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#e6e2d6', 1.2);
  scene.add(key, key.target);

  // ---------------- the place
  const terrain = createTerrain(THREE, mobile);
  scene.add(terrain.group);
  const trees = createTrees(THREE, mobile);
  scene.add(trees.group);
  const campus = createCampus(THREE, mobile);
  scene.add(campus.group);
  // contact darkening where trunks, lamp posts and the bench meet the ground (and lamp slush in winter)
  const contactSpots: ContactSpot[] = [
    ...CHERRIES.map((c) => ({ x: c.x, z: c.z, rx: 2.3 * c.s, rz: 2.3 * c.s, k: 0.6 })),
    // the six path lamps (the last glow is the sconce on the wall, not a post)
    ...campus.lampGlows.slice(0, 6).map((g) => ({ x: g.x, z: g.z, rx: 1.5, rz: 1.5, k: 0.42, lamp: true })),
    { x: ANCHOR.bench.x, z: ANCHOR.bench.z, rx: 0.95, rz: 1.55, k: 0.7 },
  ];
  const contact = createContact(THREE, contactSpots);
  scene.add(contact.mesh);
  // the lamp halos, plus two soft glints that make the letter and the umbrella findable while they can be picked up
  const GLINT_LETTER = campus.lampGlows.length;
  // the letter and umbrella are small at the quad's camera distance: their glints read 1.5x larger until found
  const GLINT_SIZE = [2.25, 3.1];
  const GLINT_UMBRELLA = GLINT_LETTER + 1;
  const glintAt = {
    letter: { x: ANCHOR.letter.x, y: ANCHOR.letter.y, z: ANCHOR.letter.z + 0.12 },
    umbrella: { x: ANCHOR.bench.x - 0.75, y: LAND_Y + 0.75, z: ANCHOR.bench.z + 0.75 },
  };
  const glows = createGlows(THREE, [
    ...campus.lampGlows,
    { ...glintAt.letter, size: GLINT_SIZE[0], color: '#ffd9a0' },
    { ...glintAt.umbrella, size: GLINT_SIZE[1], color: '#ffd29a' },
  ]);
  scene.add(glows.mesh);
  const glint = [-1, -1];

  // ---------------- copy shade: a soft, local darkening of the world behind the pinned reading block (SPEC §11 local
  // scrim, done in the frame itself so it also holds over the bright overcast sky and pale blossom). Clip-space quad,
  // drawn last, gone once the copy has left the stage.
  const shadeU = {
    uA: { value: 0 },
    uC: { value: new THREE.Vector2(0.22, 0.46) },
    uR: { value: new THREE.Vector2(0.36, 0.32) },
  };
  const shadeGeo = new THREE.PlaneGeometry(2, 2);
  const shadeMat = new THREE.ShaderMaterial({
    uniforms: shadeU,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uA; uniform vec2 uC, uR;
      varying vec2 vUv;
      void main(){
        vec2 d = (vUv - uC) / uR;
        gl_FragColor = vec4(0.025, 0.035, 0.04, uA * exp(-dot(d, d) * 1.1));
      }`,
  });
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.frustumCulled = false;
  shade.renderOrder = 1000;
  shade.name = 'copy-shade';
  scene.add(shade);
  /** Once picked up this session, the idle glint settles to a faint rim (the pickup already said "found"). */
  const foundGlint = [0, 0];

  const water = createCalmWater(THREE, {
    size: [460, 420],
    level: 0,
    color: PAL.water[0],
    roughness: 0.32,
    rippleScale: 0.8,
    flow: [0.08, 0.18],
    animate: !reduced,
  });
  water.mesh.position.set(0, 0, 70);
  scene.add(water.mesh);

  // ---------------- the convoy: Jay's boat, the parents' two lanterns, the friends' lanterns (continuity)
  const boat = createPaperBoat(THREE, { light: false, flicker: !reduced, lantern: 1.25 });
  boat.group.scale.setScalar(1.35);
  boat.group.rotation.y = Math.PI / 2; // bow toward -z (toward Seattle's shore)
  scene.add(boat.group);
  const COMPANIONS: { dx: number; dz: number; color: string }[] = [
    { dx: -1.5, dz: 1.3, color: '#F2A93B' },
    { dx: 1.35, dz: 1.7, color: '#F2A93B' },
    { dx: -2.8, dz: 3.6, color: '#f3b45c' },
    { dx: 2.6, dz: 4.3, color: '#f3b45c' },
    { dx: -0.5, dz: 5.4, color: '#f0a548' },
    { dx: 3.8, dz: 1.1, color: '#f3b45c' },
    { dx: -4.1, dz: 1.9, color: '#f0a548' },
  ];
  const companions: Lantern[] = COMPANIONS.map((c, i) =>
    createLantern(THREE, { color: c.color, size: 0.2, flicker: !reduced, seed: i * 7.3 + 1, intensity: 1.1 }),
  );
  companions.forEach((l) => scene.add(l.group));

  // ---------------- the CSO lantern (keepsake + release) and the rising pool
  const LP = ANCHOR.lantern;
  const red = createLantern(THREE, {
    color: '#d2412c',
    size: 0.85,
    light: true,
    lightDistance: 10,
    lightIntensity: 3.2,
    flicker: !reduced,
    seed: 3,
    intensity: 1.2,
  });
  red.group.position.set(LP.x, LP.y, LP.z);
  scene.add(red.group);
  const cordGeo = new THREE.CylinderGeometry(0.008, 0.008, 1.1, 4);
  cordGeo.translate(0, 0.55, 0);
  const cordMat = new THREE.MeshBasicMaterial({ color: '#1d2124' });
  const cord = new THREE.Mesh(cordGeo, cordMat);
  cord.position.set(LP.x, LP.y + 0.3, LP.z);
  scene.add(cord);
  const tasselGeo = new THREE.ConeGeometry(0.05, 0.28, 5);
  const tasselMat = new THREE.MeshLambertMaterial({ color: '#8f2a22' });
  const tassel = new THREE.Mesh(tasselGeo, tasselMat);
  tassel.rotation.x = Math.PI;
  tassel.position.set(LP.x, LP.y - 0.48, LP.z);
  scene.add(tassel);

  const poolCap = mobile ? 160 : 420;
  const ambientMax = mobile ? 26 : 64;
  const pool = createLanternPool(THREE, poolCap, {
    origin: new THREE.Vector3(LP.x, LP.y + 0.2, LP.z),
    area: [46, 40],
    height: 26,
    life: 42,
    size: 0.34,
    color: '#F2A93B',
    hueJitter: 0.55,
    sway: reduced ? 0.15 : 1,
  });
  scene.add(pool.group);
  // The pool's halo quads mix scene fog into an additive, alpha-1 quad, which shows as grey squares in fog.
  // Additive glows should fade, not fog: turn fog off on the pool's materials (local workaround, see report).
  pool.group.traverse((o) => {
    const m = (o as THREE_NS.Mesh).material as THREE_NS.ShaderMaterial | undefined;
    if (m && m.blending === THREE.AdditiveBlending) {
      m.fog = false;
      m.needsUpdate = true;
    }
  });

  // ---------------- weather + seasonal particles
  // mobile capped at 2000 (tierK thins it further on a measured miss)
  const rain = createRainField(THREE, {
    count: mobile ? 2000 : 9000,
    width: 20,
    depth: 44,
    height: 24,
    speed: 15,
    length: 0.6,
    thickness: 0.017,
    color: '#cdd5d9',
    opacity: 0.55,
    wind: [0.22, 0.06],
    density: 0.6,
  });
  scene.add(rain.mesh);
  // a second, near layer: sparse, longer, wider streaks just ahead of the lens (motion-blurred foreground drops),
  // so the rain has depth instead of one uniform field. Desktop only (fill-rate).
  const rainNear = mobile
    ? null
    : createRainField(THREE, {
        count: 520,
        width: 9,
        depth: 7,
        height: 9,
        ahead: 4.2,
        speed: 17,
        length: 1.5,
        thickness: 0.032,
        color: '#d9e0e3',
        opacity: 0.2,
        wind: [0.22, 0.06],
        density: 0.6,
      });
  if (rainNear) scene.add(rainNear.mesh);
  const petals = createFallingQuads(THREE, {
    count: mobile ? 110 : 260,
    size: 0.1,
    area: [18, 8, 16],
    fallSpeed: 0.55,
    wind: [0.45, 0.1],
    shape: 'petal',
  });
  const leaves = createFallingQuads(THREE, {
    count: mobile ? 90 : 200,
    colors: ['#c8782f', '#a8432c', '#d6a03e', '#8f5a2a'],
    size: 0.17,
    area: [18, 8, 16],
    fallSpeed: 0.8,
    wind: [0.6, 0.15],
    shape: 'leaf',
  });
  const snow = createFallingQuads(THREE, {
    count: mobile ? 360 : 900,
    colors: ['#f4f6f7', '#e9eef1', '#ffffff', '#dfe6ea'],
    size: 0.075,
    area: [22, 10, 18],
    fallSpeed: 1.1,
    wind: [0.3, 0.05],
    shape: 'petal',
  });
  scene.add(petals.mesh, leaves.mesh, snow.mesh);

  // ---------------- hotspots (simple proxies)
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const pLantern = new THREE.Mesh(sphereGeo, proxyMat);
  pLantern.position.set(LP.x, LP.y, LP.z);
  pLantern.scale.setScalar(0.95);
  const pLetter = new THREE.Mesh(boxGeo, proxyMat);
  pLetter.position.set(ANCHOR.letter.x, ANCHOR.letter.y + 0.15, ANCHOR.letter.z + 0.3);
  pLetter.scale.set(1.5, 1.7, 0.6);
  const pUmbrella = new THREE.Mesh(sphereGeo, proxyMat);
  pUmbrella.position.set(ANCHOR.bench.x - 0.3, LAND_Y + 0.7, ANCHOR.bench.z + 0.3);
  pUmbrella.scale.setScalar(1.15);
  scene.add(pLantern, pLetter, pUmbrella);

  const hover: Record<'red-lantern' | 'deans-list-letter' | 'rain-umbrella', number> = {
    'red-lantern': 0,
    'deans-list-letter': 0,
    'rain-umbrella': 0,
  };
  const hoverTarget = { 'red-lantern': 0, 'deans-list-letter': 0, 'rain-umbrella': 0 };
  const pulseAt: Record<string, number> = { 'red-lantern': -99, 'deans-list-letter': -99, 'rain-umbrella': -99 };
  // Portrait: the rice-paper sheet spans the full width once it is up, so the 3D targets close before it arrives
  // (desktop keeps them: the sheet sits in the left columns and the lantern, bench and arcade are on the right).
  const PORTRAIT_GATE_END = 0.58;
  const gate = (id: keyof typeof GATE) => (f: FrameInfo) =>
    f.chapter === 'rain' && f.tExact >= GATE[id][0] && f.tExact <= (f.aspect < 0.8 ? Math.min(GATE[id][1], PORTRAIT_GATE_END) : GATE[id][1]);

  const hotspots: Hotspot[] = [
    {
      id: 'red-lantern',
      proxy: pLantern,
      label: titleOf('red-lantern'),
      enabled: gate('red-lantern'),
      onHover: (h) => (hoverTarget['red-lantern'] = h ? 1 : 0),
      onActivate: () => bus.emit('keepsake:activate', { id: 'red-lantern' }),
    },
    {
      id: 'deans-list-letter',
      proxy: pLetter,
      label: titleOf('deans-list-letter'),
      enabled: gate('deans-list-letter'),
      onHover: (h) => (hoverTarget['deans-list-letter'] = h ? 1 : 0),
      onActivate: () => bus.emit('keepsake:activate', { id: 'deans-list-letter' }),
    },
    {
      id: 'rain-umbrella',
      proxy: pUmbrella,
      label: titleOf('rain-umbrella'),
      enabled: gate('rain-umbrella'),
      onHover: (h) => (hoverTarget['rain-umbrella'] = h ? 1 : 0),
      onActivate: () => bus.emit('keepsake:activate', { id: 'rain-umbrella' }),
    },
  ];

  // ---------------- state
  // authored default until live weather arrives. The bus does not replay, and on a deep link this module loads after
  // eggs.ts has already emitted, so start from eggs.ts's cached reading ('tlwh.weather', 30 min TTL) when there is one.
  let weatherRain = readCachedWeather() ?? 0.6;
  let released = 0;
  let clock = 0; // module clock (frozen under reduced motion)
  let now = 0; // f.time mirror for bus handlers
  let silverAt = -99;
  let silverAmp = 1;
  let inChapter = false;
  let lastT = 0;
  let px = 0;
  let py = 0;
  let tier = ctx.tier;
  const tierK = () => (tier === 'high' ? 1 : tier === 'medium' ? 0.75 : 0.5);

  const releaseLantern = () => {
    released++;
    if (reduced) pool.setActive(Math.min(pool.capacity, pool.active + 1));
    else pool.release(1);
    pulseAt['red-lantern'] = now;
    bus.emit('lantern:release', { count: released });
  };

  const offs: (() => void)[] = [
    bus.on('weather', ({ rain: r }) => {
      weatherRain = Math.min(1, Math.max(0, r));
    }),
    bus.on('keepsake:activate', ({ id }) => {
      // every activation of the CSO lantern (3D click or its DOM mirror) sends one more lantern up
      if (id === 'red-lantern') releaseLantern();
    }),
    bus.on('keepsake:collected', ({ id }) => {
      if (id in pulseAt) pulseAt[id] = now;
      if (id === 'deans-list-letter') foundGlint[0] = 1;
      if (id === 'rain-umbrella') foundGlint[1] = 1;
    }),
    // boot, late module load and reset: restore which glints are already found (no pulse)
    bus.on('keepsakes:sync', ({ ids }) => {
      foundGlint[0] = ids.includes('deans-list-letter') ? 1 : 0;
      foundGlint[1] = ids.includes('rain-umbrella') ? 1 : 0;
    }),
    bus.on('forgive:done', () => {
      silverAt = now;
      silverAmp = 1;
    }),
    bus.on('light:pulse', ({ id }) => {
      if (id === 'forgive' && inChapter) {
        silverAt = now;
        silverAmp = 0.55;
      }
    }),
    bus.on('ripple', ({ x, y, strength }) => {
      if (inChapter && lastT < 0.3) water.rippleAtNdc(x, y, camera, 0.4 + strength * 0.8);
    }),
  ];

  // ---------------- scratch (no per-frame allocation)
  const w: Weights = [1, 0, 0, 0];
  const wLeaf: Weights = [1, 0, 0, 0];
  const wG: Weights = [1, 0, 0, 0];
  const C = (arr: string[]) => arr.map((c) => new THREE.Color(c));
  const P = {
    horizon: C(PAL.skyHorizon),
    zenith: C(PAL.skyZenith),
    ground: C(PAL.skyGround),
    sun: C(PAL.sunColor),
    grass: C(PAL.grass),
    water: C(PAL.water),
    // summer is pushed greener than it "should" be: the overcast hemi pulls foliage toward grey
    folA: C(['#f8d6df', '#7fae45', '#e39a36', '#7d7a70']),
    folB: C(['#e9a9bd', '#3c7130', '#ab3d26', '#6e6b62']),
    // litter follows the leaf weights only (never toward snow white): under snow it simply fades out
    litter: C(['#e9b4c2', '#5b7a42', '#b8672f', '#8a7f6e']),
  };
  const silverHorizon = new THREE.Color('#d6dde1');
  const rainBase = new THREE.Color('#cdd5d9');
  const rainLand = new THREE.Color('#eef3f5');
  const rainSilver = new THREE.Color('#f4f8fb');
  const sunDirs = PAL.sunDir.map((d) => new THREE.Vector3(...d).normalize());
  const tmpC = new THREE.Color();
  const tmpC2 = new THREE.Color();
  const fogC = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  const sunC = new THREE.Color();
  const skyLin = new THREE.Color();
  const groundLin = new THREE.Color();
  const folA = new THREE.Color();
  const folB = new THREE.Color();
  const litterC = new THREE.Color();
  const v = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const camBuf = new Float32Array(7);
  const camTarget = new THREE.Vector3();
  let mistKey = -1;
  let mist = '#aab4b3';

  const SPOT_IDS = ['red-lantern', 'deans-list-letter', 'rain-umbrella'] as const;
  /** Pickup flourish: a 180 ms pop that settles over ~1 s. */
  const pop = (id: string) => {
    const a = now - pulseAt[id];
    return a < 0 || a > 3 ? 0 : ss(0, 0.18, a) * Math.exp(-a / 0.9);
  };
  /** Brief silver envelope after the forgive ritual completes. */
  const silverEnv = () => {
    const a = now - silverAt;
    if (a < 0 || a > 40) return 0;
    return ss(0, 0.9, a) * Math.exp(-Math.max(0, a - 1.2) / 6) * silverAmp;
  };

  function convoy(t: number, time: number) {
    const visible = t < 0.34;
    boat.group.visible = visible;
    for (let i = 0; i < companions.length; i++) companions[i].group.visible = visible;
    if (!visible) {
      for (let i = 0; i < 4; i++) water.setGlow(i, null);
      return;
    }
    const u = ss(0, 0.24, t);
    const bx = 1.6 + (2.7 - 1.6) * u + Math.sin(u * 3.0) * 1.1;
    const bz = 27 + (-45 - 27) * u;
    const bob = reduced ? 0 : Math.sin(time * 1.4) * 0.025;
    boat.group.position.set(bx, 0.02 + bob, bz);
    boat.group.rotation.z = reduced ? 0 : Math.sin(time * 1.1) * 0.03;
    boat.group.rotation.x = reduced ? 0 : Math.sin(time * 0.9 + 1) * 0.025;
    // heading eases from a three-quarter view (reads as a boat) to straight in at the pier
    boat.group.rotation.y = Math.PI / 2 + 0.55 * (1 - u);
    boat.lantern.group.getWorldPosition(v);
    water.setGlow(0, v, '#F2A93B', 1.3);
    for (let i = 0; i < companions.length; i++) {
      const c = COMPANIONS[i];
      // the friends drift in closer as the shore nears (the convoy tightens)
      const k = 1 - 0.25 * u;
      const yb = reduced ? 0 : Math.sin(time * 1.3 + i * 1.7) * 0.04;
      companions[i].group.position.set(bx + c.dx * k, 0.16 + yb, bz + c.dz * k + (reduced ? 0 : Math.sin(time * 0.4 + i) * 0.15));
      if (i < 3) {
        companions[i].group.getWorldPosition(v);
        water.setGlow(i + 1, v, c.color, 0.9);
      }
    }
  }

  const mod: WorldModule = {
    id: 'rain',
    scene,
    enter() {
      inChapter = true;
    },
    leave() {
      inChapter = false;
      hoverTarget['red-lantern'] = hoverTarget['deans-list-letter'] = hoverTarget['rain-umbrella'] = 0;
    },
    update(f) {
      const t = f.t;
      lastT = t;
      now = f.time;
      clock += f.dt;
      inChapter = f.chapter === 'rain';
      const dt = f.dt;

      // pointer parallax (damped, clamped), off under reduced motion
      if (!reduced) {
        const tx = f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.x)) : 0;
        const ty = f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.y)) : 0;
        const a = 1 - Math.exp(-2.2 * dt);
        px += (tx - px) * a;
        py += (ty - py) * a;
      }

      // ---- seasons + quiet + silver
      seasonAt(t, w);
      const [sp, su, fa, wi] = w;
      // settled snow lags the season: ground, roofs and limbs whiten only once the fall crowns are mostly down
      groundWeights(w, wG);
      const gs = wG[3];
      const quiet = ss(0.5, 0.6, t);
      const silver = silverEnv();

      // sky
      blendColor(skyState.horizon, P.horizon, w).lerp(silverHorizon, 0.35 * silver);
      blendColor(skyState.zenith, P.zenith, w);
      blendColor(skyState.ground, P.ground, w);
      blendColor(skyState.sunColor, P.sun, w);
      skyState.sunDir.set(0, 0, 0);
      for (let k = 0; k < 4; k++) skyState.sunDir.addScaledVector(sunDirs[k], w[k]);
      skyState.sunDir.normalize();
      skyState.sun = blendNum(PAL.sunAmount, w) * (1 - 0.5 * quiet);
      skyState.haze = blendNum(PAL.haze, w);
      sky.setState(skyState);
      sky.fogColor(fogC);
      fog.color.copy(fogC);
      // a touch thinner over the open lake so the far shore and the mountain read
      fog.density = blendNum(PAL.fogDensity, w) * (0.72 + 0.28 * ss(0.12, 0.28, t)) * (1 + 0.15 * quiet);

      // light
      const hemiI = blendNum(PAL.hemiIntensity, w) * 2.2;
      hemiSky.copy(skyState.zenith).lerp(skyState.horizon, 0.55);
      blendColor(hemiGround, P.grass, wG).multiplyScalar(0.55);
      hemi.color.copy(hemiSky);
      hemi.groundColor.copy(hemiGround);
      hemi.intensity = hemiI;
      const keyI = blendNum(PAL.keyIntensity, w) * 2.0 * (1 - 0.35 * quiet);
      key.color.copy(skyState.sunColor);
      key.intensity = keyI;
      key.position.copy(skyState.sunDir).multiplyScalar(100);
      // the canopy shader lights itself with the same hemi + key (Lambert: / PI)
      skyLin.copy(hemiSky).multiplyScalar(hemiI / Math.PI);
      groundLin.copy(hemiGround).multiplyScalar(hemiI / Math.PI);
      sunC.copy(skyState.sunColor).multiplyScalar(keyI / Math.PI);
      trees.setLight(skyState.sunDir, sunC, skyLin, groundLin);

      // ground, water, distant silhouettes
      blendColor(terrain.landMat.color, P.grass, wG);
      blendColor(tmpC, P.water, w);
      water.setColor(tmpC);
      water.setSky(skyState);
      terrain.setHaze(fogC, skyState.sunDir, gs);
      terrain.setGlow(blendNum(PAL.windowGlow, w) * gs);

      // foliage: blossom -> green -> amber thinning -> bare -> first buds
      // foliage hue ignores the winter weight (winter thins the canopy instead), so the returning buds are pink
      const leafW = Math.max(1e-4, sp + su + fa);
      wLeaf[0] = sp / leafW;
      wLeaf[1] = su / leafW;
      wLeaf[2] = fa / leafW;
      wLeaf[3] = 0;
      blendColor(folA, P.folA, wLeaf);
      blendColor(folB, P.folB, wLeaf);
      blendColor(litterC, P.litter, wLeaf);
      trees.setSeason({
        cover: Math.max(0, 1 - 0.28 * fa - wi),
        colA: folA,
        colB: folB,
        bloom: sp,
        snow: gs,
        litter: litterC,
        // fall litter is gone once the snow lies (no brown smears on white)
        litterAmount: (sp * 0.7 + su * 0.12 + fa * 0.95) * (1 - ss(0.04, 0.3, gs)),
      });
      trees.update(reduced ? 0 : clock);
      // winter strips the canopy: trunks and firs recede harder into the snow-light so values fall off with distance
      trees.setAerial(0.22 + 0.5 * wi);
      contact.set(ss(0.15, 0.24, t) * (0.45 + 0.4 * gs), gs);
      campus.setSeason(gs, blendNum(PAL.windowGlow, w) * (1 + 0.25 * quiet));
      glows.setIntensity(0.85 + 0.35 * wi + 0.2 * quiet);

      // ---- weather
      const base = 0.08 + 0.92 * weatherRain;
      // after the forgive ritual a soft silver shower falls (on everyone, even in winter), slower and brighter
      const rainD = (base * blendNum(PAL.rain, w) * (1 - 0.5 * quiet) * (1 - silver) + 0.42 * silver) * tierK();
      rain.setDensity(rainD);
      rain.setSpeed(1 - 0.18 * quiet - 0.35 * silver);
      // on land the streaks cross pale sky and brick, not dark water: lift them so the chapter's rain still reads
      const onLand = ss(0.16, 0.26, t) * (1 - gs);
      rain.setOpacity(0.5 + 0.22 * onLand + 0.4 * silver);
      (rain.mesh.material as THREE_NS.ShaderMaterial).uniforms.uColor.value.copy(rainBase).lerp(rainLand, 0.6 * onLand).lerp(rainSilver, silver);
      rain.update(dt, clock, camera);
      if (rainNear) {
        // the near layer only reads in real rain (not under the soft silver shower or winter snow)
        rainNear.setDensity(Math.min(1, rainD * (1.15 + 0.5 * onLand)) * (1 - silver) * (1 - wi));
        rainNear.setOpacity(0.2 + 0.14 * onLand);
        rainNear.setSpeed(1 - 0.18 * quiet);
        rainNear.update(dt, clock, camera);
      }
      water.setRain(Math.min(1, rainD * 1.1));
      water.update(dt, clock);

      // particles ride ahead of the camera, only on the quad
      const quad = ss(0.15, 0.24, t);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      // the box (depth 16) starts ~5 m ahead of the lens, so no leaf ever swims up as a huge blur at the camera
      const cx = camera.position.x + fwd.x * 13;
      const cz = camera.position.z + fwd.z * 13;
      petals.setCenter(cx, 3.2, cz);
      leaves.setCenter(cx, 3.2, cz);
      snow.setCenter(cx, 4.0, cz);
      const pk = tierK();
      petals.setDensity(quad * sp * 0.9 * pk);
      leaves.setDensity(quad * fa * pk);
      snow.setDensity(quad * wi * (0.35 + 0.65 * base) * (1 - 0.3 * quiet) * pk);
      tmpC2.copy(hemiSky).multiplyScalar(0.9);
      petals.setLight(skyState.sunDir, sunC, tmpC2);
      leaves.setLight(skyState.sunDir, sunC, tmpC2);
      snow.setLight(skyState.sunDir, sunC, tmpC2);
      petals.update(dt, clock);
      leaves.update(dt, clock);
      snow.update(dt, clock);

      // ---- convoy on the lake
      convoy(t, clock);
      boat.setSun(skyState.sunDir, skyState.sunColor, 0.3);
      boat.update(dt, clock);
      for (let i = 0; i < companions.length; i++) companions[i].update(dt, clock);

      // ---- hotspots: hover warmth + pickup flourish (180 ms pop, then settle)
      const hk = reduced ? 1 : 1 - Math.exp(-12 * Math.max(dt, 1 / 60));
      for (let i = 0; i < SPOT_IDS.length; i++) {
        const id = SPOT_IDS[i];
        hover[id] += (hoverTarget[id] - hover[id]) * hk;
      }
      const lp = pop('red-lantern');
      red.setIntensity(1.55 + 0.7 * hover['red-lantern'] + 1.4 * lp + 0.3 * wi);
      red.update(dt, clock);
      const sway = reduced ? 0 : Math.sin(clock * 0.9) * 0.035 + px * 0.01;
      red.group.rotation.z = sway;
      red.group.position.x = LP.x + Math.sin(sway) * 0.6;
      tassel.position.x = red.group.position.x;
      const ltp = pop('deans-list-letter');
      campus.letterMat.emissive.setRGB(0.23 + 0.35 * hover['deans-list-letter'] + 0.6 * ltp, 0.16 + 0.26 * hover['deans-list-letter'] + 0.45 * ltp, 0.08 + 0.12 * hover['deans-list-letter']);
      campus.letter.scale.setScalar(1 + 0.12 * ltp);
      const up = pop('rain-umbrella');
      campus.umbrellaMat.emissive.setRGB(0.12 * hover['rain-umbrella'] + 0.35 * up, 0.1 * hover['rain-umbrella'] + 0.28 * up, 0.06 * hover['rain-umbrella'] + 0.15 * up);
      campus.umbrella.scale.setScalar(1 + 0.1 * up);
      // idle glints while the letter and umbrella can be picked up: a slow breath (reduced motion: a steady warm rim),
      // brighter on hover, flaring on pickup. Only re-uploaded when the value moves.
      for (let k = 0; k < 2; k++) {
        const id = k === 0 ? 'deans-list-letter' : 'rain-umbrella';
        const on = hotspots[k + 1].enabled(f) ? 1 : 0;
        const breath = (reduced ? 0.55 : 0.38 + 0.3 * (0.5 + 0.5 * Math.sin(clock * 2.1 + k * 2.4))) * (1 - 0.7 * foundGlint[k]);
        const val = on * (breath + 0.55 * hover[id]) + 0.9 * pop(id);
        if (Math.abs(val - glint[k]) > 0.01) {
          glint[k] = val;
          const p = k === 0 ? glintAt.letter : glintAt.umbrella;
          glows.setAt(k === 0 ? GLINT_LETTER : GLINT_UMBRELLA, p.x, p.y, p.z, GLINT_SIZE[k] * (1 - 0.33 * foundGlint[k]), val);
        }
      }

      // ---- lanterns multiply over the quad (CSO, 2,000+), plus every released one
      const ambient = Math.round(ss(0.2, 0.45, t) * ambientMax * tierK());
      const want = Math.min(poolCap, ambient + released);
      if (want !== pool.active) pool.setActive(want);
      pool.setIntensity(1 + 0.25 * quiet + 0.4 * silver);
      pool.update(dt, clock);
    },
    pose(f, cam) {
      const portrait = f.aspect < 0.8;
      sampleCam(portrait ? PORTRAIT : DESKTOP, f.t, camBuf);
      // copy shade follows the reading block: left-middle on desktop, the lower-middle band in portrait
      if (portrait) {
        shadeU.uC.value.set(0.5, 0.5);
        shadeU.uR.value.set(0.85, 0.24);
      } else {
        // centred on the eyebrow-to-body block (uv y ~0.26-0.64) so the title's top line, which sits on the pale
        // overcast sky and blossom, holds >= 4.5:1 from pixels
        shadeU.uC.value.set(0.21, 0.5);
        shadeU.uR.value.set(0.38, 0.36);
      }
      // held at full until the pinned copy has faded out (~0.35), so fading text never drops onto bare bright sky
      shadeU.uA.value = (portrait ? 0.4 : 0.52) * (1 - ss(0.35, 0.42, f.t));
      shade.visible = shadeU.uA.value > 0.003;
      const k = reduced ? 0 : 1;
      cam.position.set(camBuf[0] + px * 0.35 * k, camBuf[1] + py * 0.14 * k, camBuf[2]);
      camTarget.set(camBuf[3], camBuf[4], camBuf[5]);
      cam.lookAt(camTarget);
      if (Math.abs(cam.fov - camBuf[6]) > 1e-3) {
        cam.fov = camBuf[6];
        cam.updateProjectionMatrix();
      }
    },
    environment() {
      const r = Math.round(fog.color.r * 255);
      const g = Math.round(fog.color.g * 255);
      const b = Math.round(fog.color.b * 255);
      const keyN = (r << 16) | (g << 8) | b;
      if (keyN !== mistKey) {
        mistKey = keyN;
        // fog colour is linear; the veil is a CSS (sRGB) colour
        tmpC.copy(fog.color);
        mist = `#${tmpC.getHexString()}`;
      }
      return { mist, tone: 'light' };
    },
    hotspots: () => hotspots,
    setTier(t) {
      tier = t;
      trees.setDensity(t === 'low' ? 0.55 : t === 'medium' ? 0.8 : 1);
    },
    dispose() {
      offs.forEach((o) => o());
      sky.dispose();
      terrain.dispose();
      trees.dispose();
      campus.dispose();
      glows.dispose();
      water.dispose();
      boat.dispose();
      companions.forEach((l) => l.dispose());
      red.dispose();
      pool.dispose();
      rain.dispose();
      rainNear?.dispose();
      contact.dispose();
      petals.dispose();
      leaves.dispose();
      snow.dispose();
      cordGeo.dispose();
      cordMat.dispose();
      tasselGeo.dispose();
      tasselMat.dispose();
      proxyMat.dispose();
      sphereGeo.dispose();
      boxGeo.dispose();
      shadeGeo.dispose();
      shadeMat.dispose();
    },
  };
  if (tier !== 'high') mod.setTier!(tier);
  return mod;
};

export default create;
