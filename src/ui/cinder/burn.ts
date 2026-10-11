// The paper-cinder burn for one sheet of paper (paper-cinder-transition, ported).
//
// One composite pass decides, per pixel, whether it is the FROZEN sheet (ahead of the line), the burning
// zone (the line), or the LIVE page behind it. Here the "live scene" is whatever is under the canvas: the
// composite writes alpha 0 where the paper has burnt, so the real rain world and page show through, live.
//
// Differences from the skill's demo, all staging:
// - the frame is rotated a quarter turn so the line climbs the sheet from its bottom edge (fire rises),
//   which means "screen height" in the skill's maths is the sheet's width here;
// - the composite writes two targets: the paper/char (premultiplied, linear) and the fire's own light, so
//   the sheet keeps its exact colours at rest (no tone curve on paper) and the fire is graded alone;
// - no vignette or grain (it's a card on a page, not a full-screen scene).
// Everything else (EDGE GLSL, baked noise, pixel-true distance, finite-difference slope, ember ramp, char,
// pores, crust, scorch, bloom threshold and weights, the front's timing) is the skill's.
import { EDGE, NOISE } from './glsl-kibori';

export const K = {
  HALF: 0.215,
  FRONT_A: -0.26,
  FRONT_B: 1.62,
  DPR_CAP: 2,
  DT_MAX: 1 / 30,
  SEED_STEP: 17.3,
};

const VS =
  '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
const HEAD = '#version 300 es\nprecision highp float;precision highp sampler2D;\n#define texture2D texture\n';
const OUT1 = 'out vec4 fragColor;\n';

