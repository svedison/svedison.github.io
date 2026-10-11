// "Nearly the same latitude." (SPEC Ch.3): a thin dashed parallel drawn across the frame along the sea horizon,
// from Orange County (33.7° N, here) toward Jiangyin (31.9° N, across this water), scrubbed by EXACT scroll progress
// so it draws forward and un-draws backward; fully drawn and static under reduced motion. Decorative (aria-free
// canvas): the same facts are in the DOM copy and the Atlas. Coordinates and names come from content STATIONS.
import type * as THREE_NS from 'three';
import { STATIONS } from '../../../content/story';

type THREE = typeof THREE_NS;

export interface LatitudeLine {
  /** reveal 0..1 (how much is drawn), opacity 0..1; box in NDC: x0..x1 at centre y. */
  render(renderer: THREE_NS.WebGLRenderer, reveal: number, opacity: number, x0: number, x1: number, y: number, compact: boolean): void;
  dispose(): void;
}

const fmt = (lat: number) => `${lat.toFixed(1)}° N`;

export function createLatitudeLine(THREE: THREE): LatitudeLine {
  const here = STATIONS.find((s) => s.id === 'oc');
  const there = STATIONS.find((s) => s.id === 'jiangyin');
  const leftFull = here ? `${fmt(here.lat)} · ${here.label}` : '';
  const leftShort = here ? fmt(here.lat) : '';
  const right = there ? `${there.label} · ${fmt(there.lat)}` : '';
  let compactNow = false;

  // two layers: A = the parallel, its 'here' label and end dot (clipped by the reveal as it draws); B = the far
  // 'there' label and ring, which fade in whole once the line reaches them (never clipped mid-word)
  const mkLayer = () => {
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { cv, g, tex, mat, mesh };
  };
  const geo = new THREE.PlaneGeometry(1, 1);
  const A = mkLayer();
  const B = mkLayer();
  const cv = A.cv;
  const g = A.g;
  const tex = A.tex;
  const mat = A.mat;
  const mesh = A.mesh;
  const scene = new THREE.Scene();
  scene.add(mesh, B.mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();
  let cw = 0;
  let ch = 0;
  let fontReady = false;
  try {
    document.fonts?.load('500 12px "IBM Plex Mono"').then(() => {
      fontReady = true;
      cw = 0; // force a redraw with the real face
    }, () => undefined);
  } catch {
    /* no font loading API: the monospace fallback is fine */
  }

  function draw(W: number, H: number, dpr: number) {
    cw = W;
    ch = H;
    cv.width = W;
    cv.height = H;
    B.cv.width = W;
    B.cv.height = H;
    g.clearRect(0, 0, W, H);
    B.g.clearRect(0, 0, W, H);
    // dark ink (--ink) on a paper halo: >= 4.5:1 over the bright apricot sky and the glitter path
    const ink = 'rgba(28, 27, 25, 0.94)';
    const fs = Math.round(12 * dpr);
    g.font = `500 ${fs}px ${fontReady ? '"IBM Plex Mono", ' : ''}ui-monospace, monospace`;
    g.textBaseline = 'alphabetic';
    const ly = Math.round(H * 0.72);
    // a soft paper halo under every ink mark, so the line and labels stay legible where a palm trunk, a bluff or
    // bright glitter passes behind them (the HUD's paper ground, not a box)
    const halo = 'rgba(245, 236, 220, 0.86)';
    const haloW = 4 * dpr;
    g.lineJoin = 'round';
    g.strokeStyle = halo;
    g.lineWidth = Math.max(1, Math.round(dpr)) + haloW;
    g.beginPath();
    g.moveTo(5 * dpr, ly + 0.5);
    g.lineTo(W - 5 * dpr, ly + 0.5);
    g.stroke();
    // dashed parallel
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1, Math.round(dpr));
    g.setLineDash([6 * dpr, 5 * dpr]);
    g.beginPath();
    g.moveTo(5 * dpr, ly + 0.5);
    g.lineTo(W - 5 * dpr, ly + 0.5);
    g.stroke();
    g.setLineDash([]);
    // end marks: a lantern-gold dot here, an ink ring there
    g.fillStyle = halo;
    for (const ex of [5 * dpr]) {
      g.beginPath();
      g.arc(ex, ly + 0.5, 3.2 * dpr + haloW * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#c9811f';
    g.beginPath();
    g.arc(5 * dpr, ly + 0.5, 3.2 * dpr, 0, Math.PI * 2);
    g.fill();
    // far ring on layer B (with its own halo)
    const gb = B.g;
    gb.fillStyle = halo;
    gb.beginPath();
    gb.arc(W - 5 * dpr, ly + 0.5, 3.2 * dpr + haloW * 0.6, 0, Math.PI * 2);
    gb.fill();
    gb.strokeStyle = ink;
    gb.lineWidth = 1.2 * dpr;
    gb.beginPath();
    gb.arc(W - 5 * dpr, ly + 0.5, 3.2 * dpr, 0, Math.PI * 2);
    gb.stroke();
    // labels (letter-spaced like the HUD mono)
    const track = (s: string, x: number, align: 'left' | 'right', g: CanvasRenderingContext2D) => {
      const sp = 0.06 * fs;
      let width = 0;
      for (const chr of s) width += g.measureText(chr).width + sp;
      const x0 = align === 'left' ? x : x - width;
      // halo pass first (stroke under every glyph), then the ink on top
      let cx = x0;
      for (const chr of s) {
        g.strokeText(chr, cx, ly - 9 * dpr);
        cx += g.measureText(chr).width + sp;
      }
      cx = x0;
      for (const chr of s) {
        g.fillText(chr, cx, ly - 9 * dpr);
        cx += g.measureText(chr).width + sp;
      }
    };
    for (const gg of [g, gb]) {
      gg.font = g.font;
      gg.textBaseline = 'alphabetic';
      gg.lineJoin = 'round';
      gg.strokeStyle = halo;
      gg.lineWidth = haloW;
      gg.fillStyle = ink;
    }
    track(compactNow ? leftShort : leftFull, 0, 'left', g);
    track(right, W, 'right', gb);
    tex.needsUpdate = true;
    B.tex.needsUpdate = true;
  }

  return {
    render(renderer, reveal, opacity, x0, x1, y, compact) {
      if (compact !== compactNow) {
        compactNow = compact;
        cw = 0;
      }
      if (opacity <= 0.002 || reveal <= 0.002) return;
      renderer.getSize(size);
      const dpr = renderer.getPixelRatio();
      const W = Math.max(8, Math.round(((x1 - x0) / 2) * size.x * dpr));
      const H = Math.round(34 * dpr);
      if (W !== cw || H !== ch) draw(W, H, dpr);
      const hN = (H / dpr / size.y) * 2;
      const wN = (x1 - x0) * reveal;
      mesh.scale.set(wN, hN, 1);
      mesh.position.set(x0 + wN / 2, y + hN * 0.22, 0);
      tex.repeat.set(reveal, 1);
      mat.opacity = opacity;
      // the far label arrives whole as the line reaches it
      const far = Math.min(1, Math.max(0, (reveal - 0.9) / 0.1));
      B.mesh.visible = far > 0.002;
      B.mesh.scale.set(x1 - x0, hN, 1);
      B.mesh.position.set((x0 + x1) / 2, y + hN * 0.22, 0);
      B.mat.opacity = opacity * far * far * (3 - 2 * far);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      renderer.autoClear = auto;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
      B.mat.dispose();
      B.tex.dispose();
    },
  };
}
