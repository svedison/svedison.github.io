// The three Jiangyin keepsake objects (paper boat by the bank, oil-paper umbrella under the eaves, the lit window),
// their raycast proxies, hover warmth and the pickup flourish (a soft additive bloom that swells and fades).
import type * as THREE_NS from 'three';
import type { KeepsakeId } from '../../../content/keepsakes';
import { createPaperBoat, type PaperBoat } from '../../systems/paperBoat';
import { KEEP_BOAT, KEEP_UMBRELLA, WINDOW } from './layout';

type THREE = typeof THREE_NS;

export type JyKeepId = Extract<KeepsakeId, 'paper-boat' | 'oil-paper-umbrella' | 'grandparents-window'>;

export interface KeepObjects {
  group: THREE_NS.Group;
  proxies: Record<JyKeepId, THREE_NS.Mesh>;
  smallBoat: PaperBoat;
  setHover(id: JyKeepId, on: boolean): void;
  /** Hotspot range open: a faint breathing glint marks the object (so it is findable before hover). */
  setActive(id: JyKeepId, on: boolean): void;
  /** Already collected (this session or restored by 'keepsakes:sync'): the breathing glint settles to a faint rim. */
  setFound(id: JyKeepId, on: boolean): void;
  flourish(id: JyKeepId): void;
  /** Window glow multiplier from the module (lantern-like breathing, hover, flourish). */
  update(dt: number, time: number, animate: boolean): void;
  dispose(): void;
}

