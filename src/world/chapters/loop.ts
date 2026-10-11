// Ch.6 The Loop (SPEC §3, §7): the camera cranes up through cloud and the whole Pacific rim lies below as an
// ink-wash relief map on paper. The water cycle is ONE brush stroke: the Yangtze at Jiangyin → across the Pacific →
// up into cloud over Seattle → rain → back across to the river. Three station marks (river = love gold,
// sea = gratitude teal, rain = forgive silver) fill when the DOM ring (src/ui/loopUI.ts) places a light;
// 'loop:closed' closes the stroke's gap and sends one gentle bloom of light around it.
//
// Bus: listens to 'loop:placed', 'loop:closed', 'light:pulse'. Emits nothing (no keepsakes in this chapter).
import type * as THREE_NS from 'three';
import { bus } from '../../bus';
import type { LightId } from '../../content/story';
import type { FrameInfo, WorldModuleFactory } from '../types';
import { createClouds, createRainStreaks, createStationMarks, scatterPuffs } from './loop/atmos';
import { LOOP_KNOTS, STATIONS, project } from './loop/geo';
import { createMap, setWashStation, type SharedUniforms } from './loop/map';
import { createStroke } from './loop/stroke';

const MIST = '#e9e5dc';
const LIGHT_INDEX: Record<string, number> = { love: 0, gratitude: 1, forgive: 2 };

type Key = { t: number; p: [number, number, number]; c: [number, number, number]; fov: number };

// Camera grammar for this chapter: crane UP through cloud, then hold high above the rim (SPEC §9).
// Chapter timeline (local t; the section is the pinned manifesto + a breath + the ring ritual in flow):
//   0–0.34  crane up through the bank; the stroke draws itself from Jiangyin while the manifesto reads
//   0.34–0.44  a breath: the whole loop on the map, nothing over it
//   0.36–0.95  the ritual (DOM ring) rises and holds (sticky, ~0.6–0.72) on stage: the 3D loop steps back to a
//              faint wash so there is ONE loop; once closed, the map loop comes back (gap closes, bloom travels)
//   0.8–1  the next chapter's copy rises over the map: the loop steps back again (never ink under copy), then the seam
// Desktop: from the south, north up; lowered during the ritual so the rim reads as relief, not a flat chart.
const KEYS_DESKTOP: Key[] = [
  { t: 0.0, p: [-2, 11, 60], c: [0, 9, 10], fov: 44 },
  { t: 0.12, p: [-1, 30, 66], c: [0, 4, 4], fov: 43 },
  { t: 0.34, p: [1, 74, 58], c: [1, 0, -4], fov: 40 },
  { t: 0.64, p: [1.5, 77, 55], c: [1.5, 0, -6.5], fov: 40 },
  { t: 1.0, p: [4, 86, 46], c: [2.5, 0, -6.5], fov: 40 },
];
// Mobile portrait: from above North America looking west, so the loop runs into depth (Seattle near,
// Jiangyin far) and fills a tall frame instead of being centre-cropped.
const KEYS_MOBILE: Key[] = [
  { t: 0.0, p: [80, 11, 34], c: [40, 9, 12], fov: 54 },
  { t: 0.12, p: [84, 32, 30], c: [36, 4, 8], fov: 54 },
  { t: 0.34, p: [74, 88, 6], c: [8, 0, -3], fov: 50 },
  { t: 0.64, p: [69, 102, 0.5], c: [6, 0, -5], fov: 50 },
  { t: 1.0, p: [67, 105, -2], c: [5, 0, -5.5], fov: 50 },
];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut3 = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
/** 0..1: how much the DOM ring ritual owns the stage at this chapter progress (scroll-linked, reversible). */
// Keyed to loopUI.ts's layout (measured at 1440x900, 1280x800 and 390x844): the ring's board enters the frame at
// ~0.38, holds 0.6–0.72, and its ink is still on screen until ~0.95 (it fades out through the HUD band).
const ritualAt = (t: number) => smooth(0.36, 0.47, t) * (1 - smooth(0.9, 0.97, t));

/** Catmull-Rom through key values (uniform in key index), eased between keys. No allocation. */
function sampleKeys(keys: Key[], t: number, field: 'p' | 'c', axis: number): number {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const u = clamp01((t - k1.t) / (k2.t - k1.t));
  const s = u * u * (3 - 2 * u) * 0.5 + u * 0.5; // gentle ease without stopping dead at keys
  const p0 = keys[Math.max(0, i - 1)][field][axis];
  const p1 = k1[field][axis];
  const p2 = k2[field][axis];
  const p3 = keys[Math.min(n - 1, i + 2)][field][axis];
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}
function sampleFov(keys: Key[], t: number): number {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const u = smooth(keys[i].t, keys[i + 1].t, t);
  return keys[i].fov + (keys[i + 1].fov - keys[i].fov) * u;
}

