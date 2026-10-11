// A sheet of washi in Canvas 2D (3d-paper-material, flattened to a card): formation clouds, two warped fibre
// families plus long kozo strands, a few rounded bark flecks, a torn outline from four independent tear
// lines (torn sides wander, the cut side stays near straight), pulled fibres past the edge as partial
// coverage, and a faint toasted band inside the edge. Deterministic per seed so a resize repaints the same sheet.
//
// paintWords() copies the card's live DOM text into the same canvas word by word (Range rects), so the
// frozen frame the fire eats is the card the visitor was just looking at, typed words included.

const TINT = [240, 232, 210]; // washi #f0e8d2

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Value noise (1D) for the tear lines: runs straight, turns, runs again. */
function tearLine(r: () => number, n: number, amp: number): number[] {
  const out: number[] = [];
  let v = 0, dv = 0;
  for (let i = 0; i < n; i++) {
    if (r() < 0.08) dv = (r() - 0.5) * amp * 0.5; // a turn
    v += dv + (r() - 0.5) * amp * 0.12;
    v *= 0.9; // stays near the edge
    out.push(v);
  }
  return out;
}

export interface SheetGeom {
  /** Margin (CSS px) around the sheet inside the canvas, for fray and glow. */
  m: number;
  w: number;
  h: number;
  outline: Path2D;
}