export function haloTexture(THREE: THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,236,200,1)');
  rg.addColorStop(0.25, 'rgba(255,200,120,0.5)');
  rg.addColorStop(0.6, 'rgba(242,169,59,0.12)');
  rg.addColorStop(1, 'rgba(242,169,59,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ribTexture(THREE: THREE) {
  const W = 128, H = 8;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const ribs = 16;
  for (let i = 0; i < ribs; i++) {
    const x = (i / ribs) * W;
    g.fillStyle = 'rgba(40,20,10,0.55)';
    g.fillRect(x - 0.6, 0, 1.4, H);
    g.fillStyle = 'rgba(255,255,255,0.0)';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function createKeepObjects(THREE: THREE, windowMat: THREE_NS.MeshStandardMaterial, reducedMotion: boolean): KeepObjects {
  const group = new THREE.Group();
  group.name = 'jy-keepsakes';

  // ---- the first paper boat, small, by the canal bank (no lantern: it is the one that started everything)
  const smallBoat = createPaperBoat(THREE, { light: false, lantern: 0, flicker: false });
  smallBoat.lantern.group.visible = false;
  smallBoat.group.scale.setScalar(2.0);
  smallBoat.group.position.set(KEEP_BOAT.x, 0.004, KEEP_BOAT.z);
  smallBoat.group.rotation.y = 0.5;
  group.add(smallBoat.group);

  // ---- oil-paper umbrella: open, resting tilted against the house front under the eaves
  const ribs = ribTexture(THREE);
  const prof: THREE_NS.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push(new THREE.Vector2(0.02 + t * 0.6, 0.3 * (1 - Math.pow(t, 1.35))));
  }
  const canopyGeo = new THREE.LatheGeometry(prof, 16);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#b5482c',
    map: ribs,
    roughness: 0.62,
    side: THREE.DoubleSide,
    emissive: new THREE.Color('#ff8a3c'),
    emissiveIntensity: 0,
  });
  const shaftGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.86, 5);
  shaftGeo.translate(0, -0.1, 0);
  const shaftMat = new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.7 });
  const umbrella = new THREE.Group();
  umbrella.add(new THREE.Mesh(canopyGeo, canopyMat), new THREE.Mesh(shaftGeo, shaftMat));
  const US = 2.5;
  umbrella.scale.setScalar(US);
  umbrella.position.set(KEEP_UMBRELLA.x, KEEP_UMBRELLA.y + 0.62 * US, KEEP_UMBRELLA.z + 0.35);
  // canopy faces the canal (+z) and leans back against the wall
  umbrella.rotation.set(1.05, 0.25, 0.12);
  group.add(umbrella);

  // ---- proxies (raycast only)
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const mk = (x: number, y: number, z: number, s: number) => {
    const m = new THREE.Mesh(sph, proxyMat);
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    group.add(m);
    return m;
  };
  const proxies: Record<JyKeepId, THREE_NS.Mesh> = {
    'paper-boat': mk(KEEP_BOAT.x, 0.3, KEEP_BOAT.z, 1.3),
    'oil-paper-umbrella': mk(KEEP_UMBRELLA.x, KEEP_UMBRELLA.y + 1.4, KEEP_UMBRELLA.z + 0.5, 1.7),
    'grandparents-window': mk(WINDOW.x - 0.2, WINDOW.y, WINDOW.z, 1.2),
  };

  // ---- flourish halos
  const halo = haloTexture(THREE);
  const anchors: Record<JyKeepId, THREE_NS.Vector3> = {
    'paper-boat': new THREE.Vector3(KEEP_BOAT.x, 0.45, KEEP_BOAT.z),
    'oil-paper-umbrella': new THREE.Vector3(KEEP_UMBRELLA.x, KEEP_UMBRELLA.y + 1.6, KEEP_UMBRELLA.z + 0.9),
    'grandparents-window': new THREE.Vector3(WINDOW.x - 0.3, WINDOW.y, WINDOW.z),
  };
  const ids: JyKeepId[] = ['paper-boat', 'oil-paper-umbrella', 'grandparents-window'];
  const sprites = {} as Record<JyKeepId, THREE_NS.Sprite>;
  const age = { 'paper-boat': 99, 'oil-paper-umbrella': 99, 'grandparents-window': 99 } as Record<JyKeepId, number>;
  const hover = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  const hoverT = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  for (const id of ids) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: halo, color: '#ffd9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    s.position.copy(anchors[id]);
    s.visible = false;
    s.renderOrder = 5;
    group.add(s);
    sprites[id] = s;
  }
  // breathing glints while each hotspot's range is open (reuse the halo at low opacity)
  const glints = {} as Record<JyKeepId, THREE_NS.Sprite>;
  const active = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  const activeT = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  const found = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  const pulse = { 'paper-boat': 0, 'oil-paper-umbrella': 0, 'grandparents-window': 0 } as Record<JyKeepId, number>;
  const GLINT_SIZE: Record<JyKeepId, number> = { 'paper-boat': 2.8, 'oil-paper-umbrella': 3.0, 'grandparents-window': 3.6 };
  for (const id of ids) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: halo, color: '#ffc46b', transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, opacity: 0, fog: false }),
    );
    s.position.copy(anchors[id]);
    s.scale.setScalar(GLINT_SIZE[id]);
    s.visible = false;
    s.renderOrder = 4;
    group.add(s);
    glints[id] = s;
  }
  const baseWindow = windowMat.emissiveIntensity;
  const FL = 1.6;

  return {
    group,
    proxies,
    smallBoat,
    setHover(id, on) {
      hoverT[id] = on ? 1 : 0;
    },
    setActive(id, on) {
      activeT[id] = on ? 1 : 0;
    },
    setFound(id, on) {
      found[id] = on ? 1 : 0;
    },
    flourish(id) {
      age[id] = 0;
    },
    update(dt, time, animate) {
      const step = reducedMotion ? 1 : Math.min(1, dt * 8);
      for (const id of ids) {
        hover[id] += (hoverT[id] - hover[id]) * (reducedMotion ? 1 : step);
        if (age[id] < FL) age[id] += Math.max(dt, reducedMotion ? 1 / 60 : 0);
        active[id] += (activeT[id] - active[id]) * (reducedMotion ? 1 : Math.min(1, dt * 2.5));
        const gl = glints[id];
        // a slow lantern-gold glint: a long breath with a brighter crest, so an object in range is findable in the
        // world without its chip (settles to a faint rim once found)
        const ph = animate ? 0.5 + 0.5 * Math.sin(time * 1.25 + ids.indexOf(id) * 1.7) : 0.6;
        const breathe = ph * ph;
        pulse[id] = active[id] * (1 - 0.75 * found[id]) * breathe;
        const op = active[id] * ((0.16 + 0.26 * breathe) * (1 - 0.7 * found[id]) + 0.2 * hover[id]);
        gl.visible = op > 0.004;
        (gl.material as THREE_NS.SpriteMaterial).opacity = op;
        gl.scale.setScalar(GLINT_SIZE[id] * (0.92 + 0.12 * breathe + 0.2 * hover[id]));
      }
      // the small boat bobs at its mooring
      if (animate) {
        smallBoat.group.position.y = 0.004 + Math.sin(time * 1.4) * 0.006;
        smallBoat.group.rotation.z = Math.sin(time * 1.1 + 1) * 0.03;
      }
      const fb = flash(age['paper-boat']);
      // the objects themselves warm with the glint (a soft rim of lantern light), not only the sprite beside them
      smallBoat.setLantern(hover['paper-boat'] * 0.45 + pulse['paper-boat'] * 0.35 + fb * 1.2);
      smallBoat.lantern.group.visible = false;
      canopyMat.emissiveIntensity = hover['oil-paper-umbrella'] * 0.3 + pulse['oil-paper-umbrella'] * 0.16 + flash(age['oil-paper-umbrella']) * 0.9;
      windowMat.emissiveIntensity = baseWindow * (1 + hover['grandparents-window'] * 0.3 + pulse['grandparents-window'] * 0.25 + flash(age['grandparents-window']) * 0.8);
      for (const id of ids) {
        const a = age[id];
        const s = sprites[id];
        if (a >= FL) {
          s.visible = false;
          continue;
        }
        const k = a / FL;
        s.visible = true;
        const sc = (reducedMotion ? 2.2 : 0.6 + 2.6 * (1 - Math.pow(1 - k, 3))) * (id === 'grandparents-window' ? 1.6 : 1);
        s.scale.setScalar(sc);
        (s.material as THREE_NS.SpriteMaterial).opacity = Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k) * 1.4;
      }
    },
    dispose() {
      smallBoat.dispose();
      canopyGeo.dispose();
      canopyMat.dispose();
      shaftGeo.dispose();
      shaftMat.dispose();
      ribs.dispose();
      sph.dispose();
      proxyMat.dispose();
      halo.dispose();
      for (const id of ids) (sprites[id].material as THREE_NS.SpriteMaterial).dispose();
      for (const id of ids) (glints[id].material as THREE_NS.SpriteMaterial).dispose();
      group.removeFromParent();
    },
  };
}

/** 0 → 1 → 0 over the flourish (a quick rise, a slow settle). */
function flash(a: number) {
  if (a >= 1.6) return 0;
  const k = a / 1.6;
  return Math.min(1, k * 6) * Math.pow(1 - k, 1.5);
}
