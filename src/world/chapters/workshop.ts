// Ch.5 The Workshop (SPEC §3, §6, §7): a warm room at night, rain running down a long window, one warm key,
// soft shadows, dust in the light. A walnut shelf holds eight artifacts, one per RESUME entry. Scroll is an
// interior dolly along the shelf. Hover leans the camera a few degrees around a piece; click lifts the piece
// into the hand on a second render layer (3d-orbit-inspect-demo: updateLean / updateHand / openInspect /
// closeInspect ported with its numbers). The DOM caption is owned by ui/logbook.ts; we talk over the bus.
import * as THREE from 'three';
import { bus } from '../../bus';
import type { QualityTier } from '../../bus';
import { RESUME, type ArtifactId } from '../../content/resume';
import type { FrameInfo, Hotspot, WorldModule, WorldModuleFactory } from '../types';
import { buildArtifacts, disposeHaloTexture, type ArtifactWithPulse } from './workshop/artifacts';
import { acquireWoodField, buildStudioEnv, contactTexture, disposeContactTexture, releaseWoodField } from './workshop/materials';
import { ART_Z, buildRoom, setDustPx, SHELF_Y, SPACING, WALL_Z } from './workshop/room';
import { createPost } from './workshop/post';

/* ---- numbers from 3d-orbit-inspect-demo (Numbers table), scaled to small shelf pieces where noted ---- */
const AZ_MAX = 0.3,
  EL_MAX = 0.09; // hover lean, rad
const LEAN_TAU = 4.5; // 1/s
const GAIN_TAU = 0.3; // s
const HAND_D = 0.62; // m from the eye to the lifted piece (pieces are ~0.3 m, the joint was ~0.45 m at 1.0)
const OPEN_S = 1.0,
  CLOSE_S = 0.6,
  CLOSE_FAST_S = 0.28;
const PITCH0 = 0.32,
  PITCH_LO = -0.35,
  PITCH_HI = 1.1; // upright pieces: home pitch shows the top a little
const YAW_PX = 0.0085,
  PITCH_PX = 0.0065;
const SPIN_DAMP = 2.4,
  IDLE_AFTER = 2.2,
  IDLE_SPIN = 0.26;
const ZOOM_LO = 0.7,
  ZOOM_HI = 1.45;
const CLICK_PX = 6;
const ROOM_HEX = 0x0b0806;

const insOut = (k: number) => 1 - Math.pow(1 - k, 4.4);
const sstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const UI_SEL = 'a,button,input,textarea,select,label,[data-ui],.inspect-card,.lb-overlay';

const mark = (n: string) => {
  if (import.meta.env.DEV) performance.mark(`ws:${n}`);
};