/** Read-only fallback for lights placed in an earlier visit, in case the UI replay ran before this module loaded. */
function readSaved(): { placed: string[]; closed: boolean } {
  try {
    const raw = localStorage.getItem('tlwh.save');
    if (!raw) return { placed: [], closed: false };
    const d = JSON.parse(raw) as { placed?: unknown; loopClosed?: unknown };
    return { placed: Array.isArray(d.placed) ? d.placed.filter((x): x is string => typeof x === 'string') : [], closed: d.loopClosed === true };
  } catch {
    return { placed: [], closed: false };
  }
}

const create: WorldModuleFactory = (ctx) => {
  const { THREE } = ctx;
  const reduced = ctx.reducedMotion;
  const hi = ctx.tier === 'high' && !ctx.isMobile;
  const scene = new THREE.Scene();
  const mist = new THREE.Color(MIST);
  scene.background = mist;

  const shared: SharedUniforms = {
    uFogColor: { value: mist.clone() },
    uFogDensity: { value: 0.03 },
    uTime: { value: 0 },
    uWarm: { value: 0 },
  };

  // ---- the map ----
  const map = createMap(THREE, shared, { hi });
  scene.add(map.mesh);

  // ---- the stroke ----
  const stroke = createStroke(THREE, shared, { hi, radius: 0.5 });
  stroke.uniforms.uFlow.value = reduced ? 0 : 1;
  scene.add(stroke.group);
  // scripts/shoot-posters.mjs sets this for the no-WebGL still: the map alone, so the DOM ring is the one loop
  const mapOnly = (globalThis as { __LOOP_MAP_ONLY?: boolean }).__LOOP_MAP_ONLY === true;
  stroke.group.visible = !mapOnly;

  // ---- stations ----
  const stationPos = STATIONS.map((s, i) => {
    const k = LOOP_KNOTS[s.knot];
    const [x, z] = project(k.lat, k.lon);
    return new THREE.Vector3(x, k.alt + (i === 2 ? 1.2 : 0.7), z);
  });
  const stationCol = STATIONS.map((s) => new THREE.Color(s.color));
  STATIONS.forEach((_, i) => {
    const washTint = stationCol[i].clone().lerp(new THREE.Color('#ffffff'), i === 2 ? 0.0 : 0.25);
    if (i === 2) washTint.set('#8ea9c4'); // cool blue-silver: rain needs depth to show on paper
    setWashStation(map, i, stationPos[i].x, stationPos[i].z, i === 1 ? 5.5 : 4.2, washTint);
  });
  const marks = createStationMarks(
    THREE,
    STATIONS.map((s, i) => ({ pos: stationPos[i], color: s.color })),
    1.35,
  );
  scene.add(marks.mesh);
  marks.mesh.visible = !mapOnly;
  const markU = STATIONS.map((s) => stroke.knotU[s.knot]);

  // ---- clouds: the bank the camera rises through + the cloud over Seattle ----
  const seattle = stationPos[2];
  const bank = createClouds(
    THREE,
    shared,
    [
      ...scatterPuffs(11, hi ? 30 : 20, 0, 58, 46, 22, 5, 24, 7, 14),
      ...scatterPuffs(12, hi ? 26 : 18, 84, 30, 26, 24, 5, 24, 7, 14),
      // a few high wisps over the far land, for depth when looking down
      ...scatterPuffs(13, 5, -62, -10, 10, 22, 14, 22, 5, 9),
      ...scatterPuffs(14, 5, 66, -26, 10, 12, 14, 22, 5, 9),
    ],
    0.95,
  );
  const bankCount = hi ? 66 : 48;
  scene.add(bank.mesh);
  const seattleCloud = createClouds(
    THREE,
    shared,
    scatterPuffs(21, 9, seattle.x - 0.5, seattle.z, 4.2, 2.6, seattle.y - 0.8, seattle.y + 1.8, 2.2, 3.8),
    0.78,
  );
  scene.add(seattleCloud.mesh);
  const rainSea = createRainStreaks(THREE, shared, {
    count: 160,
    origin: new THREE.Vector3(seattle.x - 0.4, seattle.y - 1.2, seattle.z + 0.3),
    height: seattle.y - 1.6,
    radius: 3.4,
    seed: 5,
  });
  scene.add(rainSea.mesh);
  // rain falling back into the river on the far side of the loop
  const [rx, rz] = project(33.6, 123.2);
  const rainRiver = createRainStreaks(THREE, shared, {
    count: 70,
    origin: new THREE.Vector3(rx, 5.2, rz),
    height: 4.8,
    radius: 2.4,
    seed: 6,
    length: 0.6,
  });
  scene.add(rainRiver.mesh);

  // ---- state ----
  const litTarget = [0, 0, 0];
  const lit = [0, 0, 0];
  const ring = [0, 0, 0]; // 0 idle; animates 0→1 once per placement
  const ringOn = [false, false, false];
  const pulse = [0, 0, 0];
  let closed = false;
  let closeAmt = 0;
  let warm = 0;
  let pulseClock = -1; // seconds into the closing bloom, -1 = not running
  let shown = 0; // 0..1: the closed loop has taken the stage back from the ring (eases in after closing)
  let px = 0;
  let py = 0;

  function place(id: LightId | string, animate: boolean) {
    const i = LIGHT_INDEX[id];
    if (i === undefined || litTarget[i] === 1) return;
    litTarget[i] = 1;
    if (animate && !reduced) {
      ring[i] = 0;
      ringOn[i] = true;
    } else {
      lit[i] = 1;
    }
  }
  function closeLoop(animate: boolean) {
    if (closed) return;
    closed = true;
    for (let i = 0; i < 3; i++) place(STATIONS[i].id, false);
    if (animate && !reduced) {
      pulseClock = 0;
    } else {
      closeAmt = 1;
      warm = 1;
      shown = 1;
      for (let i = 0; i < 3; i++) lit[i] = 1;
    }
  }

  const saved = readSaved();
  saved.placed.forEach((id) => place(id, false));
  if (saved.closed) closeLoop(false);

  const offs = [
    bus.on('loop:placed', ({ id }) => place(id, true)),
    bus.on('loop:closed', () => closeLoop(true)),
    bus.on('light:pulse', ({ id }) => {
      const i = LIGHT_INDEX[id];
      if (i !== undefined && !reduced) pulse[i] = 1;
    }),
  ];

  function applyTier(tier: string) {
    const low = tier === 'low';
    bank.setCount(low ? Math.round(bankCount * 0.55) : bankCount);
    rainSea.setDensity(low ? 0.5 : 1);
    rainRiver.setDensity(low ? 0.5 : 1);
    map.setDetail(!low);
  }
  applyTier(ctx.tier);

  const isMobileFrame = (f: FrameInfo) => ctx.isMobile || f.aspect < 0.8;
  // reduced motion: the engine already passes the composed still's progress (REDUCED_STILLS.loop) as f.t
  const T = (f: FrameInfo) => f.t;
  const target = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();

  return {
    id: 'loop',
    scene,
    update(f) {
      const dt = f.dt;
      shared.uTime.value = f.time;
      const t = T(f);

      // Fog: dense cloud at the seam, clearing as the camera breaks through (the seam hides inside it).
      shared.uFogDensity.value = 0.0045 + 0.045 * (1 - smooth(0.0, 0.2, t));

      // The stroke draws itself from Jiangyin around the loop as the camera rises; a small gap stays
      // open (like the HUD's brush circle) until the loop is closed.
      const draw = reduced ? 1 : smooth(0.06, 0.34, t);
      const gapEnd = 0.986 + 0.014 * closeAmt;
      stroke.uniforms.uDraw.value = draw * gapEnd;
      stroke.uniforms.uTip.value = 1 - smooth(0.93, 0.99, draw);

      // One loop on stage at a time: while the ring ritual is centred the map's loop steps back to a faint
      // wash (and its marks fade), so the two never compete. Closing hands the stage back to the map.
      if (closed && shown < 1) shown = reduced ? 1 : Math.min(1, shown + dt / 0.9);
      // The DOM ring, the manifesto and the next chapter's copy follow EXACT scroll, while the camera follows the
      // smoothed progress (which lags a jump by seconds on a slow device). Every DOM-keyed step-back therefore
      // takes the stronger of the two, so the map's loop is never at full ink under the ring or the copy. Under
      // reduced motion f.t is the composed still, so only the exact position counts.
      const dom = (fn: (x: number) => number) => (reduced ? fn(f.tExact) : Math.max(fn(f.t), fn(f.tExact)));
      const rit = dom(ritualAt);
      const back = rit * (1 - 0.85 * easeOut3(shown));
      // ...and it steps back again as the next chapter's copy rises over the map, so that copy never sits on ink
      const seam = dom((x) => smooth(0.8, 0.92, x));
      // Portrait: the pinned manifesto fills the middle band of a tall frame, and the loop runs into depth right
      // through it. While it reads, the stroke draws itself as a faint wash only, then comes back in full for the
      // breath after the copy has gone (0.34-0.44), so ink never sits under the reading lines.
      const read = isMobileFrame(f) ? dom((x) => smooth(0.03, 0.09, x) * (1 - smooth(0.31, 0.39, x))) : 0;
      // The ritual step-back reaches near zero: the map loop hands the stage to the DOM ring as one object
      // changing form, not two loops overlapping.
      stroke.uniforms.uFade.value = Math.min(1 - 0.98 * back, 1 - 0.8 * seam, 1 - 0.9 * read);
      const markVis = Math.min(1 - back, 1 - 0.85 * seam, 1 - 0.7 * read);
      // Pointer parallax (damped, clamped, off under reduced motion).
      const k = 1 - Math.exp(-2.5 * dt);
      const tx = !reduced && f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.x)) : 0;
      const ty = !reduced && f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.y)) : 0;
      px += (tx - px) * k;
      py += (ty - py) * k;

      // Lights.
      const kl = 1 - Math.exp(-2.2 * dt);
      for (let i = 0; i < 3; i++) {
        if (ringOn[i]) {
          ring[i] += dt / 1.6;
          if (ring[i] >= 1) {
            ring[i] = 0;
            ringOn[i] = false;
          }
        }
        if (!reduced) lit[i] += (litTarget[i] - lit[i]) * kl;
        else lit[i] = litTarget[i];
        pulse[i] = Math.max(0, pulse[i] - dt / 1.8);
        const appear = (reduced ? 1 : i === 0 ? smooth(0.05, 0.12, t) : smooth(markU[i] - 0.02, markU[i] + 0.04, draw)) * markVis;
        marks.set(i, lit[i], ringOn[i] ? easeOut3(ring[i]) : 0, pulse[i], appear);
        map.setWash(i, lit[i] * (0.8 + 0.2 * warm));
      }
      stroke.uniforms.uLit.value.set(
        Math.max(lit[0], pulse[0] * 0.6),
        Math.max(lit[1], pulse[1] * 0.6),
        Math.max(lit[2], pulse[2] * 0.6),
      );

      // The closing bloom: the gap closes (~1.2 s, power3.out) and one soft band of light travels the loop once.
      if (pulseClock >= 0) {
        pulseClock += dt;
        closeAmt = easeOut3(pulseClock / 1.2);
        const pt = pulseClock / 4.2;
        stroke.uniforms.uPulse.value = pt % 1;
        stroke.uniforms.uPulseAmt.value = Math.sin(Math.PI * clamp01(pt)) * 0.9;
        warm = smooth(0.2, 1, pt);
        if (pt >= 1) {
          pulseClock = -1;
          closeAmt = 1;
          warm = 1;
          stroke.uniforms.uPulseAmt.value = 0;
        }
      }
      shared.uWarm.value = warm;

      // Rain only once the stroke has reached the cloud.
      const rainOn = reduced ? 1 : smooth(markU[2] - 0.05, markU[2] + 0.05, draw);
      rainSea.mesh.visible = rainOn > 0.01;
      rainRiver.mesh.visible = draw > 0.9;
      seattleCloud.mesh.visible = t > 0.05;
    },
    pose(f, camera) {
      const t = T(f);
      const keys = isMobileFrame(f) ? KEYS_MOBILE : KEYS_DESKTOP;
      camera.position.set(sampleKeys(keys, t, 'p', 0), sampleKeys(keys, t, 'p', 1), sampleKeys(keys, t, 'p', 2));
      target.set(sampleKeys(keys, t, 'c', 0), sampleKeys(keys, t, 'c', 1), sampleKeys(keys, t, 'c', 2));
      // parallax: a small sideways/vertical lean, scaled with height so it reads the same at every altitude
      fwd.subVectors(target, camera.position).normalize();
      right.crossVectors(fwd, up).normalize();
      const amp = 0.025 * camera.position.y + 0.4;
      camera.position.addScaledVector(right, px * amp);
      camera.position.y += py * amp * 0.6;
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      const fov = sampleFov(keys, t);
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    environment: () => ({ mist: MIST, tone: 'dark' }),
    hotspots: () => [],
    enter() {
      // Re-sync with the save in case lights were placed while another module owned the frame.
      const s = readSaved();
      s.placed.forEach((id) => place(id, false));
      if (s.closed) closeLoop(false);
    },
    setTier(tier) {
      applyTier(tier);
    },
    dispose() {
      offs.forEach((o) => o());
      map.dispose();
      stroke.dispose();
      marks.dispose();
      bank.dispose();
      seattleCloud.dispose();
      rainSea.dispose();
      rainRiver.dispose();
    },
  };
};

export default create;
