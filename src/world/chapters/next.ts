// Ch.7 Next shore (SPEC §3 row 8, §7 "Ch.7 Next shore + footer").
// Dawn on a calm shore. Looking east into a low pink-gold sun across still water toward a far, hazy shore line.
// The paper boat comes in over the water and rests beside a small sand spit; the convoy (parents' two lanterns and
// the friends' lanterns gathered in OC) drifts in behind it and settles on the water. On the spit, a seed under a
// glass cloche sprouts as you scroll (stem grows, two leaves unfurl, a faint glow gathers): the well-being app.
//
// Camera grammar for this chapter: a slow settle / crane DOWN from a high view over the water to eye level on the
// shore. Everything visual is a pure function of f.t (reversible); bob, flicker and the glow's breath are ambient.
// Composition: the DOM copy holds the left third (desktop) / the middle band (mobile); the plant sits right of
// centre on desktop and in the upper-middle band on mobile, with the sky above left as negative space.
import type * as THREE_NS from 'three';
import { bus } from '../../bus';
import type { Environment, FrameInfo, Hotspot, WorldModuleFactory } from '../types';
import { createSky, lerpSkyState, makeSkyState } from '../systems/sky';
import { createCalmWater } from '../systems/calmWater';
import { createPaperBoat } from '../systems/paperBoat';
import { createLantern, type Lantern } from '../systems/lantern';
import { smoothstep } from '../systems/noise';
import { createShore, shoreHeight } from './next/shore';
import { createSeedling, CLOCHE_HEIGHT, SAND_LOCAL } from './next/seedling';
import { TALLY_COPY } from '../../content/ui';

const MIST = '#f3c4a6';
const GOLD = '#F2A93B';