const COMP_FS =
  HEAD +
  'layout(location=0) out vec4 oBase;\nlayout(location=1) out vec4 oFire;\n' +
  NOISE +
  '#define KB_BAKED\n' +
  EDGE +
  `
in vec2 vUv;
uniform sampler2D uFrom;
uniform float uAspect, uTime, uSeed, uFront, uPxH, uPxS;
uniform vec2 uRes;
/* the frozen sheet: straight-alpha sRGB in, premultiplied linear out */
vec4 fromAt(vec2 uv){ vec4 c = texture(uFrom, uv); return vec4(pow(c.rgb, vec3(2.2))*c.a, c.a); }
void main(){
  vec4 F0 = fromAt(vUv);
  oFire = vec4(0.0);
  const float HALF = ${K.HALF};
  if (uFront < -0.55){ oBase = F0; return; }
  if (uFront >  1.55){ oBase = vec4(0.0); return; }
  /* a quarter turn: the skill's x runs up the sheet, its "height" is the sheet's width */
  vec2 vr = vec2(vUv.y, vUv.x);
  vec2 p = (vr - vec2(0.5))*vec2(uAspect, 1.0);
  float hx = vr.x;
  if (hx - uFront > HALF + 0.15){ oBase = F0; return; }
  if (uFront - hx > 0.25 - HALF){ oBase = vec4(0.0); return; }
  float pxR = uPxH;
  vec2 sv = fract(vec2(0.6180, 0.7549)*uSeed + vec2(0.13, 0.41));
  vec2 qs = vec2(0.9, mix(2.0, 3.6, sv.x)), q = p*qs;
  /* broad shape, and its slope from the same a few px off (never dFdx of the baked texture) */
  vec2 dq = qs*4.0*uPxS/uPxH;
  float fS0 = (kbFbmT(q*1.10 + uSeed) - 0.50)*mix(0.055, 0.115, sv.y)
            + (kbFbmT(mat2(0.96, 0.28, -0.28, 0.96)*q*2.60 + uSeed*3.1 + 21.0) - 0.50)*mix(0.050, 0.030, sv.y);
  float fSx = (kbFbmT((q + vec2(dq.x, 0.0))*1.10 + uSeed) - 0.50)*mix(0.055, 0.115, sv.y)
            + (kbFbmT(mat2(0.96, 0.28, -0.28, 0.96)*(q + vec2(dq.x, 0.0))*2.60 + uSeed*3.1 + 21.0) - 0.50)*mix(0.050, 0.030, sv.y);
  float fSy = (kbFbmT((q + vec2(0.0, dq.y))*1.10 + uSeed) - 0.50)*mix(0.055, 0.115, sv.y)
            + (kbFbmT(mat2(0.96, 0.28, -0.28, 0.96)*(q + vec2(0.0, dq.y))*2.60 + uSeed*3.1 + 21.0) - 0.50)*mix(0.050, 0.030, sv.y);
  float hStep = 4.0*uPxS/uPxH;
  float gradL = length(vec2(1.0/uAspect + (fSx - fS0)/hStep, (sv.x - 0.5)*0.07 + (fSy - fS0)/hStep));
  float fieldS = hx + fS0 + p.y*(sv.x - 0.5)*0.07;
  float grad = clamp(gradL, 0.35/uAspect, 3.0/uAspect);
  float T = uFront + HALF;
  float xB = (fieldS - T)/grad*pxR/uPxS, slack = 0.026/grad*pxR/uPxS;
  float xBpx = (fieldS - T)*uAspect*pxR/uPxS;
  if (xB - slack > 62.0){ oBase = F0; return; }
  if (xB < -125.0 && xBpx < -125.0){ oBase = vec4(0.0); return; }
  float crys = kbRidT(mat2(0.87, 0.49, -0.49, 0.87)*q*6.40 + uSeed*7.7 + 5.0);
  float lace = kbRid2T(mat2(0.62, -0.78, 0.78, 0.62)*q*15.00 + uSeed*2.3 + 13.0);
  float field = fieldS + (crys - 0.62)*0.014 + (lace - 0.62)*0.006 + (kbRid2T(mat2(0.39, 0.92, -0.92, 0.39)*q*34.0 + uSeed + 3.0) - 0.62)*0.0025;
  field += (kbGnT(vec2(q.x*4.0 + uSeed, q.y*6.0 - uTime*1.1)) - 0.5)*0.022
         + (kbGnT(vec2(q.x*11.0 + 3.0, q.y*16.0 - uTime*2.8) + uSeed) - 0.5)*0.010;
  float s = field - T;
  float d = s/grad;
  float cpx = pxR/uPxS, aaC = 1.0/uPxS, xc = d*cpx;
  vec2 g = p*cpx;
  float reveal = clamp(0.5 - xc/aaC, 0.0, 1.0);
  /* about a pixel of heat shimmer at the flame */
  vec2 ruv = vUv;
  float heat = exp(-abs(xc)/18.0);
  vec4 F = F0;
  if (heat > 0.03){
    vec2 fl = vec2(g.x*0.070 + uSeed, g.y*0.055 - uTime*2.2);
    ruv = clamp(vUv + (vec2(kbGnT(fl), kbGnT(fl + 7.3)) - 0.5)*heat*(1.8/uRes), vec2(0.001), vec2(0.999));
    F = fromAt(ruv);
  }
  float aP = F.a;   /* the fire only exists where there was paper */
  vec2 e = vec2(uSeed*0.37 + 3.0, p.y*1.9 + uSeed);
  vec4 wh = kbEdgeWHTb(e, uTime);
  vec2 gp = g + uSeed*vec2(31.0, 17.0);
  /* scorch ahead of the flame: one continuous darkening, reach varied by noise */
  float tw = 20.0 + 20.0*kbV(vec2(gp.y*0.034, 5.0));
  float sgr = kbV(mat2(0.94, 0.34, -0.34, 0.94)*gp*vec2(0.16, 0.36) + 5.0)*0.5 + kbV(mat2(0.80, -0.60, 0.60, 0.80)*gp*0.45)*0.5;
  float brk = kbV(gp*0.06 + 8.0)*0.6 + kbV(mat2(0.28, 0.96, -0.96, 0.28)*gp*0.19 + 1.0)*0.4;
  float tk = clamp(1.0 - xc/(tw*(0.65 + 0.70*brk)), 0.0, 1.0);
  float scA = tk*tk*(0.70 + 0.30*sgr);
  F.rgb = mix(F.rgb, F.rgb*mix(vec3(0.80, 0.62, 0.42), vec3(0.20, 0.10, 0.045), tk), step(0.0, xc)*scA);
  /* behind the front: the live page (transparent) */
  F *= 1.0 - reveal;
  /* the char: a torn, porous band, alpha-masked, crumbling off down to whatever lies beneath */
  float bed = kbBed(xc, xBpx, 12.0, kbEdgeNLine(gp.y), kbZoneW(wh), 26.0, aaC, gp);
  float po = kbPores(gp, clamp((-xc - 1.05*kbZoneW(wh))/40.0, 0.0, 1.0), uTime, aaC);
  F = mix(F, vec4(kbCharCol(gp, 1.0), 1.0), bed*po*aP);
  vec4 crust = kbCrust(xc, gp.y, wh, gp, aaC);
  F = mix(F, vec4(crust.rgb, 1.0), crust.a*aP);
  oBase = F;
  oFire = vec4((kbFlame(xc, xBpx, gp.y, wh, gp, uTime, aaC) + kbCharGlow(xc, gp, wh, aaC, uTime, 0.0))*aP, 1.0);
}`;

