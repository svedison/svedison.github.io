// GLSL ported VERBATIM from the paper-cinder-transition skill (demo.html, itself KIBORI's own GLSL).
// Do not edit these two blocks by hand: they are the skill's look. Regenerate from the skill if needed.
/* eslint-disable */
export const NOISE = String.raw`  vec2 hash2(vec2 p){
    p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453123)*2.0-1.0;
  }
  vec3 hash3(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123)*2.0-1.0;
  }
  float hash1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
  float gnoise(vec2 x){
    vec2 p = floor(x), w = fract(x);
    vec2 u = w*w*w*(w*(w*6.0-15.0)+10.0);
    float a = dot(hash2(p+vec2(0,0)), w-vec2(0,0));
    float b = dot(hash2(p+vec2(1,0)), w-vec2(1,0));
    float c = dot(hash2(p+vec2(0,1)), w-vec2(0,1));
    float d = dot(hash2(p+vec2(1,1)), w-vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y)*0.7+0.5;
  }
  float gnoise3(vec3 x){
    vec3 p = floor(x), w = fract(x);
    vec3 u = w*w*w*(w*(w*6.0-15.0)+10.0);
    float n = 0.0;
    for(int k=0;k<2;k++)for(int j=0;j<2;j++)for(int i=0;i<2;i++){
      vec3 o = vec3(float(i),float(j),float(k));
      float wgt = mix(1.0-u.x,u.x,o.x)*mix(1.0-u.y,u.y,o.y)*mix(1.0-u.z,u.z,o.z);
      n += wgt * dot(hash3(p+o), w-o);
    }
    return n*0.8+0.5;
  }
  float fbm(vec2 p, int oct){
    float s=0.0,a=0.5,n=0.0;
    for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*gnoise(p); n+=a; p=p*2.03+11.7; a*=0.5; }
    return s/max(n,1e-4);
  }
  float fbm3(vec3 p, int oct){
    float s=0.0,a=0.5,n=0.0;
    for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*gnoise3(p); n+=a; p=p*2.07+7.3; a*=0.5; }
    return s/max(n,1e-4);
  }
  float ridged3(vec3 p, int oct){
    float s=0.0,a=0.5,n=0.0;
    for(int i=0;i<6;i++){ if(i>=oct) break;
      s+=a*(1.0-abs(gnoise3(p)*2.0-1.0)); n+=a; p=p*2.11+5.7; a*=0.5; }
    return s/max(n,1e-4);
  }
  float ridged(vec2 p, int oct){
    float s=0.0,a=0.5,n=0.0;
    for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*(1.0-abs(gnoise(p)*2.0-1.0)); n+=a; p=p*2.11+5.3; a*=0.5; }
    return s/max(n,1e-4);
  }
`;