/** Paint a washi sheet of w x h (CSS px) into ctx (already scaled by dpr), inset by margin m. */
export function paintSheet(ctx: CanvasRenderingContext2D, w: number, h: number, m: number, seed = 7): SheetGeom {
  const r = rng(seed * 9973 + 17);
  const step = 3;
  // four independent tears: top and bottom torn (wander), left torn lightly, right a cut edge
  const nx = Math.ceil(w / step) + 1, ny = Math.ceil(h / step) + 1;
  const top = tearLine(r, nx, 3.2), bot = tearLine(r, nx, 3.6);
  const left = tearLine(r, ny, 2.4), right = tearLine(r, ny, 0.7);
  const path = new Path2D();
  const pts: [number, number][] = [];
  for (let i = 0; i < nx; i++) pts.push([m + Math.min(w, i * step), m + 2.5 + top[i]]);
  for (let i = 0; i < ny; i++) pts.push([m + w - 1.5 + right[i], m + Math.min(h, i * step)]);
  for (let i = nx - 1; i >= 0; i--) pts.push([m + Math.min(w, i * step), m + h - 2.5 + bot[i]]);
  for (let i = ny - 1; i >= 0; i--) pts.push([m + 2 + left[i], m + Math.min(h, i * step)]);
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();

  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = `rgb(${TINT.join(',')})`;
  ctx.fillRect(0, 0, w + 2 * m, h + 2 * m);

  // formation: cloudy thick/thin areas (soft radial blotches, both lighter and darker)
  for (let i = 0; i < 70; i++) {
    const x = m + r() * w, y = m + r() * h, rad = 20 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.45;
    const a = dark ? 0.012 + r() * 0.026 : 0.02 + r() * 0.04;
    g.addColorStop(0, dark ? `rgba(196,180,148,${a})` : `rgba(255,252,242,${a * 1.4})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // fibres: two warped families (never a crosshatch), the finer one fainter
  const angleAt = (x: number, y: number) => Math.sin(x * 0.011 + seed) * 0.5 + Math.cos(y * 0.017 - seed) * 0.4;
  const fibre = (count: number, len: [number, number], base: number, alpha: [number, number], width: number) => {
    for (let i = 0; i < count; i++) {
      const x = m + r() * w, y = m + r() * h;
      const a = base + angleAt(x, y) * 0.9 + (r() - 0.5) * 0.35;
      const L = len[0] + r() * (len[1] - len[0]);
      const bend = (r() - 0.5) * L * 0.35;
      const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
      const cx = (x + x2) / 2 - Math.sin(a) * bend, cy = (y + y2) / 2 + Math.cos(a) * bend;
      const light = r() < 0.5;
      const al = alpha[0] + r() * (alpha[1] - alpha[0]);
      ctx.strokeStyle = light ? `rgba(255,253,246,${al * 1.3})` : `rgba(170,150,112,${al})`;
      ctx.lineWidth = width * (0.6 + r() * 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
    }
  };
  const area = (w * h) / (520 * 420);
  fibre(Math.round(900 * area), [10, 34], 0.05, [0.05, 0.12], 0.8);
  fibre(Math.round(500 * area), [5, 14], 1.45, [0.03, 0.07], 0.6);
  // long kozo strands, faint and wandering
  fibre(Math.round(46 * area), [60, 150], 0.2, [0.05, 0.09], 0.7);
  // rounded bark flecks, rare
  for (let i = 0; i < Math.round(22 * area); i++) {
    const x = m + r() * w, y = m + r() * h;
    ctx.fillStyle = `rgba(110,88,58,${0.18 + r() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.5 + r() * 1.1, 0.4 + r() * 0.6, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // toasted band just inside the torn edge, fading to nothing inward (never past the edge)
  ctx.lineJoin = 'round';
  for (const [lw, a] of [
    [14, 0.035],
    [7, 0.05],
    [2.5, 0.07],
  ] as const) {
    ctx.strokeStyle = `rgba(150,112,62,${a})`;
    ctx.lineWidth = lw;
    ctx.stroke(path);
  }
  ctx.restore();

  // pulled fibres past the torn edges: thin pale hairs at partial coverage
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < pts.length; i += 2) {
    if (r() > 0.22) continue;
    const [x, y] = pts[i];
    const side = x < m + 6 ? 'l' : x > m + w - 6 ? 'r' : y < m + h / 2 ? 't' : 'b';
    if (side === 'r') continue; // the cut edge does not fray
    const out = side === 't' ? -Math.PI / 2 : side === 'b' ? Math.PI / 2 : Math.PI;
    const a = out + (r() - 0.5) * 1.5;
    const L = 2 + r() * 7;
    ctx.strokeStyle = `rgba(${TINT.join(',')},${0.3 + r() * 0.45})`;
    ctx.lineWidth = 0.35 + r() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * 2, y - Math.sin(a) * 2);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.4) * L * 0.5, y + Math.sin(a + 0.4) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
    ctx.stroke();
  }
  ctx.restore();
  return { m, w, h, outline: path };
}

/** Copy the visible text of `el` into ctx, word by word, at its exact on-screen position. */
export function paintWords(ctx: CanvasRenderingContext2D, el: Element, origin: DOMRect, m: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    const cs = getComputedStyle(parent);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parent.closest('[aria-hidden="true"].sr-only, .sr-only')) continue;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    } catch {
      /* older engines */
    }
    ctx.textBaseline = 'alphabetic';
    const raw = node.textContent || '';
    const tt = cs.textTransform;
    const text = tt === 'uppercase' ? raw.toUpperCase() : tt === 'lowercase' ? raw.toLowerCase() : raw;
    const re = /\S+/g;
    let mt: RegExpExecArray | null;
    while ((mt = re.exec(text))) {
      range.setStart(node, mt.index);
      range.setEnd(node, mt.index + mt[0].length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const rc = rects[0];
      const metrics = ctx.measureText(mt[0]);
      const asc = metrics.fontBoundingBoxAscent ?? parseFloat(cs.fontSize) * 0.8;
      const desc = metrics.fontBoundingBoxDescent ?? parseFloat(cs.fontSize) * 0.2;
      // the range rect is the font's content area: centre the font box in it
      const y = rc.top - origin.top + m + (rc.height - (asc + desc)) / 2 + asc;
      ctx.fillText(mt[0], rc.left - origin.left + m, y);
    }
  }
}

/** Paint an element's box (background fill + borders), used for the button and the writing line. */
export function paintBox(ctx: CanvasRenderingContext2D, el: Element, origin: DOMRect, m: number) {
  const cs = getComputedStyle(el);
  const rc = el.getBoundingClientRect();
  const x = rc.left - origin.left + m, y = rc.top - origin.top + m;
  const rad = parseFloat(cs.borderTopLeftRadius) || 0;
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, y, rc.width, rc.height, rad);
    ctx.fill();
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && cs.borderTopStyle !== 'none') {
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = bw;
    ctx.beginPath();
    ctx.roundRect(x + bw / 2, y + bw / 2, rc.width - bw, rc.height - bw, rad);
    ctx.stroke();
  } else {
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    if (bb > 0 && cs.borderBottomStyle !== 'none') {
      ctx.fillStyle = cs.borderBottomColor;
      ctx.fillRect(x, y + rc.height - bb, rc.width, bb);
    }
  }
}
