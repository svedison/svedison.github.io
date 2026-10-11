// The "Love earned" beat (SPEC §4.3, river close). When the Love light is earned (bus 'light:pulse' id 'love'),
// an ember lifts out of Jay's lantern, climbs to the courtyard sky, and 爱 is brushed in there in lantern gold with
// its word beneath it, holds, then settles back into the mist. One screen-space quad, drawn only while the beat
// runs (main pass, never in the reflection). Copy comes from content (THREE_WORDS); nothing is hard-coded here.
// Reduced motion: no flight, no brush sweep; the gold seal and word fade in, hold and fade out.
import type * as THREE_NS from 'three';
import { THREE_WORDS } from '../../../content/story';

type THREE = typeof THREE_NS;

export interface LoveBeat {
  mesh: THREE_NS.Mesh;
  /** Start the beat (no-op while one is already running). */
  play(): void;
  readonly running: boolean;
  /**
   * Advance. `lantern` = the lantern's screen position in 0..1 (y up), or null when off screen. `portrait` picks
   * the composition (the seal sits in the top band clear of the copy). Returns the lantern swell 0..1 for the halo.
   */
  update(dt: number, lantern: THREE_NS.Vector2 | null, aspect: number, portrait: boolean): number;
  dispose(): void;
}

const REVEAL = 1.2; // ember flight + brush-in (s)
const HOLD = 2.2;
const FADE = 0.9;
const TOTAL = REVEAL + HOLD + FADE;

export function createLoveBeat(THREE: THREE, reducedMotion: boolean): LoveBeat {
  const word = THREE_WORDS.find((w) => w.id === 'love')!;
  const W = 512, H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // the glyph is drawn in white (alpha = ink) and coloured in the shader, so one texture serves the gold fill and
  // the dark ink edge that keeps it legible on pale mist
  const draw = () => {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 400px 'Ma Shan Zheng', 'Noto Serif SC', serif`;
    g.fillText(word.cjk, W / 2, 250);
    g.font = `500 44px 'IBM Plex Mono', ui-monospace, monospace`;
    const label = word.en.toUpperCase().split('').join(' ');
    g.fillText(label, W / 2, 560);
    tex.needsUpdate = true;
  };
  draw();
  // the calligraphic face may still be loading: redraw once it is in
  try {
    void document.fonts?.load(`400 64px 'Ma Shan Zheng'`, word.cjk).then(draw, () => undefined);
  } catch {
    /* no FontFaceSet: the fallback face stays */
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex },
      uRect: { value: new THREE.Vector4(0.42, 0.72, 0.1, 0.16) }, // centre (0..1 screen), half size (0..1 screen)
      uReveal: { value: 0 },
      uAlpha: { value: 0 },
      uEmber: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uAspect: { value: 1 },
      uGold: { value: new THREE.Color('#f2a93b') },
      uInk: { value: new THREE.Color('#2a1c0e') },
    },
    vertexShader: `varying vec2 vS; void main(){ vS = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec4 uRect; uniform float uReveal, uAlpha, uAspect; uniform vec3 uEmber;
      uniform vec3 uGold, uInk; varying vec2 vS;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 col = vec3(0.0); float a = 0.0;
        vec2 q = (vS - (uRect.xy - uRect.zw)) / (2.0 * uRect.zw);
        if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
          vec2 uv = vec2(q.x, q.y);
          float ink = texture2D(uTex, uv).a;
          // a soft dark edge (sampled wider) so the gold holds on pale mist without a plate
          float o = 0.012;
          float edge = max(max(texture2D(uTex, uv + vec2(o, 0.0)).a, texture2D(uTex, uv - vec2(o, 0.0)).a),
                           max(texture2D(uTex, uv + vec2(0.0, o)).a, texture2D(uTex, uv - vec2(0.0, o)).a));
          // brush-in: the stroke front sweeps top-left to bottom-right with a ragged, fibrous edge
          float n = vn(q * vec2(7.0, 22.0)) * 0.6 + vn(q * 40.0) * 0.4;
          float front = (1.0 - q.y) * 0.8 + q.x * 0.2 + (n - 0.5) * 0.22;
          float m = 1.0 - smoothstep(uReveal * 1.25 - 0.12, uReveal * 1.25, front);
          float fill = ink * m;
          float rim = clamp(edge - ink, 0.0, 1.0) * m;
          col = uGold * (1.0 + 0.25 * n) * fill + uInk * rim;
          a = max(fill, rim * 0.55) * uAlpha;
          col *= uAlpha;
        }
        // the ember: a warm point with a small bloom
        vec2 d = (vS - uEmber.xy) * vec2(uAspect, 1.0);
        float r2 = dot(d, d);
        float e = uEmber.z * (exp(-r2 * 9000.0) + 0.35 * exp(-r2 * 600.0));
        col += vec3(1.0, 0.82, 0.5) * e;
        a = max(a, clamp(e, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // premultiplied: colour already carries alpha (lets the ember add light)
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fog: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 60;
  mesh.visible = false;

  let t = -1;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const u = mat.uniforms;

  return {
    mesh,
    get running() {
      return t >= 0;
    },
    play() {
      if (t >= 0) return;
      t = 0;
      mesh.visible = true;
    },
    update(dt, lantern, aspect, portrait) {
      if (t < 0) return 0;
      // wall-clock paced (a slow frame must not stretch the beat), capped so a hidden tab does not skip it
      t += Math.min(0.25, Math.max(dt, 1 / 120));
      if (t >= TOTAL) {
        t = -1;
        mesh.visible = false;
        return 0;
      }
      // composition: desktop, over the courtyard sky left of the copy column; portrait, the top band under the HUD
      const cx = portrait ? 0.5 : 0.36, cy = portrait ? 0.79 : 0.74;
      const hh = portrait ? 0.085 : 0.15;
      u.uRect.value.set(cx, cy, (hh * (W / H)) / aspect, hh);
      u.uAspect.value = aspect;
      const fade = t > REVEAL + HOLD ? 1 - (t - REVEAL - HOLD) / FADE : 1;
      if (reducedMotion) {
        u.uReveal.value = 1;
        u.uAlpha.value = Math.min(1, t / 0.4) * fade;
        u.uEmber.value.z = 0;
        return Math.min(1, t / 0.4) * fade;
      }
      // ember: rises from the lantern (or from below the seal) on a gentle arc, arriving as the brush starts
      const fly = ease(t / 0.75);
      const sx = lantern ? lantern.x : cx, sy = lantern ? lantern.y : cy - 0.3;
      const ex = sx + (cx - sx) * fly + Math.sin(fly * Math.PI) * 0.03;
      const ey = sy + (cy - hh * 0.35 - sy) * fly;
      u.uEmber.value.set(ex, ey, t < 0.75 ? Math.min(1, t * 6) : Math.max(0, 1 - (t - 0.75) * 3));
      u.uReveal.value = ease((t - 0.45) / (REVEAL - 0.35));
      u.uAlpha.value = Math.min(1, Math.max(0, (t - 0.4) * 4)) * fade;
      // lantern swell: a quick rise as the ember leaves, easing out over the hold
      return Math.min(1, t * 4) * (t < REVEAL ? 1 : fade * 0.6 + 0.4 * Math.max(0, 1 - (t - REVEAL) / HOLD));
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
      mesh.removeFromParent();
    },
  };
}