interface CamKey {
  t: number;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

// Authored camera endpoints. Desktop: plant right of centre, copy column on the left stays over sky and water.
const DESKTOP: CamKey[] = [
  { t: 0, pos: [-2.7, 2.7, 7.6], target: [-1.3, 0.35, -4.0], fov: 40 },
  { t: 0.5, pos: [-1.8, 1.15, 5.0], target: [-0.7, 0.4, -1.4], fov: 34 },
  { t: 1, pos: [-1.25, 0.46, 3.3], target: [-0.45, 0.4, -0.6], fov: 30 },
];
// Mobile (portrait): pulled back, wider lens, plant centred low in the upper band, sky as the top of the frame.
const MOBILE: CamKey[] = [
  { t: 0, pos: [-1.6, 2.9, 7.6], target: [-1.3, 0.3, -4.2], fov: 52 },
  { t: 0.5, pos: [-0.5, 1.45, 4.6], target: [-0.6, 0.2, -1.5], fov: 50 },
  // rest: low and close, the glass ~150px tall in the upper band (about 26-44% of the height) with the sun and
  // far shore above it; the copy scrolls up over the sand below, so no link ever sits over the plant or a lantern
  { t: 1, pos: [-0.12, 0.55, 2.9], target: [-0.12, -0.39, -0.7], fov: 48 },
];

/**
 * Story time for this chapter. Next is the last, in-flow section: its copy sits at the foot of the page under an
 * ~0.85-1 viewport arrival hold (src/styles/next-shore.css). The authored beat (crane down, seed cracks, stem
 * rises, leaves unfurl, convoy settles) plays over that hold, before the copy scrolls up over the lower frame, and
 * then rests as a composed still. Portrait copy covers the frame sooner (full-width column), so its beat is shorter.
 */
const REST_T_DESKTOP = 0.6;
const REST_T_MOBILE = 0.38;
const storyT = (t: number, portrait: boolean) => Math.min(1, Math.max(0, t / (portrait ? REST_T_MOBILE : REST_T_DESKTOP)));

const create: WorldModuleFactory = (ctx) => {
  const { THREE, reducedMotion: reduced } = ctx;
  const scene = new THREE.Scene();
  scene.name = 'next';
  const mobileBuild = ctx.isMobile;

  // ---- sky: two authored dawn states; the sun climbs a hair and warms toward gold as you arrive ---------------
  const dawnA = makeSkyState(THREE, {
    horizon: '#f5b494',
    zenith: '#7488b6',
    ground: '#d9a291',
    sunDir: [0.3, 0.018, -1],
    sunColor: '#ffae78',
    sun: 0.8,
    stars: 0.05,
    moon: 0,
    haze: 0.34,
  });
  const dawnB = makeSkyState(THREE, {
    horizon: '#f8c79d',
    zenith: '#8ea6cc',
    ground: '#e0b298',
    sunDir: [0.3, 0.062, -1],
    sunColor: '#ffcb8e',
    sun: 0.85,
    stars: 0,
    moon: 0,
    haze: 0.28,
  });
  const sky = createSky(THREE, { ...dawnA, twinkle: !reduced });
  scene.add(sky.mesh);

  scene.fog = new THREE.Fog(MIST, 28, 760);

  // ---- light: one warm low key from the sun (behind the subject: rim light), a cool sky / warm sand fill -------
  const sunLight = new THREE.DirectionalLight('#ffcfa6', 2.1);
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight('#d6d9ea', '#d8ad94', 1.45);
  scene.add(hemi);

  // ---- water ------------------------------------------------------------------------------------------------
  const water = createCalmWater(THREE, {
    size: [2600, 2600],
    level: 0,
    color: '#56596c',
    roughness: 0.22,
    rippleScale: 0.7,
    flow: [0.12, 0.05],
    animate: !reduced,
  });
  scene.add(water.mesh);

  // ---- shore, far shore -------------------------------------------------------------------------------------
  const shore = createShore(THREE, { mobile: mobileBuild });
  scene.add(shore.group, shore.far);

  // ---- the seed under glass ---------------------------------------------------------------------------------
  const seedling = createSeedling(THREE, { reducedMotion: reduced });
  seedling.group.position.set(0, shoreHeight(0, 0) - SAND_LOCAL, 0);
  seedling.group.rotation.y = -0.25;
  scene.add(seedling.group);

  // ---- the boat ----------------------------------------------------------------------------------------------
  const boat = createPaperBoat(THREE, {
    lantern: 1.2,
    light: true,
    lightDistance: 2.4,
    lightIntensity: 1.1,
    flicker: !reduced,
  });
  boat.group.scale.setScalar(0.46);
  scene.add(boat.group);

  // Boat path: a quadratic Bézier in from the open water to a rest beside the spit.
  const P0 = new THREE.Vector3(-3.6, 0, -12.5);
  const P1 = new THREE.Vector3(-2.3, 0, -4.2);
  const P2 = new THREE.Vector3(-0.6, 0, -1.72);
  const REST_YAW = -0.32; // side-on to the viewer, bow nosing toward the spit
  const bez = (u: number, out: THREE_NS.Vector3) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return out.set(a * P0.x + b * P1.x + c * P2.x, 0, a * P0.z + b * P1.z + c * P2.z);
  };
  const bezTan = (u: number, out: THREE_NS.Vector3) =>
    out.set(2 * (1 - u) * (P1.x - P0.x) + 2 * u * (P2.x - P1.x), 0, 2 * (1 - u) * (P1.z - P0.z) + 2 * u * (P2.z - P1.z));