const BAKE_HASH =
  HEAD +
  OUT1 +
  NOISE +
  EDGE +
  `
in vec2 vUv;
void main(){ fragColor = vec4(kbHash(floor(vUv*2048.0) - 1024.0), 0.0, 0.0, 1.0); }`;

const BAKE_NOISE =
  HEAD +
  OUT1 +
  NOISE +
  `
in vec2 vUv;
float gnP(vec2 x, float per, vec2 off){
  vec2 i = floor(x), w = fract(x), u = w*w*w*(w*(w*6.0 - 15.0) + 10.0);
  vec2 i0 = mod(i, per) + off, i1 = mod(i + 1.0, per) + off;
  float a = dot(hash2(i0), w), b = dot(hash2(vec2(i1.x, i0.y)), w - vec2(1.0, 0.0));
  float c = dot(hash2(vec2(i0.x, i1.y)), w - vec2(0.0, 1.0)), d = dot(hash2(i1), w - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)*0.7 + 0.5;
}
float fbmP(vec2 x, float per, vec2 off){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 3; i++){ s += a*gnP(x, per, off + float(i)*17.0); n += a; x *= 2.0; per *= 2.0; a *= 0.5; }
  return s/n;
}
float ridP(vec2 x, float per, vec2 off, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 3; i++){ if (i >= oct) break; s += a*(1.0 - abs(gnP(x, per, off + float(i)*23.0)*2.0 - 1.0)); n += a; x *= 2.0; per *= 2.0; a *= 0.5; }
  return s/n;
}
void main(){
  vec2 x = vUv*16.0;
  fragColor = vec4(fbmP(x, 16.0, vec2(0.0)), ridP(x, 16.0, vec2(301.0, 17.0), 3), gnP(x, 16.0, vec2(57.0, 211.0)), ridP(x, 16.0, vec2(113.0, 419.0), 2));
}`;

const BRIGHT_FS =
  HEAD +
  OUT1 +
  `in vec2 vUv; uniform sampler2D uTex; uniform float uThresh;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = max(0.0, l - uThresh)/max(l, 1e-4);
  fragColor = vec4(c*k*k*0.25, 1.0);
}`;
const BLUR_FS =
  HEAD +
  OUT1 +
  `in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec3 s = texture(uTex, vUv).rgb*0.2270270;
  s += (texture(uTex, vUv + uDir*1.3846153).rgb + texture(uTex, vUv - uDir*1.3846153).rgb)*0.3162162;
  s += (texture(uTex, vUv + uDir*3.2307692).rgb + texture(uTex, vUv - uDir*3.2307692).rgb)*0.0702702;
  fragColor = vec4(s, 1.0);
}`;
const DOWN_FS = HEAD + OUT1 + `in vec2 vUv; uniform sampler2D uTex; void main(){ fragColor = vec4(texture(uTex, vUv).rgb, 1.0); }`;
/* final: the sheet in its own colours (premultiplied sRGB, exact at rest), the fire graded alone through a
   soft shoulder (hot stays gold, never cream) and laid over it as light */
const FINAL_FS =
  HEAD +
  OUT1 +
  `in vec2 vUv;
uniform sampler2D uBase, uFire, uB1, uB2; uniform float uBloom, uFade;
vec3 lin2srgb(vec3 c){ return mix(c*12.92, 1.055*pow(max(c, vec3(1e-5)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
vec3 shoulder(vec3 x){ const float k = 0.86; return mix(x, k + (1.0 - k)*(1.0 - exp(-(x - k)/(1.0 - k))), step(k, x)); }
void main(){
  vec4 b = texture(uBase, vUv);
  vec3 E = texture(uFire, vUv).rgb
         + texture(uB1, vUv).rgb*0.26*4.0*uBloom
         + texture(uB2, vUv).rgb*0.34*4.0*uBloom;
  vec3 base = b.a > 1e-4 ? lin2srgb(clamp(b.rgb/b.a, 0.0, 1.0))*b.a : vec3(0.0);
  vec3 fire = lin2srgb(shoulder(max(E, 0.0)));
  float em = max(max(fire.r, fire.g), fire.b);
  vec3 rgb = min(base + fire, vec3(1.0));
  float a = b.a + (1.0 - b.a)*clamp(em, 0.0, 1.0)*0.25;
  /* reduced-motion / dissolve path reuses this pass: fade the whole sheet */
  fragColor = vec4(rgb, a)*(1.0 - uFade);
}`;

