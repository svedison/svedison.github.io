// Sound (SPEC §10, build-game-audio-feedback). Off by default; WebAudio only.
// Every sound is synthesized procedurally at runtime: no audio files, no licensing.
//
// - The AudioContext is created / resumed only inside a user gesture ([data-action="sound"] click or the S key).
// - The on/off choice persists in game state, but after a reload the browser still needs a gesture,
//   so the toggle shows "sound off, tap to enable" (data-sound="locked") until the visitor taps it.
// - Ambient beds crossfade per world module on bus 'chapter'. Loops are baked once into buffers
//   (with a crossfaded seam) so a bed costs one or two looping sources, never a stream of voices.
// - Cues are capped at 6 simultaneous voices and each one already has a visual equivalent elsewhere.
// - The context suspends while the tab is hidden.
import type { App } from '../app';
import { bus } from '../bus';
import type { ChapterId } from '../content/story';
import { AUDIO_COPY } from '../content/ui';
import { CHAPTER_MODULE, type ModuleId } from '../world/types';

type BedId = 'river' | 'ocean' | 'surf' | 'rain' | 'glass' | 'pad';

const BED_FOR: Record<ModuleId, BedId> = {
  jiangyin: 'river',
  crossing: 'ocean',
  coast: 'surf',
  rain: 'rain',
  workshop: 'glass',
  loop: 'pad',
  next: 'pad',
};

const MAX_VOICES = 6;
const BED_FADE = 1.8; // seconds
const MASTER = 0.9;

interface Bed {
  out: GainNode;
  /** Level the bed sits at when active (rain beds scale with live weather). */
  level: number;
  stop(at: number): void;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let currentBedId: BedId | null = null;
let currentBed: Bed | null = null;
let voices = 0;
let chapter: ChapterId = 'prologue';
let rainAmount = 0.6;
const buffers = new Map<string, AudioBuffer>();

// ---------------------------------------------------------------------------------------------
// Buffer baking

/** Bake `seconds` of mono audio from a sample generator, with a crossfaded loop seam. */
function bake(key: string, seconds: number, gen: (out: Float32Array, sr: number) => void): AudioBuffer {
  const hit = buffers.get(key);
  if (hit) return hit;
  const c = ctx!;
  const sr = c.sampleRate;
  const len = Math.floor(seconds * sr);
  const fade = Math.floor(0.25 * sr);
  const raw = new Float32Array(len + fade);
  gen(raw, sr);
  const buf = c.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  data.set(raw.subarray(0, len));
  // Seam: the head blends in the material that would have followed the tail, so tail -> head is continuous.
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    data[i] = raw[i] * w + raw[len + i] * (1 - w);
  }
  buffers.set(key, buf);
  return buf;
}

const white = (o: Float32Array) => {
  for (let i = 0; i < o.length; i++) o[i] = Math.random() * 2 - 1;
};

const brown = (o: Float32Array) => {
  let last = 0;
  for (let i = 0; i < o.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) * 0.998; // leaky integrator keeps it centred
    o[i] = last * 3.2;
  }
};

/** Sparse droplet impacts: short noise ticks with exponential decay over an optional hiss floor. */
function droplets(opts: { rate: number; decayMs: [number, number]; gain: [number, number]; hiss: number }) {
  return (o: Float32Array, sr: number) => {
    for (let i = 0; i < o.length; i++) o[i] = (Math.random() * 2 - 1) * opts.hiss;
    const count = Math.floor((o.length / sr) * opts.rate);
    for (let n = 0; n < count; n++) {
      const start = Math.floor(Math.random() * o.length);
      const decay = (opts.decayMs[0] + Math.random() * (opts.decayMs[1] - opts.decayMs[0])) / 1000;
      const amp = opts.gain[0] + Math.random() ** 2 * (opts.gain[1] - opts.gain[0]);
      const span = Math.min(o.length - start, Math.floor(decay * sr * 5));
      const k = 1 / (decay * sr);
      for (let j = 0; j < span; j++) o[start + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j * k);
    }
  };
}