  // ---- the convoy: two parents' lanterns + the friends' lanterns ---------------------------------------------
  interface Convoy {
    l: Lantern;
    lag: number;
    side: number;
    rest: [number, number];
    phase: number;
    /** 0..1 presence (damped toward `want`): lanterns earned by the run fade in, never pop. */
    shown: number;
    want: number;
  }
  const LSIZE = 0.1;
  // Rest layout: the parents are two lights flanking the boat; the friends settle in a loose arc further out.
  // Every rest sits right of the copy column (screen x > ~-0.35 NDC on desktop) so no light glows behind a link.
  // The arc has room for more lights than a first visit shows: the run (keepsakes found, the loop closed) adds
  // friends to the convoy, so the ending reflects what the visitor did on the way here.
  const convoyDefs: { color: string; lag: number; side: number; rest: [number, number] }[] = [
    // parents: flank the boat (boat rests at -0.6, -1.72)
    { color: '#F2A93B', lag: 0.05, side: -0.3, rest: [-0.9, -1.46] },
    { color: '#F2A93B', lag: 0.07, side: 0.28, rest: [-0.16, -2.14] },
    // friends: a loose arc out on the open water (always present)
    { color: '#f6b85e', lag: 0.14, side: -0.5, rest: [-0.98, -2.8] },
    { color: '#f0a24c', lag: 0.18, side: 0.45, rest: [-0.62, -3.55] },
    { color: '#f7c46e', lag: 0.22, side: -0.15, rest: [0.12, -3.05] },
    // friends the run adds (one per two keepsakes; the last when the loop is closed)
    { color: '#f3ad55', lag: 0.26, side: 0.7, rest: [-0.36, -3.3] },
    { color: '#f5bb66', lag: 0.29, side: -0.8, rest: [-1.05, -4.05] },
    { color: '#f2b062', lag: 0.31, side: 0.6, rest: [0.0, -4.25] },
    { color: '#f8c878', lag: 0.33, side: -0.6, rest: [-0.72, -4.6] },
    { color: '#efa64e', lag: 0.35, side: 0.2, rest: [0.5, -3.75] },
  ];
  const BASE_LIGHTS = mobileBuild ? 4 : 5;
  const convoyCount = mobileBuild ? 7 : convoyDefs.length;
  const convoy: Convoy[] = convoyDefs.slice(0, convoyCount).map((d, i) => {
    const l = createLantern(THREE, { color: d.color, size: LSIZE, intensity: 1, light: false, flicker: !reduced, seed: 11 + i * 7 });
    scene.add(l.group);
    const on = i < BASE_LIGHTS ? 1 : 0;
    l.group.visible = on > 0;
    return { l, lag: d.lag, side: d.side, rest: d.rest, phase: i * 1.7, shown: on, want: on };
  });

  // ---- the run so far (read-only): keepsakes found and whether the loop closed ---------------------------------
  // The world never writes game state. It seeds from the persisted save on enter (so Reset / a new visit is
  // reflected) and follows live bus events while the page is open.
  let found = 0;
  let loopClosed = false;
  let tierCap = convoyCount;
  const readRun = () => {
    try {
      const raw = localStorage.getItem('tlwh.save');
      const data = raw ? (JSON.parse(raw) as { keepsakes?: unknown; loopClosed?: unknown }) : null;
      found = Array.isArray(data?.keepsakes) ? Math.min(10, data!.keepsakes.length) : 0;
      loopClosed = Boolean(data?.loopClosed);
    } catch {
      /* blocked storage: the base convoy still arrives */
    }
  };
  const applyRun = (instant: boolean) => {
    const extra = Math.floor(found / 2) + (loopClosed ? 1 : 0);
    const n = Math.min(tierCap, BASE_LIGHTS + extra);
    for (let i = 0; i < convoy.length; i++) {
      const c = convoy[i];
      c.want = i < n ? 1 : 0;
      if (instant || reduced) c.shown = c.want;
      c.l.group.visible = c.shown > 0.001;
    }
  };
  readRun();
  applyRun(true);

  // ---- state ------------------------------------------------------------------------------------------------
  const skyNow = makeSkyState(THREE);
  const v = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camTgt = new THREE.Vector3();
  const sunTmp = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const ndc = new THREE.Vector3();
  const goldCol = new THREE.Color(GOLD);
  let active = false;
  let hover = 0;
  let hoverTarget = 0;
  let pulse = 0;
  let lookHold = 0;
  /** 0..1 envelope of the 'Look closer' dolly: the camera leans in to the glass and eases back out. */
  let look = 0;
  const lookTmp = new THREE.Vector3();
  let px = 0;
  let py = 0;
  let lastBoatU = -1;
  let wakeClock = 0;
  const env: Environment = { mist: MIST, tone: 'dark' };

