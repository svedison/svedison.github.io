// Under the surface: "speech you can't yet read". Drifting, out-of-focus brush marks (abstract strokes, not real
// characters) that resolve, one by one, into Latin letters as the camera rises. One instanced draw, one canvas
// atlas (8 x 4 cells of 128 px: rows 0-1 brush marks, rows 2-3 letters). Blur is a mip bias, so it costs nothing.
import type * as THREE_NS from 'three';
import { makeRng } from '../../systems/noise';

type THREE = typeof THREE_NS;

const COLS = 8;
const ROWS = 4;
const CELL = 128;
// Letters drawn from the chapter's own line, so the resolved shapes belong to it. Individual letters only.
const LETTERS = 'aerthsngulydowif';

function drawBrushMarks(g: CanvasRenderingContext2D) {
  const rnd = makeRng(19);
  for (let i = 0; i < 16; i++) {
    const cx = (i % COLS) * CELL;
    const cy = Math.floor(i / COLS) * CELL;
    const strokes = 3 + Math.floor(rnd() * 4);
    for (let s = 0; s < strokes; s++) {
      // a tapered brush stroke along a quadratic curve, laid as overlapping dabs
      const x0 = cx + 26 + rnd() * 76;
      const y0 = cy + 26 + rnd() * 76;
      const horizontal = rnd() < 0.5;
      const len = 26 + rnd() * 50;
      const x1 = Math.min(cx + 104, Math.max(cx + 24, x0 + (horizontal ? len : (rnd() - 0.5) * 30)));
      const y1 = Math.min(cy + 104, Math.max(cy + 24, y0 + (horizontal ? (rnd() - 0.5) * 24 : len)));
      const kx = (x0 + x1) / 2 + (rnd() - 0.5) * 30;
      const ky = (y0 + y1) / 2 + (rnd() - 0.5) * 30;
      const w = 4 + rnd() * 6;
      const steps = 34;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * kx + u * u * x1;
        const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * ky + u * u * y1;
        // press at the start, lift at the end
        const r = w * (0.55 + 0.6 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5)) * (1 - u * 0.55);
        g.beginPath();
        g.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2);
        g.fill();
      }
    }
    if (rnd() < 0.6) {
      g.beginPath();
      g.arc(cx + 30 + rnd() * 68, cy + 30 + rnd() * 68, 4 + rnd() * 4, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawLetters(g: CanvasRenderingContext2D) {
  g.clearRect(0, 2 * CELL, COLS * CELL, 2 * CELL);
  g.font = "500 92px Newsreader, 'Iowan Old Style', Georgia, 'Times New Roman', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 16; i++) {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = (2 + Math.floor(i / COLS)) * CELL + CELL / 2 - 6;
    g.fillText(LETTERS[i], cx, cy);
  }
}

export interface GlyphField {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  /** Centre of the drifting volume (put it a few metres in front of the camera). */
  setCenter(v: THREE_NS.Vector3): void;
  dispose(): void;
}

export function createGlyphField(THREE: THREE, count: number): GlyphField {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  drawBrushMarks(g);
  drawLetters(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  // Redraw the letters once the display face has loaded (first pass may use the fallback serif).
  let alive = true;
  document.fonts?.load("500 92px Newsreader").then(() => {
    if (!alive) return;
    g.fillStyle = '#fff';
    drawLetters(g);
    tex.needsUpdate = true;
  }).catch(() => {});

  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const aBase = new Float32Array(count * 3);
  const aCells = new Float32Array(count * 2);
  const aSeed = new Float32Array(count * 4);
  const rnd = makeRng(7);
  for (let i = 0; i < count; i++) {
    aBase[i * 3] = (rnd() - 0.5) * 16;
    aBase[i * 3 + 1] = (rnd() - 0.5) * 12;
    aBase[i * 3 + 2] = (rnd() - 0.5) * 16;
    aCells[i * 2] = Math.floor(rnd() * 16);
    aCells[i * 2 + 1] = Math.floor(rnd() * 16);
    aSeed[i * 4] = 0.45 + rnd() * 0.55; // size (m)
    aSeed[i * 4 + 1] = rnd() * 6.283; // phase
    aSeed[i * 4 + 2] = 0.6 + rnd() * 0.8; // drift speed
    aSeed[i * 4 + 3] = rnd(); // resolve order
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aCells', new THREE.InstancedBufferAttribute(aCells, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.instanceCount = count;

  const uniforms: Record<string, THREE_NS.IUniform> = {
    uAtlas: { value: tex },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(16, 12, 16) },
    uResolve: { value: 0 },
    uAvoidA: { value: new THREE.Vector4(-1.2, -0.25, -0.38, 0.85) },
    uAvoidB: { value: new THREE.Vector4(-0.25, -0.62, 0.22, -0.18) },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(0.32, 0.55, 0.62) },
    uLetterColor: { value: new THREE.Color(0.95, 0.88, 0.74) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aBase; attribute vec2 aCells; attribute vec4 aSeed;
      uniform float uTime, uResolve; uniform vec3 uCenter, uBox;
      varying vec2 vUv; varying vec2 vCells; varying float vR; varying float vFade; varying float vDepth;
      uniform vec4 uAvoidA, uAvoidB;
      // Feathered keep-out test on the WHOLE instance (its centre, grown by its own half-size), so a mark fades as a
      // unit and is never sliced by the rectangle's edge.
      float avoid(vec2 n, vec2 hs, vec4 r){
        vec2 lo = r.xy - hs; vec2 hi = r.zw + hs;
        vec2 a = smoothstep(lo - 0.1, lo, n) * (1.0 - smoothstep(hi, hi + 0.1, n));
        return a.x * a.y;
      }
      void main(){
        float spd = aSeed.z;
        vec3 p = aBase + vec3(sin(uTime * 0.11 * spd + aSeed.y) * 0.8, uTime * 0.16 * spd, cos(uTime * 0.09 * spd + aSeed.y * 1.3) * 0.7);
        vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 edge = abs(rel) / (uBox * 0.5);
        vFade = (1.0 - smoothstep(0.7, 1.0, edge.x)) * (1.0 - smoothstep(0.7, 1.0, edge.y)) * (1.0 - smoothstep(0.7, 1.0, edge.z));
        vec3 wp = uCenter + rel;
        // per-letter resolve, staggered by seed
        vR = smoothstep(aSeed.w * 0.7, aSeed.w * 0.7 + 0.3, uResolve);
        float ang = (aSeed.y - 3.14) * 0.35 * (1.0 - vR) + sin(uTime * 0.3 + aSeed.y) * 0.12 * (1.0 - vR);
        vec2 c = position.xy * aSeed.x * mix(1.15, 0.85, vR);
        c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        mv.xy += c;
        vDepth = -mv.z;
        vUv = uv; vCells = aCells;
        gl_Position = projectionMatrix * mv;
        // keep the reading blocks clear: fade marks that drift behind the copy or the underwater line
        vec4 cc = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        float cw = max(cc.w, 1e-3);
        vec2 ndc = cc.xy / cw;
        vec2 hs = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * aSeed.x * 0.5 / cw;
        vFade *= (1.0 - 0.95 * avoid(ndc, hs, uAvoidA)) * (1.0 - 0.95 * avoid(ndc, hs, uAvoidB));
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas; uniform float uOpacity; uniform vec3 uColor, uLetterColor;
      varying vec2 vUv; varying vec2 vCells; varying float vR; varying float vFade; varying float vDepth;
      vec2 cellUv(float idx, float row0){
        float col = mod(idx, 8.0); float row = row0 + floor(idx / 8.0);
        return vec2((col + vUv.x) / 8.0, 1.0 - (row + 1.0 - vUv.y) / 4.0);
      }
      void main(){
        // out of focus when very near; the marks are blurred speech, letters come into focus
        float nearBlur = clamp((5.0 - vDepth) * 0.7, 0.0, 2.5);
        float bias = mix(3.0, 0.4, vR) + nearBlur;
        float gA = texture2D(uAtlas, cellUv(vCells.x, 0.0), bias).a;
        float lA = texture2D(uAtlas, cellUv(vCells.y, 2.0), bias).a;
        float a = mix(gA * 0.45, lA * 0.85, vR);
        // the blur (mip bias) bleeds neighbouring atlas cells and spreads ink to the quad's border: fade to zero within
        // the outer ~18% of the quad (radially, so no mark ever shows a straight cut or a corner)
        vec2 e = abs(vUv - 0.5) * 2.0;
        a *= (1.0 - smoothstep(0.64, 0.98, e.x)) * (1.0 - smoothstep(0.64, 0.98, e.y)) * (1.0 - smoothstep(0.82, 1.0, length(e) * 0.8));
        float fog = exp(-max(vDepth - 2.0, 0.0) * 0.11);
        a *= vFade * fog * uOpacity * smoothstep(2.0, 4.5, vDepth);
        if (a < 0.003) discard;
        vec3 col = mix(uColor, uLetterColor, vR);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  return {
    mesh,
    uniforms,
    setCenter(v) {
      (uniforms.uCenter.value as THREE_NS.Vector3).copy(v);
    },
    dispose() {
      alive = false;
      tex.dispose();
      geo.dispose();
      base.dispose();
      mat.dispose();
    },
  };
}