/** Fire crackle: sparse sharp pops with occasional clusters. */
const crackle = (o: Float32Array, sr: number) => {
  o.fill(0);
  let t = 0;
  while (t < o.length) {
    t += Math.floor(sr * (0.004 + Math.random() * 0.09));
    const cluster = Math.random() < 0.2 ? 3 + Math.floor(Math.random() * 4) : 1;
    for (let c = 0; c < cluster; c++) {
      const start = t + Math.floor(Math.random() * sr * 0.012);
      const amp = 0.2 + Math.random() * 0.8;
      const span = Math.floor(sr * 0.003);
      for (let j = 0; j < span && start + j < o.length; j++) o[start + j] += (Math.random() * 2 - 1) * amp * (1 - j / span);
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Beds

function loopSource(buf: AudioBuffer, offset = Math.random() * buf.duration) {
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(ctx!.currentTime, offset);
  return s;
}

function filter(type: BiquadFilterType, freq: number, q = 0.7) {
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(v: number) {
  const g = ctx!.createGain();
  g.gain.value = v;
  return g;
}

function lfo(freq: number, depth: number, target: AudioParam) {
  const o = ctx!.createOscillator();
  o.frequency.value = freq;
  const g = gain(depth);
  o.connect(g).connect(target);
  o.start();
  return o;
}

function chain(...nodes: AudioNode[]) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function rainLevel() {
  return 0.35 + 0.65 * rainAmount;
}

function makeBed(id: BedId): Bed {
  const c = ctx!;
  const out = gain(0);
  const stops: (AudioScheduledSourceNode)[] = [];
  let level = 0.3;

  if (id === 'river') {
    // Canal water: brown noise through a low band whose centre wanders, plus a very soft drizzle.
    const water = loopSource(bake('brown', 9, brown));
    const lp = filter('lowpass', 520, 0.9);
    const bp = filter('bandpass', 260, 0.6);
    stops.push(water, lfo(0.13, 140, lp.frequency), lfo(0.07, 60, bp.frequency));
    chain(water, lp, bp, gain(1.4), out);
    const drizzle = loopSource(bake('drizzle', 7, droplets({ rate: 70, decayMs: [2, 6], gain: [0.05, 0.35], hiss: 0.015 })));
    stops.push(drizzle);
    chain(drizzle, filter('highpass', 2400), filter('lowpass', 7000), gain(0.28), out);
    level = 0.32;
  } else if (id === 'ocean') {
    // Night swell: very low noise that breathes on a slow ~11 s cycle.
    const sea = loopSource(bake('brown', 9, brown));
    const lp = filter('lowpass', 300, 0.5);
    const swell = gain(0.7);
    stops.push(sea, lfo(0.09, 0.45, swell.gain), lfo(0.05, 90, lp.frequency));
    chain(sea, lp, swell, out);
    level = 0.42;
  } else if (id === 'surf') {
    // Surf wash: wider band noise with a deep, slightly faster swell and a hiss that rides the crest.
    const n = loopSource(bake('white', 6, white));
    const bp = filter('bandpass', 700, 0.45);
    const wash = gain(0.4);
    stops.push(n, lfo(0.12, 0.38, wash.gain), lfo(0.12, 380, bp.frequency));
    chain(n, bp, filter('lowpass', 3200), wash, out);
    const body = loopSource(bake('brown', 9, brown));
    stops.push(body);
    chain(body, filter('lowpass', 220), gain(0.5), out);
    level = 0.3;
  } else if (id === 'rain') {
    // Rain on leaves: dense soft impacts, broadband, with a low patter body.
    const leaves = loopSource(bake('leaves', 8, droplets({ rate: 520, decayMs: [3, 11], gain: [0.03, 0.4], hiss: 0.05 })));
    stops.push(leaves);
    chain(leaves, filter('highpass', 500), filter('lowpass', 6500), gain(0.55), out);
    const patter = loopSource(bake('brown', 9, brown));
    stops.push(patter);
    chain(patter, filter('lowpass', 400), gain(0.25), out);
    level = 0.3 * rainLevel();
  } else if (id === 'glass') {
    // Rain on glass: sparser, brighter ticks through a glassy resonance, and a quiet room tone.
    const ticks = loopSource(bake('glass', 7, droplets({ rate: 90, decayMs: [1, 3], gain: [0.1, 0.7], hiss: 0.006 })));
    stops.push(ticks);
    chain(ticks, filter('highpass', 1400), filter('peaking', 3400, 2.5), gain(0.35), out);
    const room = loopSource(bake('brown', 9, brown));
    stops.push(room);
    chain(room, filter('lowpass', 140), gain(0.55), out);
    level = 0.22 * rainLevel();
  } else {
    // Near silence: a soft open-fifth pad, filtered and slowly breathing.
    const pad = gain(0.0);
    const lp = filter('lowpass', 900, 0.4);
    for (const [f, type, g] of [
      [146.83, 'sine', 0.5],
      [220.0, 'triangle', 0.22],
      [293.66, 'sine', 0.18],
      [440.0, 'sine', 0.05],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.start();
      stops.push(o, lfo(0.05 + Math.random() * 0.05, 3, o.detune));
      chain(o, gain(g), pad);
    }
    stops.push(lfo(0.04, 0.25, pad.gain));
    pad.gain.value = 0.55;
    chain(pad, lp, out);
    level = 0.06;
  }

  out.connect(master!);
  return {
    out,
    level,
    stop(at: number) {
      for (const s of stops) {
        try {
          s.stop(at);
        } catch {
          /* already stopped */
        }
      }
      setTimeout(() => out.disconnect(), Math.max(0, (at - c.currentTime) * 1000) + 100);
    },
  };
}

function setBed(id: BedId) {
  if (!ctx || ctx.state !== 'running') return;
  if (id === currentBedId && currentBed) return;
  const now = ctx.currentTime;
  if (currentBed) {
    const g = currentBed.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + BED_FADE);
    currentBed.stop(now + BED_FADE + 0.1);
  }
  currentBedId = id;
  currentBed = makeBed(id);
  currentBed.out.gain.setValueAtTime(0, now);
  currentBed.out.gain.linearRampToValueAtTime(currentBed.level, now + BED_FADE);
}

function stopBed() {
  if (!ctx || !currentBed) return;
  const now = ctx.currentTime;
  currentBed.out.gain.cancelScheduledValues(now);
  currentBed.out.gain.setValueAtTime(currentBed.out.gain.value, now);
  currentBed.out.gain.linearRampToValueAtTime(0, now + 0.3);
  currentBed.stop(now + 0.4);
  currentBed = null;
  currentBedId = null;
}

// ---------------------------------------------------------------------------------------------
// Cues

/** Reserve a voice for `dur` seconds; false when the cap is reached (the cue is dropped). */
function voice(dur: number) {
  if (!ctx || ctx.state !== 'running' || voices >= MAX_VOICES) return false;
  voices++;
  setTimeout(() => (voices = Math.max(0, voices - 1)), dur * 1000 + 50);
  return true;
}

/** A damped sine partial (bells, chimes). */
function partial(dest: AudioNode, freq: number, amp: number, decay: number, at: number, attack = 0.004) {
  const c = ctx!;
  const o = c.createOscillator();
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(amp, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + decay + 0.05);
}

function noiseBurst(dest: AudioNode, at: number, dur: number, amp: number, f: BiquadFilterType, freq: number, q = 1) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = bake('white', 6, white);
  const flt = filter(f, freq, q);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(amp, at + Math.min(0.01, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(flt).connect(g).connect(dest);
  s.start(at, Math.random() * 5);
  s.stop(at + dur + 0.05);
  return flt;
}

const cues = {
  /** Keepsake pickup: a soft wooden chime, two damped inharmonic partials and a tiny knock. */
  chime() {
    if (!voice(1.2)) return;
    const at = ctx!.currentTime + 0.01;
    const out = gain(0.32);
    out.connect(master!);
    partial(out, 784, 0.5, 0.9, at);
    partial(out, 784 * 2.76, 0.18, 0.32, at);
    noiseBurst(out, at, 0.035, 0.18, 'bandpass', 1900, 3);
  },
  /** Light earned: a single low bell (struck partials with long, staggered decays). */
  bell(soft = false) {
    if (!voice(4.2)) return;
    const at = ctx!.currentTime + 0.01;
    const out = gain(soft ? 0.16 : 0.3);
    out.connect(master!);
    const f = 146.83;
    partial(out, f * 0.5, 0.35, 4.0, at, 0.01); // hum
    partial(out, f, 0.6, 3.6, at);
    partial(out, f * 2.0, 0.25, 2.4, at);
    partial(out, f * 2.76, 0.16, 1.6, at);
    partial(out, f * 5.4, 0.06, 0.7, at);
  },
  /** Paper ignite + burn: a soft whoosh into crackle that fades as the sheet burns out. */
  burn() {
    if (!voice(4.5)) return;
    const c = ctx!;
    const at = c.currentTime + 0.01;
    const out = gain(0.35);
    out.connect(master!);
    const whoosh = noiseBurst(out, at, 1.2, 0.5, 'bandpass', 400, 0.8);
    whoosh.frequency.setValueAtTime(300, at);
    whoosh.frequency.exponentialRampToValueAtTime(1800, at + 0.5);
    const s = c.createBufferSource();
    s.buffer = bake('crackle', 4, crackle);
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5, at + 0.4);
    g.gain.setValueAtTime(0.5, at + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 4.2);
    s.connect(filter('highpass', 900)).connect(g).connect(out);
    s.start(at + 0.15);
    s.stop(at + 4.3);
  },
  /** Loop closed: three rising notes that resolve (A3, C#4, D4 -> resolves on D, with a soft octave). */
  resolve() {
    if (!voice(3.6)) return;
    const at = ctx!.currentTime + 0.02;
    const out = gain(0.26);
    out.connect(master!);
    const notes: [number, number, number][] = [
      [220.0, 0, 0.9],
      [277.18, 0.32, 0.9],
      [293.66, 0.64, 2.8],
    ];
    for (const [f, t, d] of notes) {
      partial(out, f, 0.45, d, at + t, 0.02);
      partial(out, f * 2, 0.12, d * 0.6, at + t, 0.02);
    }
    partial(out, 587.33, 0.08, 2.4, at + 0.66, 0.08);
  },
  /** Inspect lift / return: a short paper rustle (two or three filtered noise flutters). */
  rustle(lift: boolean) {
    if (!voice(0.5)) return;
    const at = ctx!.currentTime + 0.005;
    const out = gain(0.22);
    out.connect(master!);
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      noiseBurst(out, at + i * (0.045 + Math.random() * 0.03), 0.09 + Math.random() * 0.06, 0.5, 'bandpass', (lift ? 3600 : 2600) + Math.random() * 1400, 1.4);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Context + toggle

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor({ latencyHint: 'playback' });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

const running = () => Boolean(ctx && ctx.state === 'running');

export function init(app: App): void {
  const { game } = app;
  let lastBell = -1e9;

  const label = () => {
    const on = game.get().sound;
    if (!on) return { state: 'off', text: AUDIO_COPY.off, aria: AUDIO_COPY.turnOn };
    if (!running()) return { state: 'locked', text: AUDIO_COPY.locked, aria: AUDIO_COPY.locked };
    return { state: 'on', text: AUDIO_COPY.on, aria: AUDIO_COPY.turnOff };
  };

  const render = () => {
    const l = label();
    document.documentElement.dataset.sound = l.state;
    document.querySelectorAll<HTMLElement>('[data-action="sound"]').forEach((btn) => {
      btn.dataset.sound = l.state;
      btn.setAttribute('aria-pressed', String(l.state === 'on'));
      btn.setAttribute('aria-label', l.aria);
      btn.title = l.text;
      const txt = btn.querySelector<HTMLElement>('[data-sound-label]');
      if (txt) txt.textContent = l.text;
    });
  };

  async function start() {
    const c = ensureContext();
    if (!c || !master) return;
    try {
      if (c.state !== 'running') await c.resume();
    } catch {
      /* blocked: stays locked */
    }
    if (!running()) return render();
    const now = c.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(MASTER, now + 0.6);
    setBed(BED_FOR[CHAPTER_MODULE[chapter]]);
    render();
  }

  function stop() {
    if (!ctx || !master) return render();
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.35);
    const c = ctx;
    setTimeout(() => {
      if (!game.get().sound) {
        stopBed();
        c.suspend().catch(() => {});
        render();
      }
    }, 450);
    render();
  }

  /** Gesture entry point: the only place an AudioContext is created or resumed. */
  function toggleFromGesture() {
    const s = game.get().sound;
    if (s && !running()) {
      // Persisted "on" from a previous visit: this tap is the gesture that unlocks it.
      void start();
      return;
    }
    // Create/resume synchronously inside the gesture, before any await.
    if (!s) {
      const c = ensureContext();
      c?.resume().catch(() => {});
    }
    game.setSound(!s);
  }

  game.subscribe((state, e) => {
    if (e.type === 'sound') {
      if (state.sound) void start();
      else stop();
    } else if (e.type === 'light' && state.sound && running()) {
      lastBell = performance.now();
      cues.bell();
    }
  });

  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('[data-action="sound"]');
    if (!btn) return;
    e.preventDefault();
    toggleFromGesture();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 's' && e.key !== 'S') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    toggleFromGesture();
  });

  bus.on('chapter', ({ id }) => {
    chapter = id;
    if (game.get().sound && running()) setBed(BED_FOR[CHAPTER_MODULE[id]]);
  });

  bus.on('weather', ({ rain }) => {
    rainAmount = Math.max(0, Math.min(1, rain));
    if (!ctx || !currentBed || (currentBedId !== 'rain' && currentBedId !== 'glass')) return;
    const target = (currentBedId === 'rain' ? 0.3 : 0.22) * rainLevel();
    currentBed.level = target;
    currentBed.out.gain.setTargetAtTime(target, ctx.currentTime, 1.2);
  });

  const play = (fn: () => void) => () => {
    if (game.get().sound && running()) fn();
  };
  bus.on('keepsake:collected', play(cues.chime));
  // A pulse that accompanies an earned light already rang the full bell; typed-word pulses ring softly.
  bus.on('light:pulse', play(() => performance.now() - lastBell > 1500 && cues.bell(true)));
  bus.on('forgive:burn', play(cues.burn));
  bus.on('loop:closed', play(cues.resolve));
  bus.on('inspect:open', play(() => cues.rustle(true)));
  bus.on('inspect:close', play(() => cues.rustle(false)));

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (game.get().sound) ctx.resume().then(render, render);
  });

  // The HUD may render its toggle after us: keep its state in sync when it appears.
  const mo = new MutationObserver(() => {
    if (document.querySelector('[data-action="sound"]:not([data-sound])')) render();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  render();
}
