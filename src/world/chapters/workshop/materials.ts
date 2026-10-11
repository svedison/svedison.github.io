// Workshop materials: procedural timber (3d-wood-material, ported from its demo unchanged where it matters),
// true-conductor metals (3d-metal-material), a dark studio PMREM of a few bright cards, and chamferBox.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const WOOD_NOISE = /* glsl */ `
  vec2 hash2w(vec2 p){
    p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453123)*2.0-1.0;
  }
  float hash1w(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
`;

/* One shared periodic anatomy field (1024², 64 cells, three octaves, mipmapped, NoColorSpace). */
let fieldTarget: THREE.WebGLRenderTarget | null = null;
let fieldRefs = 0;
export function acquireWoodField(renderer: THREE.WebGLRenderer): THREE.Texture {
  fieldRefs++;
  if (fieldTarget) return fieldTarget.texture;
  fieldTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  fieldTarget.texture.colorSpace = THREE.NoColorSpace;
  const bake = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader:
      WOOD_NOISE +
      /* glsl */ `
      varying vec2 vUv;
      float periodicNoise(vec2 x){
        vec2 p=floor(x),w=fract(x),u=w*w*w*(w*(w*6.0-15.0)+10.0);
        float a=dot(hash2w(mod(p,64.0)),w);
        float b=dot(hash2w(mod(p+vec2(1,0),64.0)),w-vec2(1,0));
        float c=dot(hash2w(mod(p+vec2(0,1),64.0)),w-vec2(0,1));
        float d=dot(hash2w(mod(p+vec2(1,1),64.0)),w-vec2(1,1));
        return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*0.70+0.5;
      }
      void main(){
        vec2 p=vUv*64.0;
        float n=periodicNoise(p);
        float f=n*0.60+periodicNoise(p*2.0+9.0)*0.27+periodicNoise(p*4.0+27.0)*0.13;
        gl_FragColor=vec4(n,f,periodicNoise(p+vec2(31.7,11.9)),1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bake);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(fieldTarget);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  bake.dispose();
  return fieldTarget.texture;
}
export function releaseWoodField() {
  fieldRefs = Math.max(0, fieldRefs - 1);
  if (!fieldRefs && fieldTarget) {
    fieldTarget.dispose();
    fieldTarget = null;
  }
}

const WOOD_GLSL = /* glsl */ `
  struct Wood { vec3 col; float rough; float h; };
  vec3 timberField(vec2 p){return texture2D(uWoodField,p/64.0).rgb;}
  float timberN(vec2 p){return timberField(p).r;}
  Wood woodSample(vec3 p){
    vec3 q=p*uGrainScale;
    vec2 cross2=(uAxis<0.5)?q.yz:(uAxis<1.5?q.xz:q.xy);
    float along=(uAxis<0.5)?q.x:(uAxis<1.5?q.y:q.z);
    vec3 grainAxis=(uAxis<0.5)?vec3(1,0,0):(uAxis<1.5?vec3(0,1,0):vec3(0,0,1));
    float endgrain=pow(abs(dot(normalize(vWoodNormal),grainAxis)),6.0);
    vec2 seed=vec2(uWoodSeed,uWoodSeed*0.637);
    float across=cross2.x+cross2.y*0.63;
    vec2 grainP=vec2(across,along);
    vec3 broad=timberField(grainP*vec2(0.92,0.22)+seed);
    vec3 curl=timberField(grainP*vec2(2.3,0.38)+seed+17.0);
    vec2 kg=grainP/vec2(1.85,4.6)+seed*0.19;
    vec2 ki=floor(kg),kr=hash2w(ki+seed);
    vec2 kp=(fract(kg)-0.5-kr*0.23)*vec2(1.85,4.6);
    float hasKnot=step(0.71,hash1w(ki+seed*2.7));
    float knotR=length(kp*vec2(1.0,0.30));
    vec2 edgeFade=smoothstep(vec2(0.0),vec2(0.15),fract(kg))*smoothstep(vec2(0.0),vec2(0.15),1.0-fract(kg));
    float knotFlow=hasKnot*exp(-knotR*knotR*21.0)*edgeFade.x*edgeFade.y;
    float knotCore=hasKnot*(1.0-smoothstep(0.026,0.080,knotR));
    float pithDrift=(broad.r-0.5)*0.72+(curl.r-0.5)*0.19;
    vec2 radial=cross2+vec2(-pithDrift,uOffAxis+0.48);
    radial.x+=knotFlow*kp.x*0.85;
    float radius=length(radial*vec2(1.0,0.56));
    float growth=radius*uRingFreq*uFine;
    growth+=(timberN(vec2(growth*0.31,uWoodSeed+4.2))-0.5)*2.5;
    growth+=(curl.g-0.5)*0.80+knotFlow*0.60;
    float ring=floor(growth),phase=fract(growth);
    float annual=timberN(vec2(ring*0.73,uWoodSeed+25.0));
    float lateWidth=0.065+annual*0.21;
    float late=smoothstep(0.94-lateWidth,0.97-lateWidth,phase)*(1.0-smoothstep(0.965,1.0,phase));
    float ringPx=fwidth(growth);
    late=mix(late,lateWidth*0.65,smoothstep(0.16,0.72,ringPx));
    float early=pow(clamp(phase,0.0,1.0),1.6);
    early=mix(early,0.38,smoothstep(0.18,0.72,ringPx));
    float fiberX=across+pithDrift*0.25+knotFlow*kp.x*0.38;
    vec2 vesselP=mix(vec2(fiberX*96.0,along*7.5),cross2*88.0,endgrain)*uPoreF;
    vec3 vessels=timberField(vesselP+seed);
    float vesselPx=max(length(dFdx(vesselP)),length(dFdy(vesselP)));
    float pores=smoothstep(0.59,0.75,vessels.r)*smoothstep(0.40,0.65,vessels.b);
    pores*=1.0-smoothstep(0.22,0.90,vesselPx);
    vec2 fibreP=vec2(fiberX*230.0*uPoreF,along*2.4)+seed;
    float fibres=(timberN(fibreP)-0.5)*(1.0-endgrain*0.75);
    float fibrePx=max(length(dFdx(fibreP)),length(dFdy(fibreP)));
    fibres*=1.0-smoothstep(0.18,0.85,fibrePx);
    vec2 rayP=vec2(across*13.0,along*115.0)+seed+31.0;
    vec3 rayField=timberField(rayP);
    float rays=smoothstep(0.64,0.78,rayField.r)*smoothstep(0.42,0.66,rayField.b)*uRays;
    float rayPx=max(length(dFdx(rayP)),length(dFdy(rayP)));
    rays*=1.0-smoothstep(0.15,0.65,rayPx);
    float checks=smoothstep(0.70,0.82,curl.b)*uChecks;
    checks*=smoothstep(0.46,0.66,vessels.b)*(1.0-endgrain*0.5);
    checks*=1.0-smoothstep(0.16,0.65,vesselPx);
    float tone=0.075+late*0.40+early*0.070+pores*0.25-fibres*0.16+(broad.g-0.5)*0.23+knotCore*0.44+knotFlow*0.075;
    Wood w;
    w.col=mix(uPale,uDark,clamp(tone,0.035,0.83));
    w.col*=0.93+annual*0.095+(curl.b-0.5)*0.045;
    w.col=mix(w.col,uDark*0.68,checks*0.33);
    w.col=mix(w.col,uPale*1.035,rays*0.26);
    w.col*=1.0-endgrain*(0.045+pores*0.10);
    w.rough=0.91+late*0.13+pores*0.19+(broad.b-0.5)*0.20-rays*0.075+knotCore*0.10+endgrain*0.14;
    float ringRelief=1.0-smoothstep(0.07,0.24,ringPx);
    float poreRelief=1.0-smoothstep(0.05,0.18,vesselPx);
    float tool=(timberN(vec2(along*17.0,across*0.4)+seed)-0.5)*uTool;
    w.h=late*0.20*ringRelief-pores*0.42*poreRelief+fibres*0.09+rays*0.06+tool*0.045-checks*0.20;
    return w;
  }
  vec3 bumpNormal(vec3 posVS,vec3 nrm,float h,float scale){
    vec3 sx=dFdx(posVS),sy=dFdy(posVS);
    vec3 R1=cross(sy,nrm),R2=cross(nrm,sx);
    float det=dot(sx,R1);
    vec2 dH=vec2(dFdx(h),dFdy(h))*scale;
    vec3 grad=sign(det)*(dH.x*R1+dH.y*R2);
    float lim=abs(det)*0.38;
    grad*=min(1.0,lim/max(length(grad),1e-20));
    return normalize(abs(det)*nrm-grad);
  }
`;

export interface WoodOpts {
  pale: number;
  dark: number;
  rough?: number;
  grain?: number;
  /** 0 = x, 1 = y, 2 = z: the log axis in the mesh's object space. */
  axis?: 0 | 1 | 2;
  ringFreq?: number;
  /** Ring-frequency multiplier for small pieces (rings scale with the tree, not the object): ~3 under 0.3 m. */
  fine?: number;
  offAxis?: number;
  bump?: number;
  rays?: number;
  checks?: number;
  tool?: number;
  seed: number;
  oil?: boolean;
  clearcoat?: number;
  envMapIntensity?: number;
}

/** Species from the 3d-wood-material table (rings retuned for this scale). */
export const SPECIES = {
  walnut: { pale: 0x6c482c, dark: 0x2f1c0e, rough: 0.6, grain: 1.6, ringFreq: 30, offAxis: 0.35, bump: 0.1, rays: 0.25, checks: 0.04, tool: 0.1 },
  keyaki: { pale: 0x8a5f38, dark: 0x3d2412, rough: 0.62, grain: 1.5, ringFreq: 24, offAxis: 0.75, bump: 0.1, rays: 0.3, checks: 0.02, tool: 0.12 },
  hinoki: { pale: 0xd8c096, dark: 0x8a6b40, rough: 0.5, grain: 2.2, ringFreq: 42, offAxis: 1.6, bump: 0.04, rays: 0.15, checks: 0, tool: 0.2 },
  sugi: { pale: 0xc8a579, dark: 0x9b774d, rough: 0.58, grain: 1.8, ringFreq: 30, offAxis: 2.8, bump: 0.06, rays: 0.15, checks: 0.02, tool: 0.3 },
  kuri: { pale: 0x6f4d2c, dark: 0x2c1a0b, rough: 0.55, grain: 3.0, ringFreq: 22, offAxis: 1.4, bump: 0.08, rays: 0.3, checks: 0.1, tool: 0.15 },
} as const;

export function woodMat(field: THREE.Texture, env: THREE.Texture, o: WoodOpts): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: Math.max(0.43, o.rough ?? 0.6),
    metalness: 0,
    clearcoat: o.clearcoat ?? (o.oil === false ? 0 : 0.1),
    clearcoatRoughness: 0.55,
    ior: 1.43,
    specularIntensity: 0.72,
  });
  m.envMap = env;
  m.envMapIntensity = o.envMapIntensity ?? 0.4;
  const U = {
    uPale: { value: new THREE.Color(o.pale) },
    uDark: { value: new THREE.Color(o.dark) },
    uGrainScale: { value: o.grain ?? 1.5 },
    uAxis: { value: o.axis ?? 0 },
    uRingFreq: { value: o.ringFreq ?? 24 },
    uFine: { value: o.fine ?? 1 },
    // pores and fibres get a little finer too (not 1:1: they already fade by their own pixel footprint)
    uPoreF: { value: Math.sqrt(o.fine ?? 1) * 0.85 + 0.15 },
    uOffAxis: { value: o.offAxis ?? 0.8 },
    uBump: { value: (o.bump ?? 0.1) * 0.02 },
    uRays: { value: o.rays ?? 0.3 },
    uChecks: { value: o.checks ?? 0.04 },
    uTool: { value: o.tool ?? 0.1 },
    uWoodSeed: { value: o.seed * 7.113 },
    uWoodField: { value: field },
  };
  const oil = o.oil !== false;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vWoodNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vOP=position; vWoodNormal=normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vOP, vWoodNormal;
         uniform vec3 uPale, uDark;
         uniform float uGrainScale, uAxis, uRingFreq, uFine, uPoreF, uOffAxis, uBump, uRays, uChecks, uTool, uWoodSeed;
         uniform sampler2D uWoodField;
         ${WOOD_NOISE}
         ${WOOD_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `Wood W=woodSample(vOP);
         diffuseColor.rgb*=W.col;
         ${oil ? 'diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.16)); W.rough *= 0.88;' : ''}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=clamp(roughness*W.rough,0.35,1.0);')
      .replace('#include <normal_fragment_maps>', 'normal = bumpNormal(-vViewPosition, normal, W.h, uBump);');
  };
  m.customProgramCacheKey = () => (oil ? 'ws-wood-oil' : 'ws-wood-raw');
  return m;
}

/* -------------------------------------------------------------------------------------------- metal */

export const F0 = {
  gold: [1.0, 0.71, 0.29],
  brass: [0.89, 0.72, 0.36],
  steel: [0.56, 0.57, 0.58],
  iron: [0.42, 0.41, 0.4],
} as const;

/** True conductor: metalness 1, F0 in colour, layered roughness variation faded by footprint. */
export function metalMat(
  env: THREE.Texture,
  f0: readonly [number, number, number],
  o: { rough?: number; env?: number; smear?: number; scratch?: number; tarnish?: number; tarnishCol?: [number, number, number]; scale?: number } = {},
): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: o.rough ?? 0.2 });
  m.color.setRGB(f0[0], f0[1], f0[2], THREE.LinearSRGBColorSpace);
  m.envMap = env;
  m.envMapIntensity = o.env ?? 1.0;
  const U = {
    uSmear: { value: o.smear ?? 0.1 },
    uScratch: { value: o.scratch ?? 0.2 },
    uTarnish: { value: o.tarnish ?? 0 },
    uTarnishCol: { value: new THREE.Color().setRGB(...(o.tarnishCol ?? [0.09, 0.055, 0.02]), THREE.LinearSRGBColorSpace) },
    uMScale: { value: o.scale ?? 1 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMP;\nvarying vec3 vMN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vMP=position; vMN=normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vMP, vMN;
         uniform float uSmear, uScratch, uTarnish, uMScale;
         uniform vec3 uTarnishCol;
         float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
         float mn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
           return mix(mix(mh(i),mh(i+vec2(1,0)),f.x),mix(mh(i+vec2(0,1)),mh(i+vec2(1,1)),f.x),f.y); }
         float mfb(vec2 p){ return mn(p)*0.55+mn(p*2.1+7.0)*0.3+mn(p*4.3+3.0)*0.15; }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `vec3 q = vMP * 40.0 * uMScale;
         vec2 tp = q.xy + q.zz * 0.71;
         float smear = smoothstep(0.45, 0.8, mfb(tp * 0.18 + 3.1));
         vec2 sp = vec2(tp.x * 0.7 + tp.y * 0.7, tp.y * 0.05 - tp.x * 0.05) * 9.0;
         float fw = max(length(dFdx(sp)), length(dFdy(sp)));
         float scr = smoothstep(0.86, 0.97, mn(vec2(sp.x * 0.15, sp.y * 40.0))) * (1.0 - smoothstep(0.2, 0.9, fw));
         float grainV = (mn(tp * 6.0) - 0.5) * (1.0 - smoothstep(0.2, 0.8, fw * 0.5));
         float edgeK = 1.0 - max(abs(normalize(vMN).x), max(abs(normalize(vMN).y), abs(normalize(vMN).z)));
         float pat = uTarnish * smoothstep(0.42, 0.75, mfb(tp * 0.35 + 9.0)) * (1.0 - smoothstep(0.05, 0.25, edgeK));
         float roughnessFactor = clamp(roughness + smear * uSmear + scr * uScratch + grainV * 0.05 + pat * 0.42, 0.04, 1.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, uTarnishCol, pat);`,
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, 0.28, pat);');
  };
  m.customProgramCacheKey = () => 'ws-metal';
  return m;
}

/* ------------------------------------------------------------------------------------ environment */

/** Dark studio of bright cards, placed where the scene's own lights are: warm lamp upper-left front,
 *  cool rainy window behind, a faint warm floor bounce. Returns the PMREM texture. */
export function buildStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0.03, 0.028, 0.03);
  const disposables: { dispose(): void }[] = [];
  const card = (w: number, h: number, p: [number, number, number], rad: [number, number, number], parent: THREE.Object3D = studio) => {
    const g = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...rad), side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(...p);
    if (parent === studio) mesh.lookAt(0, 0, 0);
    parent.add(mesh);
    disposables.push(g, mat);
    return mesh;
  };
  // the warm lamp: a softbox up and to the left, in front (where the key comes from)
  card(2.4, 1.6, [-4.2, 4.6, 3.6], [4.2, 3.0, 1.7]);
  // the window: a pane group behind, cool, with bars (gaps wide enough to survive PMREM blur)
  const win = new THREE.Group();
  win.position.set(1.0, 2.4, -5.0);
  win.lookAt(0, 0, 0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) card(1.2, 1.3, [(c - 1.5) * 1.42, (r - 0.5) * 1.52, 0], [0.42, 0.55, 0.78], win);
  studio.add(win);
  card(3.0, 5.0, [6.0, 1.6, 2.0], [0.32, 0.42, 0.6]);
  card(7.5, 2.2, [0, 6.0, 0], [0.2, 0.19, 0.18]);
  card(9.0, 9.0, [0, -4.0, 0], [0.16, 0.1, 0.06]);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(studio, 0.012, 0.1, 40).texture;
  pm.dispose();
  disposables.forEach((d) => d.dispose());
  return tex;
}

/* ------------------------------------------------------------------------------------- geometry */

/** Box with genuinely rounded arrises (3d-wood-material rule 9). */
export function chamferBox(w: number, h: number, d: number, c?: number): THREE.BufferGeometry {
  const r = Math.max(0.0001, Math.min(c ?? Math.min(w, h, d) * 0.055, w * 0.24, h * 0.24, d * 0.24));
  const segments = r < 0.004 ? 2 : 3;
  const g = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const normal = g.attributes.normal as THREE.BufferAttribute;
  const halfCell = 0.5 / segments;
  const cx = w / 2 - r,
    cy = h / 2 - r,
    cz = d / 2 - r;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    n.set(x - Math.sign(x) * halfCell, y - Math.sign(y) * halfCell, z - Math.sign(z) * halfCell).normalize();
    pos.setXYZ(i, Math.sign(x) * cx + n.x * r, Math.sign(y) * cy + n.y * r, Math.sign(z) * cz + n.z * r);
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Radial contact pool texture shared by every object (alpha 0.78 at the core, smooth falloff). */
let contactTex: THREE.Texture | null = null;
export function contactTexture(): THREE.Texture {
  if (contactTex) return contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.82)');
  gr.addColorStop(0.3, 'rgba(0,0,0,0.6)');
  gr.addColorStop(0.65, 'rgba(0,0,0,0.18)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  contactTex = new THREE.CanvasTexture(c);
  return contactTex;
}
export function disposeContactTexture() {
  contactTex?.dispose();
  contactTex = null;
}

/**
 * Merge every static mesh under `root` that shares a material (and shadow flags) into one draw call.
 * Nodes in `skip` (and everything under them) are left alone: anything that animates, instanced meshes,
 * sprites. Geometry is baked into `root`'s space; procedural wood samples object space, so grain stays put.
 */
export function mergeStatic(root: THREE.Object3D, skip: Set<THREE.Object3D> = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && o !== root) {
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, geos: [], meshes: [] }));
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.morphAttributes = {};
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      b.geos.push(g);
      b.meshes.push(m);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) {
      b.geos.forEach((g) => g.dispose());
      continue;
    }
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of b.meshes) m.parent?.remove(m); // geometries may be shared with skipped meshes: left to GC
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast;
    mm.receiveShadow = b.recv;
    mm.renderOrder = b.order;
    root.add(mm);
  }
}