  // ---- interactions -----------------------------------------------------------------------------------------
  /** One warm breath through the glass when the loop is closed (live, or on first arrival after closing it). */
  let echoPending = loopClosed;
  const offs: (() => void)[] = [];
  offs.push(
    bus.on('ripple', ({ x, y, strength }) => {
      if (active) water.rippleAtNdc(x, y, ctx.camera, Math.min(1.2, strength * 0.8));
    }),
  );
  offs.push(
    bus.on('light:pulse', () => {
      if (active && !reduced) pulse = 1;
    }),
  );
  offs.push(
    bus.on('next:look', () => {
      lookHold = 3.2;
      if (!reduced) pulse = 1;
    }),
  );
  offs.push(
    // Reset (Satchel or the tally) and boot: follow the committed keepsakes; re-read the loop flag from the save
    bus.on('keepsakes:sync', ({ ids }) => {
      readRun();
      found = Math.min(10, ids.length);
      applyRun(false);
    }),
  );
  offs.push(
    bus.on('keepsake:collected', () => {
      found = Math.min(10, found + 1);
      applyRun(false);
    }),
  );
  offs.push(
    bus.on('loop:closed', () => {
      const was = loopClosed;
      loopClosed = true;
      applyRun(false);
      // the HUD's brush circle closes: the glass answers with one warm breath
      if (!was) echoPending = true;
    }),
  );

  // The seed under glass is the chapter's hero object, so it is a hotspot: pointing at it warms the glass at once,
  // clicking or tapping it lets it breathe ('next:look'). Its DOM mirror is the 'Look closer' button under the
  // well-being line (src/ui/tally.ts), which emits the same event. The proxy is an invisible cylinder round the
  // cloche, raycast only once the sprout is up and this shore owns the frame.
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxyGeo = new THREE.CylinderGeometry(0.22, 0.22, CLOCHE_HEIGHT + 0.06, 12);
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.position.y = 0.05 + CLOCHE_HEIGHT / 2; // the cloche stands on the plinth top (seedling.ts: 0.05)
  seedling.group.add(proxy);
  let hotHover = false;
  const spots: Hotspot[] = [
    {
      id: 'next-seed',
      proxy,
      label: TALLY_COPY.lookCloser,
      enabled: (f) => active && f.chapter === 'next' && storyT(f.tExact, f.aspect < 0.8) > 0.3,
      onHover(h) {
        hotHover = h;
      },
      onActivate() {
        bus.emit('next:look', {});
      },
    },
  ];