type RT = { w: number; h: number; tex: WebGLTexture; fb: WebGLFramebuffer; kind: 'h' | 'r' | 'b'; wrap: boolean; tex2?: WebGLTexture };
type Prog = { p: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> };
type U = number | [number, number] | RT | WebGLTexture;

export interface Burner {
  canvas: HTMLCanvasElement;
  /** Bakes noise + compiles (once). Throws if WebGL2/half-float targets are unavailable. */
  ready(): void;
  /** Size the canvas (CSS px) and upload the frozen sheet (a canvas of exactly that size x dpr). */
  setSheet(sheet: HTMLCanvasElement, cssW: number, cssH: number, dpr: number): void;
  /** Draw one frame. front: the line (K.FRONT_A..K.FRONT_A+K.FRONT_B). */
  draw(front: number, time: number, seed: number): void;
  /** Wipe the uploaded sheet (it may hold the visitor's words). */
  clear(): void;
  dispose(): void;
}

export function createBurner(): Burner {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('webgl2 unavailable');
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float'))
    throw new Error('no half-float render targets');
  gl.getExtension('OES_texture_float_linear');

  const vao = gl.createVertexArray();
  const progs: Record<string, Prog> = {};
  let noiseRT: RT | null = null;
  let hashRT: RT | null = null;
  let comp: RT | null = null; // MRT: tex = base, tex2 = fire
  let g1: RT | null = null, g2: RT | null = null, g3: RT | null = null, g4: RT | null = null;
  let sheetTex: WebGLTexture | null = null;

  function compile(fs: string): Prog {
    const mk = (t: number, s: string) => {
      const sh = gl!.createShader(t)!;
      gl!.shaderSource(sh, s);
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(sh) || 'shader');
      return sh;
    };
    const p = gl!.createProgram()!;
    gl!.attachShader(p, mk(gl!.VERTEX_SHADER, VS));
    gl!.attachShader(p, mk(gl!.FRAGMENT_SHADER, fs));
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) || 'link');
    return { p, loc: {} };
  }

  function texStorage(tex: WebGLTexture, kind: RT['kind'], w: number, h: number, wrap: boolean) {
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    if (kind === 'h') gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, w, h, 0, gl!.RGBA, gl!.HALF_FLOAT, null);
    else if (kind === 'r') gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.R16F, w, h, 0, gl!.RED, gl!.HALF_FLOAT, null);
    else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    const wr = wrap ? gl!.REPEAT : gl!.CLAMP_TO_EDGE;
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, wr);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, wr);
  }

  function makeRT(w: number, h: number, kind: RT['kind'], wrap = false, mrt = false): RT {
    const rt: RT = { w: 0, h: 0, kind, wrap, tex: gl!.createTexture()!, fb: gl!.createFramebuffer()! };
    if (mrt) rt.tex2 = gl!.createTexture()!;
    sizeRT(rt, w, h);
    return rt;
  }
  function sizeRT(rt: RT, w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (rt.w === w && rt.h === h) return;
    rt.w = w;
    rt.h = h;
    texStorage(rt.tex, rt.kind, w, h, rt.wrap);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, rt.fb);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, rt.tex, 0);
    if (rt.tex2) {
      texStorage(rt.tex2, rt.kind, w, h, rt.wrap);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT1, gl!.TEXTURE_2D, rt.tex2, 0);
      gl!.drawBuffers([gl!.COLOR_ATTACHMENT0, gl!.COLOR_ATTACHMENT1]);
    }
    if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  }

  function pass(P: Prog, u: Record<string, U>, rt: RT | null) {
    gl!.useProgram(P.p);
    let unit = 0;
    for (const k in u) {
      let l = P.loc[k];
      if (l === undefined) l = P.loc[k] = gl!.getUniformLocation(P.p, k);
      if (l === null) continue;
      const v = u[k];
      if (typeof v === 'number') gl!.uniform1f(l, v);
      else if (Array.isArray(v)) gl!.uniform2f(l, v[0], v[1]);
      else if (v instanceof WebGLTexture) {
        gl!.activeTexture(gl!.TEXTURE0 + unit);
        gl!.bindTexture(gl!.TEXTURE_2D, v);
        gl!.uniform1i(l, unit++);
      } else {
        gl!.activeTexture(gl!.TEXTURE0 + unit);
        gl!.bindTexture(gl!.TEXTURE_2D, v.tex);
        gl!.uniform1i(l, unit++);
      }
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, rt ? rt.fb : null);
    gl!.viewport(0, 0, rt ? rt.w : canvas.width, rt ? rt.h : canvas.height);
    gl!.bindVertexArray(vao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  let isReady = false;
  function ready() {
    if (isReady) return;
    progs.comp = compile(COMP_FS);
    progs.hash = compile(BAKE_HASH);
    progs.noise = compile(BAKE_NOISE);
    progs.bright = compile(BRIGHT_FS);
    progs.blur = compile(BLUR_FS);
    progs.down = compile(DOWN_FS);
    progs.final = compile(FINAL_FS);
    // baked once: fbm/ridged/gradient in one tileable 1024^2 texture, kbHash's lattice in a 2048^2 table
    noiseRT = makeRT(1024, 1024, 'h', true);
    hashRT = makeRT(2048, 2048, 'r', true);
    pass(progs.noise, {}, noiseRT);
    pass(progs.hash, {}, hashRT);
    sheetTex = gl!.createTexture();
    isReady = true;
  }

  function setSheet(sheet: HTMLCanvasElement, cssW: number, cssH: number, dpr: number) {
    ready();
    const pw = Math.max(2, Math.round(cssW * dpr)), ph = Math.max(2, Math.round(cssH * dpr));
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const go = (rt: RT | null, w: number, h: number, k: RT['kind'], mrt = false) => {
      if (rt) {
        sizeRT(rt, w, h);
        return rt;
      }
      return makeRT(w, h, k, false, mrt);
    };
    comp = go(comp, pw, ph, 'h', true);
    g1 = go(g1, pw >> 1, ph >> 1, 'b');
    g2 = go(g2, pw >> 1, ph >> 1, 'b');
    g3 = go(g3, pw >> 2, ph >> 2, 'b');
    g4 = go(g4, pw >> 2, ph >> 2, 'b');
    gl!.bindTexture(gl!.TEXTURE_2D, sheetTex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, sheet);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  }

  function draw(front: number, time: number, seed: number) {
    if (!comp || !sheetTex) return;
    const cssW = parseFloat(canvas.style.width) || canvas.width;
    const cssH = parseFloat(canvas.style.height) || canvas.height;
    const dpr = canvas.width / cssW;
    pass(
      progs.comp,
      {
        uFrom: sheetTex,
        uKbN: noiseRT!,
        uKbH: hashRT!,
        uAspect: cssH / cssW,
        uTime: time,
        uSeed: seed,
        uFront: front,
        uPxH: canvas.width,
        uPxS: dpr,
        uRes: [canvas.width, canvas.height],
      },
      comp,
    );
    // bloom: the page's own bright pass, half-res and quarter-res blurs (on the fire only)
    const fireTex = comp.tex2!;
    pass(progs.bright, { uTex: fireTex, uThresh: 1.15 }, g1);
    pass(progs.blur, { uTex: g1!, uDir: [1 / g1!.w, 0] }, g2);
    pass(progs.blur, { uTex: g2!, uDir: [0, 1 / g1!.h] }, g1);
    pass(progs.down, { uTex: g1! }, g3);
    pass(progs.blur, { uTex: g3!, uDir: [2.1 / g3!.w, 0] }, g4);
    pass(progs.blur, { uTex: g4!, uDir: [0, 2.1 / g3!.h] }, g3);
    gl!.disable(gl!.BLEND);
    pass(progs.final, { uBase: comp.tex, uFire: fireTex, uB1: g1!, uB2: g3!, uBloom: 1, uFade: 0 }, null);
  }

  function clear() {
    if (!sheetTex) return;
    gl!.bindTexture(gl!.TEXTURE_2D, sheetTex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, new Uint8Array(4));
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
  }

  function dispose() {
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return { canvas, ready, setSheet, draw, clear, dispose };
}