const create: WorldModuleFactory = async (ctx) => {
  mark('start');
  const { renderer, camera } = ctx;
  const reduced = ctx.reducedMotion;
  // ?wsq=high pins the tier for headless visual QA (SwiftShader is slow enough to trip the governor)
  const QA_TIER = /[?&]wsq=(high|medium|low)/.exec(location.search)?.[1] as QualityTier | undefined;
  let tier: QualityTier = QA_TIER ?? ctx.tier;
  // The shadow map is baked once per change (autoUpdate is switched off only while we render).
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = null; // a background would re-clear the lifted pass
  const env = buildStudioEnv(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  mark('env');
  const field = acquireWoodField(renderer);
  mark('field');
  const room = buildRoom(field, env, tier, ctx.isMobile);
  mark('room');
  scene.add(room.group);
  for (const l of room.lights) l.layers.enable(1);

  /* the lamp that comes up on the piece only while it is in the hand (layer 1 only) */
  const propLight = new THREE.PointLight(0xffb56a, 0, 3, 2);
  propLight.layers.set(1);
  scene.add(propLight);

  /* ---- artifacts on the shelf ---- */
  const arts: ArtifactWithPulse[] = buildArtifacts({ field, env, isMobile: ctx.isMobile });
  mark('arts');
  const FROM: THREE.Vector3[] = [];
  const Q_BENCH: THREE.Quaternion[] = [];
  const pools: THREE.Mesh[] = [];
  const proxies: THREE.Mesh[] = [];
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const _e = new THREE.Euler();
  arts.forEach((a, i) => {
    const tilt = a.tilt ?? 0;
    const y = SHELF_Y + a.halfH * Math.cos(tilt) + a.half.z * Math.abs(Math.sin(tilt)) + 0.0006;
    const z = tilt ? WALL_Z + a.halfH * Math.abs(Math.sin(tilt)) + 0.012 : (a.z ?? ART_Z);
    FROM.push(new THREE.Vector3(i * SPACING, y, z));
    Q_BENCH.push(new THREE.Quaternion().setFromEuler(_e.set(tilt, a.yaw, 0, 'YXZ')));
    a.root.position.copy(FROM[i]);
    a.root.quaternion.copy(Q_BENCH[i]);
    scene.add(a.root);
    // baked contact pool under the piece (the shadow map alone leaves the seam light)
    const pm = new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -1 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pm);
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = -a.yaw;
    const sx = Math.max(0.05, a.half.x * 2.3),
      sz = Math.max(0.035, (tilt ? 0.012 : a.half.z) * 2.3);
    pool.scale.set(sx, sz, 1);
    pool.position.set(FROM[i].x, SHELF_Y + 0.0008, tilt ? z + a.halfH * Math.sin(-tilt) * 0.95 : z);
    pool.renderOrder = 1;
    scene.add(pool);
    pools.push(pool);
    // a simple raycast proxy at the bench pose
    const px = new THREE.Mesh(new THREE.BoxGeometry(a.half.x * 2.1, a.half.y * 2.1, Math.max(0.05, a.half.z * 2.1)), proxyMat);
    px.position.copy(FROM[i]);
    px.quaternion.copy(Q_BENCH[i]);
    scene.add(px);
    proxies.push(px);
  });
  const idxOf = (id: ArtifactId) => arts.findIndex((a) => a.id === id);

  /* ---- passed pieces step out from behind the copy column (landscape only). Every artifact material is drawn in
     the transparent pass from the start (opacity 1 looks identical), so a fade never swaps or recompiles a program. ---- */
  interface FadeRec {
    mats: { m: THREE.Material; base: number }[];
    glass: THREE.ShaderMaterial[];
    sprites: THREE.Sprite[];
    casters: THREE.Object3D[];
    v: number;
    shadow: boolean;
  }
  const fades: FadeRec[] = arts.map((a) => {
    const rec: FadeRec = { mats: [], glass: [], sprites: [], casters: [], v: 1, shadow: true };
    const seen = new Set<THREE.Material>();
    a.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) {
        rec.sprites.push(o as THREE.Sprite);
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.castShadow) rec.casters.push(m);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        const sm = mat as THREE.ShaderMaterial;
        if (sm.isShaderMaterial) {
          if (sm.uniforms.uFade) rec.glass.push(sm);
          continue;
        }
        mat.transparent = true;
        rec.mats.push({ m: mat, base: mat.opacity });
      }
    });
    return rec;
  });
  function setFade(i: number, v: number) {
    const r = fades[i];
    if (Math.abs(v - r.v) < 0.004 && !((v === 1 || v === 0) && r.v !== v)) return;
    r.v = v;
    for (const x of r.mats) x.m.opacity = x.base * v;
    for (const g of r.glass) g.uniforms.uFade.value = v;
    for (const sp of r.sprites) sp.visible = v > 0.5;
    // fully gone at the end of the fade: no depth-writing ghost, no dark back faces, no contact pool left behind
    const shown = v > 0.02 || (Hs.idx === i && (Hs.open || Hs.out));
    arts[i].root.visible = shown;
    pools[i].visible = shown;
    const sh = v > 0.35;
    if (sh !== r.shadow) {
      r.shadow = sh;
      for (const c of r.casters) c.castShadow = sh;
      shadowDirty = true;
    }
    if (!(Hs.out && Hs.idx === i)) (pools[i].material as THREE.MeshBasicMaterial).opacity = 0.85 * v;
    dirty = Math.max(dirty, 1);
  }
  /** Pure in the camera pose: a piece fades as its centre crosses into the copy column (0.53 W -> 0.4 W), so it has
   *  gone before its silhouette reaches the copy. */
  function fadePassed() {
    const land = sstep(1.0, 1.3, camera.aspect);
    for (let i = 0; i < arts.length; i++) {
      let v = 1;
      if (land > 0 && !((Hs.out || Hs.open) && i === Hs.idx)) {
        _v.copy(FROM[i]).project(camera);
        v = 1 - land * (1 - sstep(0.4, 0.53, (_v.x + 1) / 2));
      }
      // while a piece is in the hand the others step back under the dim, so nothing competes with it
      if (Hs.idx >= 0 && i !== Hs.idx) v *= 1 - 0.75 * Hs.e;
      setFade(i, v);
    }
  }

  /* the fullscreen dim between the room and the lifted piece (opacity 0.80 e, the room's colour) */
  const dimScene = new THREE.Scene();
  const dimMat = new THREE.MeshBasicMaterial({ color: ROOM_HEX, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const dimQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dimMat);
  dimQuad.frustumCulled = false;
  dimScene.add(dimQuad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const post = createPost(renderer, tier);

  /* ---- state ---- */
  let W = 1440,
    H = 900; // CSS px of the canvas (from FrameInfo)
  let lastNow = 0;
  let rdt = 0; // real dt (s), independent of the engine's reduced-motion zero
  let time = 0;
  let owning = false;
  let dirty = 3;
  let shadowDirty = true;
  let warmed = false;
  let firstDrawn = false;
  let lastAmbient = -1;
  let curT = 0;
  let lastAnimT = -1;
  let needSync = false;
  let lastF: FrameInfo | null = null;
  // the piece in focus, reported to the DOM tag + chip index (ui/logbook.ts) over 'shelf:focus'
  const focus = { id: null as ArtifactId | null, x: -1, y: -1, hover: false };
  const camSig = new Float32Array(18);

  // lean (hover) state
  const O = { az: 0, el: 0, g: 0 };
  let hoverIdx = -1;
  let hold = false;
  let canHover = matchMedia('(any-hover:hover)').matches;
  const ptr = { x: -1, y: -1, valid: false };
  const anchor = new THREE.Vector3(0, SHELF_Y + 0.1, ART_Z);
  const anchorT = new THREE.Vector3().copy(anchor);
  const par = { x: 0, y: 0 }; // damped pointer parallax

  // hand state (demo's H_)
  const Hs = {
    open: false,
    k: 0,
    fast: false,
    e: 0,
    e0: 1,
    r0: 1,
    span: 1,
    yaw: 0,
    pitch: PITCH0,
    vy: 0,
    vp: 0,
    idle: 0,
    zoom: 1,
    zoomT: 1,
    fitS: 1,
    ppu: 1, // CSS px per metre at HAND_D
    openAt: 0, // performance.now() of the last open (the close-on-scroll origin settles for a moment after it)
    band: [70, 700, 500, 900] as [number, number, number, number], // top, bottom, left, right (CSS px)
    drag: null as null | { id: number; x: number; y: number; t: number; moved: number },
    out: false,
    turn: 0,
    idx: -1,
    pinch: 0,
    openT: 0,
    presYaw: 0,
    spin: 0,
    drawer: 0,
  };
  const pointers = new Map<number, [number, number]>();
  let down: null | { x: number; y: number; t: number } = null;
  let puddingSent = false;
  // SPEC 4.5 #7: spinning the golden record by hand plays a soft tone (ui/logbook.ts voices it when sound is on)
  let lastTone = -1e9;
  function spinTone(speed: number, now: number) {
    if (speed < 4 || now - lastTone < 420) return;
    lastTone = now;
    bus.emit('record:spin', { speed: Math.min(1, (speed - 4) / 22) });
  }

  const _v = new THREE.Vector3(),
    _T = new THREE.Vector3(),
    _R2 = new THREE.Vector3(),
    _to = new THREE.Vector3(),
    _up = new THREE.Vector3(0, 1, 0),
    _rt = new THREE.Vector3(),
    _q1 = new THREE.Quaternion(),
    _qh = new THREE.Quaternion(),
    _qp = new THREE.Quaternion(),
    _pos = new THREE.Vector3(),
    _tgt = new THREE.Vector3(),
    _off = new THREE.Vector3(),
    _ax = new THREE.Vector3(),
    _px = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ---------------------------------------------------------------- camera path (pure in t) ---- */
  function trackS(t: number) {
    const u = clamp((t - 0.125) / 0.755, 0, 1) * (arts.length - 1); // the first hold lands once the arrival has settled
    const fl = Math.floor(u);
    const dwell = fl + sstep(0.3, 0.7, u - fl); // a soft hold on each piece
    return u + (dwell - u) * 0.5;
  }
  function basePose(t: number, aspect: number, pos: THREE.Vector3, tgt: THREE.Vector3): number {
    const s = trackS(t);
    const xf = s * SPACING;
    const arrive = 1 - sstep(0, 0.12, t);
    const end = sstep(0.88, 1, t);
    // desktop: an oblique three-quarter along the shelf from 1.8 m. The current piece holds at about 0.65 of the
    // width; the piece before it is then near 0.42 W, where fadePassed() has already taken it out from behind
    // the copy column (no camera move can clear it: the spacing is only ~0.25 W at this distance)
    const dx = xf - 1.1,
      dy = SHELF_Y + 0.27,
      dz = 1.72;
    const tx = xf - 0.3,
      ty = SHELF_Y + 0.2,
      tz = ART_Z;
    // portrait: one piece at a time, in the clear band between the copy (top ~40%) and the journey bar
    const mx = xf - 0.04,
      my = SHELF_Y + 0.4,
      mz = 1.3;
    const mtx = xf + 0.005,
      mty = SHELF_Y + 0.19, // the headline steps down to a running head on the shelf, so the piece rides higher
      mtz = ART_Z;
    const m = 1 - sstep(0.8, 1.25, aspect); // 1 = portrait
    pos.set(dx + (mx - dx) * m, dy + (my - dy) * m, dz + (mz - dz) * m);
    tgt.set(tx + (mtx - tx) * m, ty + (mty - ty) * m, tz + (mtz - tz) * m);
    // arrival: from further back and higher, the window and the whole shelf in view
    pos.x += -0.3 * arrive;
    pos.y += 0.2 * arrive;
    pos.z += 0.85 * arrive;
    tgt.y += 0.1 * arrive;
    // leaving: tilt up to the rain on the glass (portrait tilts further, so the last frame is window and rain only)
    tgt.y += (0.5 + 0.35 * m) * end;
    pos.y += 0.12 * m * end;
    tgt.x += 0.3 * end;
    pos.y += 0.1 * end;
    pos.z -= 0.12 * end;
    return 31 + (48 - 31) * m;
  }

  /* ---------------------------------------------------------------- hover: bounded, damped lean ---- */
  function updateLean(dt: number) {
    if (hold || Hs.open || Hs.k > 0) return;
    let tx = 0,
      ty = 0,
      tg = 0;
    if (!reduced) {
      if (canHover) {
        tg = ptr.valid && hoverIdx >= 0 ? 1 : 0;
        if (hoverIdx >= 0) anchorT.copy(FROM[hoverIdx]);
        _v.copy(anchor).project(camera);
        const cx = ((_v.x + 1) / 2) * W,
          cyp = ((1 - _v.y) / 2) * H;
        tx = clamp((ptr.x - cx) / (W * 0.18), -1, 1) * AZ_MAX; // relative to the piece, not the screen
        ty = clamp((cyp - ptr.y) / (H * 0.18), -1, 1) * EL_MAX;
      } else {
        // touch has no hover: a slow sway about the piece in focus shows the same depth
        const s = Math.round(trackS(curT));
        anchorT.copy(FROM[clamp(s, 0, arts.length - 1)]);
        tg = 1;
        tx = Math.sin(time * 0.55) * AZ_MAX * 0.35;
        ty = Math.sin(time * 0.37 + 1) * EL_MAX * 0.4;
      }
    }
    const before = O.az + O.el + O.g;
    O.g += (tg - O.g) * (1 - Math.exp(-dt / GAIN_TAU));
    const k = 1 - Math.exp(-dt * LEAN_TAU);
    O.az += (tx * O.g - O.az) * k;
    O.el += (ty * O.g - O.el) * k;
    anchor.lerp(anchorT, 1 - Math.exp(-dt * 6));
    if (Math.abs(O.az + O.el + O.g - before) > 1e-6) dirty = Math.max(dirty, 1);
    // small pointer parallax when nothing is hovered (disabled under reduced motion)
    const px = reduced || !ptr.valid || !canHover ? 0 : ((ptr.x / W) * 2 - 1) * (1 - O.g);
    const py = reduced || !ptr.valid || !canHover ? 0 : (1 - (ptr.y / H) * 2) * (1 - O.g);
    const kp = 1 - Math.exp(-dt * 2.2);
    par.x += (px - par.x) * kp;
    par.y += (py - par.y) * kp;
  }

  /* ---------------------------------------------------------------- inspect: lift, turn, put back ---- */
  function measureBand() {
    // where the caption will settle (ui/logbook.ts CSS): right column on desktop, bottom sheet on phones
    if (W >= 760) {
      const right = W - clamp(W * 0.032, 16, 48) - Math.min(400, W * 0.34) - 28;
      // the story copy fades to 0.08 while a piece is in the hand (html.ws-inspecting), so the band may start
      // a little left of centre; it still keeps clear of the copy's left column
      const left = Math.max(W * 0.4, right - 640);
      Hs.band = [84, H - 96, left, Math.max(left + 200, right)];
    } else {
      // phones: everything above the 56dvh caption sheet (the copy and chips fade out while inspecting)
      // the band starts under the (faded) headline's first line, so the lifted silhouette sits on the dark room
      Hs.band = [92, Math.max(240, H * 0.44 - 10), 16, W - 16];
    }
    const bandH = Hs.band[1] - Hs.band[0],
      bandW = Hs.band[3] - Hs.band[2];
    const ppu = H / (2 * HAND_D * Math.tan((camera.fov * Math.PI) / 360));
    Hs.ppu = ppu;
    const a = arts[Hs.idx];
    const fill = W >= 760 ? 0.86 : 0.8;
    Hs.fitS = Math.min(bandH * fill, bandW * 0.84 * (fill / 0.86)) / (2 * a.radius * ppu);
    if (W < 760) {
      // phones: the band is short (the caption sheet owns the lower 56%), and the bounding sphere is far too
      // cautious for long, low pieces (a truck seen end-on filled a third of the band). Fit the silhouette the
      // turntable can actually sweep instead: horizontally the box's radius about the up axis, vertically its
      // half height plus what the presentation pitch tips into view. Capped so nothing outgrows the band.
      const rH = Math.hypot(a.half.x, a.half.z);
      const p = a.spin ? 0.12 : PITCH0;
      const rV = a.half.y * Math.cos(p) + rH * Math.sin(p);
      const sV = (bandH * 0.92) / (2 * rV * ppu);
      const sW = (bandW * 0.86) / (2 * rH * ppu);
      Hs.fitS = Math.min(Hs.fitS * 1.6, Math.max(Hs.fitS, Math.min(sV, sW)));
    }
  }
  function snapHome(i: number) {
    const a = arts[i];
    a.root.traverse((o) => o.layers.set(0));
    a.root.position.copy(FROM[i]);
    a.root.quaternion.copy(Q_BENCH[i]);
    a.root.scale.setScalar(1);
    if (a.drawer) a.drawer.position.z = 0;
    (pools[i].material as THREE.MeshBasicMaterial).opacity = 0.85 * fades[i].v;
    shadowDirty = true;
  }
  function openInspect(id: ArtifactId) {
    const i = idxOf(id);
    if (i < 0) return;
    if (Hs.open && Hs.idx === i) return;
    if (Hs.idx >= 0 && Hs.idx !== i && (Hs.k > 0 || Hs.out)) {
      snapHome(Hs.idx); // another piece is still on its way home: put it down at once
      Hs.k = 0;
      Hs.out = false;
    }
    Hs.idx = i;
    measureBand();
    // present the piece square to the eye (heading of the camera), at its own three-quarter yaw
    camera.updateMatrixWorld();
    _v.subVectors(camera.position, FROM[i]);
    Hs.presYaw = Math.atan2(_v.x, _v.z);
    Object.assign(Hs, { open: true, fast: false, yaw: arts[i].spin ? 0 : -0.45, pitch: arts[i].spin ? 0.12 : PITCH0, vy: arts[i].spin ? 0 : 0.55, vp: 0, idle: 0, zoom: 1, zoomT: 1, drag: null });
    Hs.openT = lastF ? lastF.tExact : curT;
    Hs.openAt = performance.now();
    if (Hs.k <= 0) Hs.k = 0;
    hold = true;
    hoverIdx = -1;
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    dirty = 3;
    if (id === 'pudding-cup' && !puddingSent) {
      puddingSent = true;
      bus.emit('keepsake:activate', { id: 'pudding-cup' });
    }
  }
  function closeInspect(fast = false) {
    if (!Hs.open) return;
    const e = Hs.k > 0 ? insOut(Hs.k) : 0;
    Hs.e0 = Hs.r0 = e;
    Hs.k = e > 0 ? 1 : 0;
    Hs.vy = Hs.vp = 0;
    Hs.zoomT = 1;
    Hs.span = Math.max(0.35, e) * (1 + 0.5 * Math.min(1, (e * Hs.turn) / Math.PI));
    Hs.open = false;
    Hs.fast = fast;
    Hs.drag = null;
    renderer.domElement.style.touchAction = '';
    renderer.domElement.style.cursor = '';
    dirty = 3;
  }
  function requestClose() {
    if (Hs.open && Hs.idx >= 0) bus.emit('inspect:close', { id: arts[Hs.idx].id });
  }
  function updateHand(dt: number) {
    const h = Hs;
    if (h.idx < 0 || (!h.open && h.k <= 0 && !h.out)) return;
    const a = arts[h.idx];
    if (h.open && !h.drag) {
      const damp = Math.exp(-dt * SPIN_DAMP);
      h.vy *= damp;
      h.vp *= damp;
      h.idle += dt;
      if (!reduced && h.idle > IDLE_AFTER) h.vy += ((a.spin ? IDLE_SPIN * 2.4 : IDLE_SPIN) - h.vy) * Math.min(1, dt * 0.7);
      if (a.spin) h.spin += h.vy * dt;
      else h.yaw += h.vy * dt;
      h.pitch = clamp(h.pitch + h.vp * dt, PITCH_LO, PITCH_HI);
      const home = a.spin ? 0.12 : PITCH0;
      h.pitch += (home - h.pitch) * (1 - Math.exp(-dt * 0.35));
    }
    h.zoom += (h.zoomT - h.zoom) * (1 - Math.exp(-dt * 8));
    const rate = reduced ? 1e3 : h.open ? 1 / OPEN_S : (h.fast ? 1 / CLOSE_FAST_S : 1 / CLOSE_S) / (h.span || 1);
    h.k = h.open ? Math.min(1, h.k + dt * rate) : Math.max(0, h.k - dt * rate);
    let e: number, eR: number;
    if (h.open) e = eR = insOut(h.k);
    else {
      const c = 1 - h.k;
      eR = h.r0 * (1 - sstep(0, 0.36, c));
      e = h.e0 * (1 - sstep(0.24, 1, c));
    }
    h.e = e;
    // "to": on the eye's ray through the middle of the free band, HAND_D out
    camera.updateMatrixWorld();
    // the middle of the band, then clamped so the piece's turning silhouette (its bounding sphere at the
    // current scale) stays inside it: it never drifts over the faded copy column or under the caption
    const rpx = a.radius * h.fitS * h.zoom * h.ppu;
    let bx = (h.band[2] + h.band[3]) / 2,
      by = (h.band[0] + h.band[1]) / 2;
    if (W >= 760) {
      // (phones fit each axis to the band already, and the band spans the whole width)
      bx = Math.max(h.band[2] + rpx, Math.min(h.band[3] - rpx, bx));
      by = Math.min(h.band[1] - rpx, Math.max(h.band[0] + rpx, by));
    } else {
      // phones: keep the piece's swept height inside the band above the caption sheet (zooming in may outgrow it)
      const rv = Math.min(rpx, (h.band[1] - h.band[0]) / 2);
      by = Math.min(h.band[1] - rv, Math.max(h.band[0] + rv, by));
    }
    _to.set((bx / W) * 2 - 1, 1 - (by / H) * 2, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(HAND_D).add(camera.position);
    // perspective-true hand-off in camera space (rule 7)
    _T.copy(FROM[h.idx]).applyMatrix4(camera.matrixWorldInverse);
    _R2.copy(_to).applyMatrix4(camera.matrixWorldInverse);
    const zf = -_T.z,
      zt = -_R2.z,
      z = zf + (zt - zf) * e;
    a.root.position
      .set((_T.x / zf + (_R2.x / zt - _T.x / zf) * e) * z, (_T.y / zf + (_R2.y / zt - _T.y / zf) * e) * z, -z)
      .applyMatrix4(camera.matrixWorld);
    a.root.position.addScaledVector(_up, Math.sin(Math.PI * e) * 0.04); // lifted, not slid
    _rt.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _qp.setFromAxisAngle(_up, h.presYaw);
    _qh.setFromAxisAngle(_rt, h.pitch).multiply(_q1.setFromAxisAngle(_up, h.yaw)).multiply(_qp);
    h.turn = 2 * Math.acos(Math.min(1, Math.abs(_qh.dot(Q_BENCH[h.idx]))));
    a.root.quaternion.copy(Q_BENCH[h.idx]).slerp(_qh, h.open ? e : eR);
    a.root.scale.setScalar(1 + (h.fitS * h.zoom - 1) * e);
    if (a.spin) a.spin.rotation.z = h.spin;
    if (a.drawer) a.drawer.position.z = 0.068 * sstep(0.45, 1, e) * (h.open ? 1 : sstep(0.3, 1, eR));
    // a lamp from above and left of the eye, on the piece only
    _v.subVectors(camera.position, _to).normalize();
    propLight.position.copy(_to).addScaledVector(_up, 0.32).addScaledVector(_rt, -0.38).addScaledVector(_v, 0.22);
    propLight.intensity = 1.6 * e;
    // phones: a deeper dim, so the window mullion and the lit shelf recede behind the small lifted piece
    dimMat.opacity = (W < 760 ? 0.94 : 0.91) * e;
    (pools[h.idx].material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - sstep(0, 0.25, e));
    const out = e > 0.03 || (h.open && h.k > 0);
    if (out !== h.out) {
      h.out = out;
      a.root.traverse((o) => o.layers.set(out ? 1 : 0));
      shadowDirty = true;
    }
    if (!h.open && h.k <= 0) {
      h.out = false;
      hold = down !== null;
      snapHome(h.idx);
      propLight.intensity = 0;
      dimMat.opacity = 0;
      h.idx = -1;
    }
    dirty = Math.max(dirty, 1);
  }
  function pickInHand(x: number, y: number) {
    if (Hs.idx < 0) return false;
    ndc.set((x / W) * 2 - 1, 1 - (y / H) * 2);
    ray.setFromCamera(ndc, camera);
    ray.layers.set(1);
    return ray.intersectObject(arts[Hs.idx].root, true).length > 0;
  }

  /* ---------------------------------------------------------------- pointer, wheel, keys ---- */
  const isUI = (t: EventTarget | null) => !!(t && (t as Element).closest && (t as Element).closest(UI_SEL));
  const onMove = (e: PointerEvent) => {
    const m = e.pointerType !== 'touch';
    if (m !== canHover) canHover = m;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.valid = !isUI(e.target) && m;
    if (!owning) return;
    const d = Hs.drag;
    if (d && pointers.size < 2 && e.pointerId === d.id) {
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y,
        dtm = Math.max(1, e.timeStamp - d.t);
      d.moved += Math.abs(dx) + Math.abs(dy);
      const a = arts[Hs.idx];
      if (a?.spin) Hs.spin += dx * YAW_PX * 1.6;
      else Hs.yaw += dx * YAW_PX;
      if (a?.spin) spinTone(Math.abs((dx * YAW_PX * 1.6) / (dtm / 1000)), e.timeStamp);
      Hs.pitch = clamp(Hs.pitch + dy * PITCH_PX, PITCH_LO, PITCH_HI);
      Hs.vy = (dx * YAW_PX * (a?.spin ? 1.6 : 1)) / (dtm / 1000);
      Hs.vp = (dy * PITCH_PX) / (dtm / 1000);
      d.x = e.clientX;
      d.y = e.clientY;
      d.t = e.timeStamp;
      Hs.idle = 0;
      dirty = Math.max(dirty, 1);
    }
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2 && Hs.open) {
      const [p, q] = [...pointers.values()];
      const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (Hs.pinch) Hs.zoomT = clamp((Hs.zoomT * dist) / Hs.pinch, ZOOM_LO, ZOOM_HI);
      Hs.pinch = dist;
    }
  };
  const onLeave = () => {
    ptr.valid = false;
  };
  const onDown = (e: PointerEvent) => {
    if (!owning || isUI(e.target)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (Hs.open) {
      if (pointers.size === 1) Hs.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 };
      Hs.vy = Hs.vp = 0;
      Hs.pinch = 0;
      renderer.domElement.style.cursor = 'grabbing';
      return;
    }
    hold = true; // the lean freezes for the length of a press (rule 1)
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    Hs.pinch = 0;
    const d = Hs.drag;
    if (d && e.pointerId === d.id) {
      Hs.drag = null;
      renderer.domElement.style.cursor = Hs.open ? 'grab' : '';
      if (d.moved < CLICK_PX && !pickInHand(e.clientX, e.clientY)) requestClose(); // click away puts it back
      return;
    }
    if (down) {
      down = null;
      hold = Hs.open || Hs.k > 0;
    }
  };
  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (down) {
      down = null;
      hold = Hs.open || Hs.k > 0;
    }
    Hs.drag = null;
  };
  const onTouchMove = (e: TouchEvent) => {
    // one-finger turn in the hand must not scroll the page (touch-action:none only while inspecting)
    if (owning && Hs.open && (Hs.drag || pointers.size > 1) && !isUI(e.target)) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (!owning || !Hs.open || isUI(e.target)) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    // the wheel dollies the piece; at either bound it falls through to the page, and scrolling puts it back
    if ((dy > 0 && Hs.zoomT <= ZOOM_LO + 1e-3) || (dy < 0 && Hs.zoomT >= ZOOM_HI - 1e-3)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    Hs.zoomT = clamp(Hs.zoomT * Math.exp(-dy * 0.0012), ZOOM_LO, ZOOM_HI);
    dirty = Math.max(dirty, 1);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!owning || !Hs.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const tg = e.target as HTMLElement | null;
    if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
    const s = 0.14;
    const a = arts[Hs.idx];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowLeft' ? -s : s;
      if (a?.spin) Hs.spin += d * 2;
      else Hs.yaw += d;
      Hs.idle = 0;
      Hs.vy = 0;
      e.preventDefault();
    } else if (e.key === '+' || e.key === '=') Hs.zoomT = clamp(Hs.zoomT * 1.15, ZOOM_LO, ZOOM_HI);
    else if (e.key === '-' || e.key === '_') Hs.zoomT = clamp(Hs.zoomT / 1.15, ZOOM_LO, ZOOM_HI);
    else return;
    dirty = Math.max(dirty, 1);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('keydown', onKey);

  /* ---------------------------------------------------------------- bus ---- */
  const offs: (() => void)[] = [];
  offs.push(bus.on('inspect:open', ({ id }) => openInspect(id)));
  offs.push(
    bus.on('inspect:close', ({ id }) => {
      if (Hs.idx >= 0 && arts[Hs.idx].id === id) closeInspect();
    }),
  );
  offs.push(
    bus.on('keepsake:collected', ({ id }) => {
      if (id !== 'pudding-cup') return;
      arts[idxOf('pudding-cup')].pulse?.(time);
      dirty = 3;
    }),
  );
  // committed keepsakes (boot, module load, game reset): after a reset the pudding cup can be found again
  offs.push(
    bus.on('keepsakes:sync', ({ ids }) => {
      puddingSent = ids.includes('pudding-cup');
    }),
  );

  /* ---------------------------------------------------------------- hotspots ---- */
  const hotspots: Hotspot[] = arts.map((a, i) => ({
    id: `artifact:${a.id}`,
    proxy: proxies[i],
    label: RESUME.find((r) => r.id === a.id)?.artifact ?? a.id,
    enabled: (f: FrameInfo) => f.chapter === 'workshop' && f.tExact > 0.03 && f.tExact < 0.97 && !Hs.open && Hs.k <= 0 && fades[i].v > 0.6,
    onHover(h: boolean) {
      if (h) hoverIdx = i;
      else if (hoverIdx === i) hoverIdx = -1;
    },
    onActivate() {
      bus.emit('inspect:open', { id: a.id });
    },
  }));

  /* ---------------------------------------------------------------- focus (dwell / hover) ---- */
  function onScreen(i: number) {
    _v.copy(FROM[i]).project(camera);
    return _v.z < 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25;
  }
  function emitFocus(id: ArtifactId | null, x: number, y: number, hover: boolean) {
    if (id === focus.id && hover === focus.hover && Math.abs(x - focus.x) < 0.75 && Math.abs(y - focus.y) < 0.75) return;
    focus.id = id;
    focus.x = x;
    focus.y = y;
    focus.hover = hover;
    bus.emit('shelf:focus', { id, x, y, hover });
  }
  /** Which piece the frame is about: the hovered one, else the one the dolly is holding on. Pure in t. */
  function updateFocus(f: FrameInfo) {
    let i = -1,
      hover = false;
    if (f.chapter === 'workshop' && !Hs.open && Hs.k <= 0 && f.tExact > 0.03 && f.tExact < 0.97) {
      if (hoverIdx >= 0 && canHover) {
        i = hoverIdx;
        hover = true;
      } else if (curT > 0.09 && curT < 0.9) {
        const s = trackS(curT);
        const r = Math.round(s);
        if (Math.abs(s - r) < 0.24) i = clamp(r, 0, arts.length - 1);
      }
    }
    if (i < 0) return emitFocus(null, focus.x, focus.y, false);
    const a = arts[i];
    _v.copy(FROM[i]);
    _v.y += a.halfH + 0.015;
    _v.project(camera);
    if (_v.z > 1) return emitFocus(null, focus.x, focus.y, false);
    emitFocus(a.id, Math.round(((_v.x + 1) / 2) * W * 2) / 2, Math.round(((1 - _v.y) / 2) * H * 2) / 2, hover);
  }

  /* ---------------------------------------------------------------- render ---- */
  function cameraChanged() {
    const m = camera.matrixWorld.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(camSig[i] - m[i]) > 1e-6) changed = true;
      camSig[i] = m[i];
    }
    if (camSig[16] !== camera.fov || camSig[17] !== camera.aspect) changed = true;
    camSig[16] = camera.fov;
    camSig[17] = camera.aspect;
    return changed;
  }
  function draw() {
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.getDrawingBufferSize(_px);
    post.setSize(_px.x, _px.y);
    setDustPx(room, _px.y / (2 * Math.tan((camera.fov * Math.PI) / 360)));
    renderer.setClearColor(ROOM_HEX, 1);
    renderer.autoClear = false;
    renderer.setRenderTarget(post.target);
    renderer.clear();
    camera.layers.set(0);
    renderer.render(scene, camera);
    if (Hs.out || !warmed) {
      if (!warmed) {
        // warm the lifted state's programs once (lamp on, layer 1), so the first click does not compile
        warmed = true;
        arts.forEach((a) => a.root.traverse((o) => o.layers.enable(1)));
        propLight.intensity = 0.001;
        renderer.clearDepth();
        camera.layers.set(1);
        renderer.render(scene, camera);
        camera.layers.set(0);
        arts.forEach((a) => a.root.traverse((o) => o.layers.set(0)));
        propLight.intensity = 0;
        renderer.clear();
        renderer.render(scene, camera);
      }
      if (Hs.out) {
        renderer.render(dimScene, quadCam);
        renderer.clearDepth();
        camera.layers.set(1);
        renderer.render(scene, camera);
        camera.layers.set(0);
      }
    }
    renderer.setRenderTarget(null);
    if (!firstDrawn) {
      firstDrawn = true;
      mark('first');
    }
    // desktop: the copy column (left ~40%) sits in the room's shadow, eased off while a piece is in the hand
    const land = sstep(1.0, 1.3, camera.aspect);
    post.setShade(0.16, 0.48, 0.7 * land * (1 - 0.6 * Hs.e));
    post.render(quadCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.setClearColor(_clear, prevAlpha);
  }
  const _clear = new THREE.Color();

  if (import.meta.env.DEV) (window as unknown as { __workshop: unknown }).__workshop = { Hs, O, arts, get owning() { return owning; }, get dirty() { return dirty; } };
  const mod: WorldModule = {
    id: 'workshop',
    scene,
    update(f) {
      const now = performance.now();
      // capped at 0.1 s (not a frame): on a slow device the lift and put-back still finish in their authored time
      rdt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      lastF = f;
      W = f.width;
      H = f.height;
      curT = f.chapter === 'workshop' ? f.t : f.t < 0.5 ? 0 : 1;
      if (needSync) {
        needSync = false;
        bus.emit('inspect:sync', {});
      }
      time = reduced ? 5.2 : f.time;
      if (f.pointer.active === false && canHover) ptr.valid = false;
      // scroll moved on while a piece is in the hand: put it back (closing on scroll). For a moment after the open
      // the origin follows the scroll, so a chip press that scrolled the chip into view (focus, a pointer
      // harness, a smooth-wheel tail) does not count as scrolling away
      if (Hs.open && f.chapter === 'workshop' && now - Hs.openAt < 450) Hs.openT = f.tExact;
      if (Hs.open && (f.chapter !== 'workshop' || Math.abs(f.tExact - Hs.openT) > 0.045)) requestClose();
      updateLean(rdt);
      // ambient motion (rain on the glass, dust, the little cloud): rendered at a capped rate when idle
      const interval = tier === 'high' ? 1 / 30 : 1 / 24;
      const tick = !reduced && time - lastAmbient >= interval;
      if (tick) {
        lastAmbient = time;
        room.update(time);
        dirty = Math.max(dirty, 1);
      }
      // the pieces' own motion (rain under the cloud, the sprout's breath, the pudding pulse) shares the ambient
      // cap, and only asks for a frame when the piece is actually on screen (render on demand, SPEC §12.4)
      if (tick || (reduced && curT !== lastAnimT)) {
        lastAnimT = curT;
        for (let i = 0; i < arts.length; i++) {
          const a = arts[i];
          const inHand = Hs.idx === i;
          if (a.animate?.(time, curT, inHand ? Hs.e : 0, reduced) && (inHand || onScreen(i))) dirty = Math.max(dirty, 1);
        }
      }
    },
    pose(f, cam) {
      const fov = basePose(curT, f.aspect, _pos, _tgt);
      // hover lean: rotate eye and target together about the hovered piece, so it stays put on screen
      if (Math.abs(O.az) > 1e-5 || Math.abs(O.el) > 1e-5) {
        _off.subVectors(_pos, anchor);
        _ax.subVectors(_tgt, _pos).cross(_up).normalize();
        _off.applyAxisAngle(_up, O.az).applyAxisAngle(_ax, -O.el);
        _pos.copy(anchor).add(_off);
        _off.subVectors(_tgt, anchor).applyAxisAngle(_up, O.az).applyAxisAngle(_ax, -O.el);
        _tgt.copy(anchor).add(_off);
      }
      if (!Hs.open && Hs.k <= 0) {
        _pos.x += par.x * 0.025;
        _pos.y += par.y * 0.014;
      }
      cam.position.copy(_pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(_tgt);
      if (cam.fov !== fov || cam.near !== 0.04 || cam.far !== 40) {
        cam.fov = fov;
        cam.near = 0.04;
        cam.far = 40;
      }
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    },
    environment: () => ({ mist: '#130d09', tone: 'light' }),
    hotspots: () => hotspots,
    render(_r, _c, f) {
      fadePassed();
      updateHand(rdt);
      updateFocus(f);
      if (cameraChanged()) dirty = Math.max(dirty, 1);
      if (dirty <= 0) return true; // nothing moved: keep the last frame on the canvas
      dirty--;
      draw();
      return true;
    },
    enter() {
      owning = true;
      dirty = 3;
      lastNow = 0;
      shadowDirty = true;
      // a caption may have opened while this module was still loading: ask the UI to say so again, on the first
      // frame (so the band and the close-on-scroll origin are measured from this frame, not a stale one)
      needSync = true;
    },
    leave() {
      owning = false;
      if (Hs.open) requestClose();
      if (Hs.idx >= 0) {
        snapHome(Hs.idx);
        Object.assign(Hs, { open: false, k: 0, out: false, idx: -1 });
        dimMat.opacity = 0;
        propLight.intensity = 0;
      }
      hold = false;
      hoverIdx = -1;
      O.az = O.el = O.g = 0;
      emitFocus(null, -1, -1, false);
      renderer.domElement.style.touchAction = '';
    },
    setTier(t) {
      if (QA_TIER) return; // visual QA under SwiftShader: keep the authored tier
      tier = t;
      room.setTier(t);
      post.setTier(t);
      dirty = 3;
    },
    dispose() {
      emitFocus(null, -1, -1, false);
      offs.forEach((o) => o());
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKey);
      arts.forEach((a) => a.dispose());
      pools.forEach((p) => {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      });
      proxies.forEach((p) => p.geometry.dispose());
      proxyMat.dispose();
      dimQuad.geometry.dispose();
      dimMat.dispose();
      room.dispose();
      post.dispose();
      env.dispose();
      releaseWoodField();
      disposeContactTexture();
      disposeHaloTexture();
    },
  };
  // Compile every program the room needs (the room pass, the lifted pass with its lamp, the transparent pieces)
  // before handing the module over. compileAsync lets the driver link in parallel (KHR_parallel_shader_compile) and
  // yields while it does, so the engine's own synchronous compile finds everything ready and the first owned frame
  // does not stall. Uses a private camera: the shared one belongs to whichever module is on screen meanwhile.
  try {
    const cc = camera.clone();
    cc.aspect = innerWidth / Math.max(1, innerHeight);
    basePose(0.5, cc.aspect, cc.position, _tgt);
    cc.lookAt(_tgt);
    cc.updateProjectionMatrix();
    cc.updateMatrixWorld();
    await renderer.compileAsync(scene, cc);
    mark('compiled0');
    cc.layers.set(1);
    arts.forEach((a) => a.root.traverse((o) => o.layers.enable(1)));
    await renderer.compileAsync(scene, cc);
    arts.forEach((a) => a.root.traverse((o) => o.layers.set(0)));
    warmed = true;
    mark('compiled1');
  } catch {
    arts.forEach((a) => a.root.traverse((o) => o.layers.set(0)));
  }
  return mod;
};

export default create;