  // camera helpers (no allocation per frame)
  const keyPos = (keys: CamKey[], t: number, out: THREE_NS.Vector3, which: 'pos' | 'target') => {
    // piecewise smootherstep between authored keys; endpoints are the composed stills
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    let u = (t - a.t) / (b.t - a.t);
    u = Math.min(1, Math.max(0, u));
    u = u * u * u * (u * (u * 6 - 15) + 10);
    const A = a[which];
    const B = b[which];
    return out.set(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
  };
  const keyFov = (keys: CamKey[], t: number) => {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    let u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    u = u * u * (3 - 2 * u);
    return a.fov + (b.fov - a.fov) * u;
  };

  function applySky(t: number, portrait: boolean) {
    lerpSkyState(dawnA, dawnB, smoothstep(0, 1, t), skyNow);
    // Portrait has a narrower lens: swing the sun's azimuth in so the sunrise stays in the authored mobile frame.
    if (portrait) skyNow.sunDir.set(0.13, skyNow.sunDir.y, -1).normalize();
    sky.setState(skyNow);
    water.setSky(skyNow);
    seedling.setSky(skyNow);
    sky.fogColor((scene.fog as THREE_NS.Fog).color);
    sunTmp.copy(skyNow.sunDir).multiplyScalar(20);
    sunLight.position.copy(sunTmp);
    sunLight.color.copy(skyNow.sunColor);
    boat.setSun(skyNow.sunDir, skyNow.sunColor, 0.45);
  }
  applySky(0, mobileBuild);

  return {
    id: 'next',
    scene,
    update(f: FrameInfo) {
      const t = storyT(f.t, f.aspect < 0.8);
      const dt = f.dt;
      const time = reduced ? 0 : f.time;

      applySky(t, f.aspect < 0.8);
      sky.update(dt, f.time);
      water.update(dt, f.time);

      // ---- seed → sprout (scroll-scrubbed, reversible) ----
      const stem = smoothstep(0.18, 0.66, t);
      const leaves = smoothstep(0.56, 0.9, t);
      // a closed loop leaves the glass a little warmer for good (the HUD circle's gap, echoed here)
      const glow = Math.min(1, smoothstep(0.3, 0.95, t) * (loopClosed ? 1.12 : 1));
      seedling.setGrowth(stem, leaves, glow);
      // ambient warmth when the pointer comes near the glass (no click target; see note above)
      if (f.pointer.active && storyT(f.tExact, f.aspect < 0.8) > 0.2) {
        ndc.copy(seedling.heart).project(ctx.camera);
        const dx = (ndc.x - f.pointer.x) * f.aspect;
        const dy = ndc.y - f.pointer.y;
        hoverTarget = dx * dx + dy * dy < 0.045 ? 1 : 0;
      } else hoverTarget = 0;
      // the hotspot is under the pointer: full warmth at once (the < 100 ms response)
      if (hotHover) hoverTarget = 1;
      // the loop-closed echo: one breath through the glass once the sprout is up
      if (echoPending && storyT(f.tExact, f.aspect < 0.8) > 0.8) {
        echoPending = false;
        if (!reduced) pulse = 1;
      }
      // 'Look closer' (DOM mirror): the glass warms for a moment (a held warmth under reduced motion, no breath)
      if (lookHold > 0) {
        lookHold = Math.max(0, lookHold - dt);
        hoverTarget = 1;
      }
      // the dolly leans in quickly and drifts back out slowly; one step under reduced motion
      {
        const lt = lookHold > 0 ? 1 : 0;
        const lk = 1 - Math.exp(-(lt > look ? 3.2 : 1.1) * dt);
        look += (lt - look) * (reduced ? 1 : lk);
      }
      // warm fast (a hand on the glass answers within a frame or two), cool slowly
      const k = 1 - Math.exp(-(hoverTarget > hover ? 22 : 6) * dt);
      hover += (hoverTarget - hover) * (reduced ? 1 : k);
      pulse *= Math.exp(-1.4 * dt);
      seedling.update(time, hover, pulse);

      // ---- boat arrives and rests ----
      const arrive = smoothstep(0.0, 0.62, t);
      const u = 1 - Math.pow(1 - arrive, 2.2); // eases out: glides in, slows to rest
      bez(u, v);
      bezTan(Math.min(u, 0.999), tan);
      const travelYaw = Math.atan2(-tan.z, tan.x);
      const restBlend = smoothstep(0.7, 1, u);
      const yaw = travelYaw + (REST_YAW - travelYaw) * restBlend;
      const calm = 1 - 0.55 * restBlend;
      const bob = Math.sin(time * 1.25) * 0.006 * calm;
      boat.group.position.set(v.x, bob - 0.004, v.z);
      boat.group.rotation.set(Math.sin(time * 0.9 + 1) * 0.035 * calm, yaw, Math.sin(time * 1.1) * 0.03 * calm);
      boat.setLantern(1.15 + 0.15 * glow);
      boat.update(dt, f.time);
      // a faint wake ring while she is moving
      if (!reduced && Math.abs(u - lastBoatU) > 1e-4 && u < 0.985) {
        wakeClock += dt;
        if (wakeClock > 0.55) {
          wakeClock = 0;
          tmp.set(-0.22, 0, 0).applyAxisAngle(UP, yaw);
          water.ripple(v.x + tmp.x, v.z + tmp.z, 0.35);
        }
      }
      lastBoatU = u;
      boat.lantern.group.getWorldPosition(tmp);
      water.setGlow(0, tmp, goldCol, 1.0);

      // ---- convoy drifts in behind the boat and settles on the water ----
      const settle = smoothstep(0.3, 0.88, t);
      const fade = reduced ? 1 : 1 - Math.exp(-1.6 * dt);
      const warm = loopClosed ? 0.12 : 0;
      for (let i = 0; i < convoy.length; i++) {
        const c = convoy[i];
        c.shown += (c.want - c.shown) * fade;
        if (Math.abs(c.want - c.shown) < 0.002) c.shown = c.want;
        c.l.group.visible = c.shown > 0.001;
        if (!c.l.group.visible) continue;
        const ui = u - c.lag;
        bez(ui, tmp);
        bezTan(Math.max(0, Math.min(ui, 0.999)), tan).normalize();
        // trailing formation: offset sideways from the course
        const tx = tmp.x - tan.z * c.side;
        const tz = tmp.z + tan.x * c.side;
        const x = tx + (c.rest[0] - tx) * settle;
        const z = tz + (c.rest[1] - tz) * settle;
        const lb = Math.sin(time * 1.1 + c.phase) * 0.005 * (1 - 0.5 * settle);
        c.l.group.position.set(x, LSIZE * 0.52 + lb, z);
        c.l.group.rotation.z = Math.sin(time * 0.8 + c.phase) * 0.04 * (1 - 0.5 * settle);
        c.l.group.scale.setScalar(0.25 + 0.75 * c.shown);
        c.l.setIntensity((0.85 + 0.2 * glow + warm) * c.shown);
        c.l.update(dt, f.time);
        if (i < 3) water.setGlow(i + 1, c.l.group.position, goldCol, 0.75);
      }

      // ---- pointer parallax (small, clamped, damped; off for reduced motion) ----
      if (!reduced) {
        const pk = 1 - Math.exp(-2.5 * dt);
        const tx = f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.x)) : 0;
        const ty = f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.y)) : 0;
        px += (tx - px) * pk;
        py += (ty - py) * pk;
      }
    },
    pose(f, camera) {
      const mobile = f.aspect < 0.8;
      const keys = mobile ? MOBILE : DESKTOP;
      const t = storyT(f.t, mobile);
      keyPos(keys, t, camPos, 'pos');
      keyPos(keys, t, camTgt, 'target');
      if (!reduced) {
        camPos.x += px * 0.12;
        camPos.y += py * 0.05;
      }
      // 'Look closer': dolly toward the heart of the seedling and settle the gaze on it
      let fov = keyFov(keys, t);
      if (look > 0.001) {
        const l = look * look * (3 - 2 * look);
        lookTmp.copy(seedling.heart);
        lookTmp.y += 0.08;
        camPos.lerp(lookTmp, 0.42 * l);
        camTgt.lerp(lookTmp, 0.85 * l);
        fov -= 5 * l;
      }
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(camTgt);
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    environment() {
      return env;
    },
    hotspots() {
      return spots;
    },
    enter() {
      active = true;
      // re-read the run (Reset elsewhere, or keepsakes found since the last visit to this shore)
      const wasClosed = loopClosed;
      readRun();
      applyRun(false);
      if (loopClosed && !wasClosed) echoPending = true;
    },
    leave() {
      active = false;
      hoverTarget = 0;
      hotHover = false;
    },
    setTier(tier) {
      shore.grass.visible = tier !== 'low';
      tierCap = tier === 'low' ? 4 : convoyCount;
      applyRun(true);
    },
    dispose() {
      offs.forEach((o) => o());
      convoy.forEach((c) => c.l.dispose());
      boat.dispose();
      seedling.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      shore.dispose();
      water.dispose();
      sky.dispose();
      hemi.dispose();
      sunLight.dispose();
    },
  };
};

export default create;