export const EDGE = String.raw`    /* ---- The burning edge: one look for the loader's ring, the intro and
       every burn (the page's burn pass reads this same text). It is drawn in
       CSS pixels: xc is the distance to the front (+ ahead of it, - burnt), g
       the paper's own coordinates, so the grain, the embers and the splits
       stay put on the paper while the front passes over them, and aa is a
       device pixel in CSS px, so every hard edge is crisp to the pixel.
       wht: how wide it burns here (0.3-2.6, it swells and pinches), how hot
       (0-1, high only in a few stretches), a scale on the whole band (1;
       less on a ring still small, which must stay a rim with black inside
       it, never a glowing disc), and how alive (0.15-1: some stretches all
       but out), each wandering along the edge and over time. ---- */
    /* the loader's ring is drawn at about two-thirds size while the page
       loads, and opens out to full size over the intro's first stretch;
       the loader and the intro both draw it through this, so the hand-off
       is the same ring at the same size */
    float kbScale(float u){ return mix(0.67, 1.0, smoothstep(0.335, 0.55, u)); }
    float kbGrad(float f, float pxH, float nominal){
    #ifdef KB_NO_DERIV
      return nominal;
    #else
      return clamp(length(vec2(dFdx(f), dFdy(f)))*pxH, 0.35*nominal, 3.0*nominal);
    #endif
    }
    /* distance in pixels to where v crosses zero: a line drawn this way is
       a pixel wide wherever it runs, never a soft blotch */
    float kbLinePx(float v, float nominalPerPx){
    #ifdef KB_NO_DERIV
      return abs(v)/nominalPerPx;
    #else
      return abs(v)/max(length(vec2(dFdx(v), dFdy(v))), 0.25*nominalPerPx);
    #endif
    }
    vec4 kbEdgeWHT(vec2 e, float t){
      /* one slow field decides what each stretch is doing, so the edge never
         reads as a stroke: some arcs burn wide and hot, others narrow and
         dull, and some are all but out; it drifts slowly as it burns */
      float b = fbm(e*2.6 + vec2(t*0.24, -t*0.17) + 13.0, 3);
      float life = 0.03 + 0.97*smoothstep(0.42, 0.60, b);
      float w = (0.20 + 2.60*smoothstep(0.40, 0.66, b + 0.14*(gnoise(e*6.0 + vec2(t*0.70, 1.0)) - 0.5)))
              * (0.80 + 0.40*gnoise(e*1.6 + vec2(t*0.95, 3.0)));
      float hn = gnoise(e*4.1 + 31.0 + vec2(0.0, -t*0.08));
      float h = smoothstep(0.55, 0.80, b + 0.35*(hn - 0.5))*(0.75 + 0.25*sin(t*2.1 + hn*9.0));
      return vec4(w, h, 1.0, life);
    }
    /* hashes and a value noise with no sin in them, for the pixel-sized
       grain (fixed on the paper, so it never swims) */
    float kbHash(vec2 p){ vec3 q = fract(p.xyx*0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y)*q.z); }
    vec2 kbHash2(vec2 p){ vec3 q = fract(p.xyx*vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz)*q.zy); }
    float kbVN(vec2 x){ vec2 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
      return mix(mix(kbHash(i), kbHash(i + vec2(1.0, 0.0)), f.x), mix(kbHash(i + vec2(0.0, 1.0)), kbHash(i + vec2(1.0, 1.0)), f.x), f.y); }
    /* The page's burn pass has its noise baked (KB_BAKED), made once at
       load: a tileable texture of fbm and ridged of three octaves, one
       gradient octave and ridged of two on a 16-cell period, so an octave stack costs a
       texture tap (the lines take it; the ring keeps its own noise, so it
       stays the loader's ring); and kbHash's own values for 2048 x 2048
       cells round the origin, which give kbVN exactly — the same grain as
       the loader's, in one tap: filtered between cell centres, at the
       smoothstep of the fraction */
    #ifdef KB_BAKED
    uniform sampler2D uKbN, uKbH;
    float kbFbmT(vec2 x){ return texture2D(uKbN, x*0.0625).r; }
    float kbRidT(vec2 x){ return texture2D(uKbN, x*0.0625).g; }
    float kbGnT(vec2 x){ return texture2D(uKbN, x*0.0625).b; }
    float kbRid2T(vec2 x){ return texture2D(uKbN, x*0.0625).a; }   /* ridged, two octaves */
    float kbV(vec2 x){ vec2 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
      return texture2D(uKbH, (i + 1024.5 + f)*0.00048828125).r; }
    #define KBGN(x) kbGnT(x)
    #define KBFBM(x) kbFbmT(x)
    #define KBRID(x) kbRidT(x)
    /* a line's width, heat and life, as kbEdgeWHT but off the baked noise */
    vec4 kbEdgeWHTb(vec2 e, float t){
      float b = kbFbmT(e*2.6 + vec2(t*0.24, -t*0.17) + 13.0);
      float life = 0.03 + 0.97*smoothstep(0.42, 0.60, b);
      float w = (0.20 + 2.60*smoothstep(0.40, 0.66, b + 0.14*(kbGnT(e*6.0 + vec2(t*0.70, 1.0)) - 0.5)))
              * (0.80 + 0.40*kbGnT(e*1.6 + vec2(t*0.95, 3.0)));
      float hn = kbGnT(e*4.1 + 31.0 + vec2(0.0, -t*0.08));
      float h = smoothstep(0.55, 0.80, b + 0.35*(hn - 0.5))*(0.75 + 0.25*sin(t*2.1 + hn*9.0));
      return vec4(w, h, 1.0, life);
    }
    #else
    float kbV(vec2 x){ return kbVN(x); }
    #define KBGN(x) gnoise(x)
    #define KBFBM(x) fbm(x, 2)
    #define KBRID(x) ridged(x, 3)
    #endif
    /* coverage of v > 0 over w, the change in v across a device pixel,
       worked out from v's own scale rather than taken with derivatives:
       the page skips whole regions before these run, and a derivative
       taken past such a branch came back as 2x2 blocks — stair-steps and
       loose flecks along the skipped region's edge */
    float kbAA(float v, float w){ return clamp(0.5 + v/max(w, 1e-5), 0.0, 1.0); }
    /* the ember zone's width, px: 12-66 on a line, wide where it burns hot,
       narrow where it is dying, and on a small ring never under 3.5-7 px
       (as wide as it burns there): thinner, the rim read as a drawn outline,
       and even, as a drawn 'o' */
    float kbZoneW(vec4 wht){ return max((18.0 + 20.0*min(wht.x, 2.6))*wht.z*(0.55 + 0.45*wht.w), 3.5 + 3.5*smoothstep(0.3, 2.0, wht.x)); }
    /* The ember ramp every colour of the fire keeps to, before the tone
       curve: deep red, red-orange, orange, warm yellow-orange; nothing on it
       is pale or grey (the old yellow went cream at full heat and khaki when
       dimmed), and nothing is bright enough to bloom, so the flame keeps a
       hard edge on the frame ahead of it. A dim stretch goes down the ramp,
       never just darker. */
    vec3 kbRamp(float h){
      vec3 c = mix(vec3(0.11, 0.006, 0.0007), vec3(0.34, 0.032, 0.0025), smoothstep(0.00, 0.33, h));
      c = mix(c, vec3(0.90, 0.13, 0.012), smoothstep(0.33, 0.66, h));
      return mix(c, vec3(1.13, 0.30, 0.036), smoothstep(0.66, 1.00, h));
    }
    /* where the ember zone ends: its lip, W px back, torn */
    float kbLipD(float W, vec2 g){
      vec2 gr = mat2(0.80, -0.60, 0.60, 0.80)*g;
      return W*(0.78 + 0.30*kbV(gr*0.035 + 6.0)) + 1.5*(kbV(gr*0.22 + 1.0) - 0.5);
    }
    /* The front, as the footer's paper burns: a bright thread of ember that
       beads and pinches along its length (an even stroke read as neon), gold
       where it runs hot and dull red where it is nearly out, with a tight
       glow a few px round it; behind it the ember zone, packed solid and
       graded smoothly by its heat — yellow at the front, orange, deep red
       at a crisp torn lip, the hot stretches carrying the yellow further
       back (hard steps read as a poster). All of it alive: heat pulses run
       along it both ways and roll back through the zone, patches flicker,
       the beads drift. sA runs along the edge, px. */
    vec3 kbFlame(float xc, float xb, float sA, vec4 wht, vec2 g, float t, float aa){
      float hot = wht.y, life = wht.w, dist = max(-xc, 0.0);
      float W = kbZoneW(wht);
      float behind = clamp(0.5 - xc/aa, 0.0, 1.0);          /* burnt, to the pixel */
      float run = 0.5*kbV(vec2(sA*0.018 - t*1.30, 2.0)) + 0.5*kbV(vec2(sA*0.027 + t*1.70, 5.0));
      float flk = kbV(vec2(sA*0.110, t*7.0) + 3.0);
      float roll = kbV(vec2(sA*0.060, dist*0.090 - t*2.6) + 11.0);
      float heat = clamp(0.30 + 0.55*hot + 0.50*(run - 0.5) + 0.22*(flk - 0.5), 0.0, 1.0)*(0.30 + 0.70*life);
      float bead = 0.50 + 1.00*kbV(vec2(sA*0.085 - t*0.8, 7.0));
      float wc = max(0.7, (0.9 + 2.6*heat)*bead*min(1.0, wht.z*2.5));   /* the thread, ~1-5 px */
      float core = behind*exp(-dist/wc) + (1.0 - behind)*exp(-max(xc, 0.0)/0.35)*0.35;
      float glow = exp(-abs(xc + 0.5*wc)/(2.0 + 2.8*heat))*heat*min(1.0, wht.z*2.0);
      float k = dist/W;
      vec2 gr = mat2(0.80, -0.60, 0.60, 0.80)*g, ga = mat2(0.94, 0.34, -0.34, 0.94)*g;
      float gT = kbV(g*0.045 + vec2(t*0.90, -t*0.50));
      /* a few holes drawn out along the grain, drifting */
      float cl = kbV(ga*vec2(0.12, 0.42) + vec2(t*0.5, -t*0.8) + 4.0)*0.6 + kbV(gr*0.50 + 9.0)*0.4;
      float lit = kbAA(cl - (0.10 + 0.40*k*k + 0.12*(0.5 - life)), 0.45*aa)*behind;
      lit *= kbAA(kbLipD(W, g) - dist, aa);
      float tau = clamp(1.0 - k*(1.05 - 0.40*hot) + 0.22*(gT - 0.5) + 0.34*(run - 0.5) + 0.24*(roll - 0.5) + 0.12*(flk - 0.5) - 0.30*(1.0 - life), 0.0, 1.0);
      vec3 ember = mix(vec3(0.34, 0.022, 0.003), vec3(0.86, 0.20, 0.024), smoothstep(0.05, 0.42, tau));
      ember = mix(ember, vec3(1.02, 0.38, 0.055), smoothstep(0.42, 0.76, tau));
      ember = mix(ember, vec3(1.10, 0.64, 0.17), smoothstep(0.86, 1.0, tau)*(0.30 + 0.70*hot));
      float band = lit*(0.20 + 0.82*tau*tau)*(1.0 + mix(0.16, 0.50, k)*(kbV(gr*0.60) - 0.5))*(0.35 + 0.65*life);
      vec3 coreC = mix(vec3(1.40, 0.56, 0.09), vec3(1.85, 1.02, 0.30), heat);
      coreC = mix(vec3(0.38, 0.05, 0.008), coreC, smoothstep(0.06, 0.55, life));
      return coreC*core + ember*band + vec3(0.95, 0.20, 0.022)*glow*0.60;
    }
    /* the char's crust behind the lip: 3-6 px of it, hard and flaky, before
       the black: rgb its colour, a its cover */
    vec4 kbCrust(float xc, float sA, vec4 wht, vec2 g, float aa){
      float dist = max(-xc, 0.0), W = kbZoneW(wht), lipD = kbLipD(W, g);
      float cw = 3.0 + 3.0*kbV(vec2(sA*0.12, 1.7));
      float cov = kbAA(dist - lipD, aa)*kbAA(lipD + cw - dist, aa);
      float flake = kbAA(kbV(g*0.55 + 2.0) - 0.52, 0.30*aa);
      return vec4(mix(vec3(0.0030, 0.0022, 0.0016), vec3(0.022, 0.016, 0.011), flake), cov);
    }
    /* the char: near black with a fibrous grain, and, where it lies behind a
       burning line, a dim ash-grey mottling and flecks drawn out along the
       grain (ash 1); the loader's hole is quiet char with neither (ash 0) */
    vec3 kbCharCol(vec2 g, float ash){
      vec2 gr = mat2(0.80, -0.60, 0.60, 0.80)*g;
      float f = 0.55*kbV(gr*0.85 + 3.1) + 0.45*kbV(vec2(g.x*0.22 + g.y*0.10, g.y*0.95 - g.x*0.35) + 7.7);
      vec3 c = vec3(0.0085, 0.0062, 0.0048)*(0.60 + 0.80*f);   /* sumi charcoal, as the footer's */
      if (ash <= 0.0) return c;
      vec2 ga = mat2(0.94, 0.34, -0.34, 0.94)*g;
      float mott = kbV(g*0.09 + 6.0)*0.6 + kbV(gr*0.33 + 2.0)*0.4;
      float fl = kbAA(kbV(ga*vec2(0.17, 0.60) + 11.0) - 0.80, 0.30)*smoothstep(0.45, 0.70, kbV(g*0.045 + 2.0));
      return c + (vec3(0.010, 0.0085, 0.0068)*smoothstep(0.50, 0.90, mott) + vec3(0.010, 0.0085, 0.007)*fl*(0.35 + 0.85*kbV(g*0.21 + 5.0)))*ash;
    }
    /* the char burning through, never a flat slab: pores open in it as it
       ages (a: 0 at the ember zone's lip, 1 at its far edge), ragged, down
       to whatever lies beneath (no glowing rims: round the pores they
       joined into one drawn line along the edge); they open while you
       watch, as the fire moves on and in their own slow breathing. Its cover */
    float kbPores(vec2 g, float a, float t, float aa){
      vec2 gr = mat2(0.80, -0.60, 0.60, 0.80)*g;
      float n = 0.50*kbV(gr*0.060 + 21.0) + 0.32*kbV(g*0.17 + 4.0) + 0.18*kbV(gr*0.46 + 8.0);
      float thr = -0.12 + 0.95*a + 0.16*(kbV(g*0.022 + vec2(t*0.45, -t*0.30) + 2.0) - 0.5);
      float v = n - thr, w = 0.08*aa;
      return kbAA(v, w);
    }
    /* the char's far edge, a noise along the edge only (a 2-D noise cut
       loose islands of char that floated on the new frame): a line's, by
       its height, px */
    float kbEdgeNLine(float s){
      return 0.60*kbV(vec2(s*0.026, 3.1)) + 0.40*(1.0 - abs(2.0*kbV(vec2(s*0.072, 7.3)) - 1.0));
    }
    /* a ring's, round it: noise on a circle, so it closes on itself */
    float kbEdgeNRing(vec2 dir){
      return 0.60*kbV(dir*6.0 + 3.1) + 0.40*(1.0 - abs(2.0*kbV(dir*17.0 + 7.3) - 1.0));
    }
    /* how charred: from the front, through the ember zone, then a band of
       char bedW px more (as its edge noise n says), to the char's own torn
       edge, a pixel wide. xb is the distance to the broad front at its
       nominal slope, smooth and never blowing up where the field runs flat
       (the true slope, constant over each 2x2 block, stair-stepped the edge
       and opened holes in the char there), and the fine terms move the
       front off it by at most fs px: the far edge is taken from it, so no
       island of char is ever cut loose; and it always covers the embers */
    float kbBed(float xc, float xb, float fs, float n, float zoneW, float bedW, float aa, vec2 g){
      /* and a tear of a few px on it, at two scales, together gentler than
         the front's own slope, so it frays without cutting a piece loose */
      vec2 gt = mat2(0.80, -0.60, 0.60, 0.80)*g;
      float edge = zoneW + fs + bedW*(0.35 + 1.10*n) + 8.0*(kbV(gt*0.08 + 4.0) - 0.5) + 3.0*(kbV(gt*0.25 + 9.0) - 0.5);
      return clamp(0.5 - xc/aa, 0.0, 1.0)*max(kbAA(edge + min(xb, 0.0), aa), kbAA(zoneW*1.12 + 3.0 + xc, aa));
    }
    /* what still glows in the char just behind the ember zone: thin grain
       drawn out along its fibres, each thread at its own brightness,
       cooling and thinning within 20-40 px (patches read as leopard spots) */
    vec3 kbCharGlow(float xc, vec2 g, vec4 wht, float aa, float t, float specks){
      float dist = -xc, W = kbZoneW(wht);
      if (dist < 0.85*W || dist > W + 40.0) return vec3(0.0);
      vec2 ga = mat2(0.94, 0.34, -0.34, 0.94)*g;
      float fade = exp(-max(dist - 0.92*W, 0.0)/11.0)*smoothstep(0.85*W, 0.98*W, dist);
      float thread = kbV(ga*vec2(0.075, 0.75) + 17.0);
      float st = kbAA(thread - 0.78 + 0.08*fade, 0.10*aa)*smoothstep(0.45, 0.65, kbV(ga*vec2(0.03, 0.10) + 3.0));
      float br = (0.30 + 0.70*kbV(ga*vec2(0.025, 0.22) + vec2(t*0.8, -t*0.5) + 9.0))*(0.60 + 0.40*kbV(ga*vec2(0.05, 0.3) + vec2(0.0, t*4.0) + 23.0));
      return kbRamp(0.12 + 0.45*fade)*st*fade*br*(0.35 + 0.65*wht.w);
    }`;
