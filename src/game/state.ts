// Game state: one serializable source of truth (build-game-inventory rules).
// Atomic transitions, no duplicate pickup, versioned save, storage failures are non-fatal.
import { KEEPSAKES, type KeepsakeId } from '../content/keepsakes';
import type { LightId, StationId } from '../content/story';

const SAVE_KEY = 'tlwh.save';
const SAVE_VERSION = 1;

export interface GameState {
  version: number;
  keepsakes: KeepsakeId[];
  lights: LightId[];
  /** Lights placed on the Loop ring in Ch.6. */
  placed: LightId[];
  visited: StationId[];
  loopClosed: boolean;
  sound: boolean;
  /** True once the visitor has seen the "welcome back" line this session. */
  returning: boolean;
}

export type GameEvent =
  | { type: 'keepsake'; id: KeepsakeId; count: number; total: number }
  | { type: 'light'; id: LightId }
  | { type: 'placed'; id: LightId }
  | { type: 'visited'; id: StationId }
  | { type: 'loopClosed' }
  | { type: 'sound'; on: boolean }
  | { type: 'reset' };

type Listener = (state: Readonly<GameState>, event: GameEvent) => void;

function fresh(): GameState {
  return {
    version: SAVE_VERSION,
    keepsakes: [],
    lights: [],
    placed: [],
    visited: [],
    loopClosed: false,
    sound: false,
    returning: false,
  };
}

function load(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh();
    const data = JSON.parse(raw) as Partial<GameState>;
    if (data.version !== SAVE_VERSION) return fresh();
    const valid = new Set(KEEPSAKES.map((k) => k.id));
    const s = fresh();
    s.keepsakes = [...new Set((data.keepsakes ?? []).filter((id) => valid.has(id)))];
    s.lights = [...new Set(data.lights ?? [])];
    s.placed = [...new Set(data.placed ?? [])];
    s.visited = [...new Set(data.visited ?? [])];
    s.loopClosed = Boolean(data.loopClosed);
    s.sound = Boolean(data.sound);
    s.returning = s.keepsakes.length > 0 || s.visited.length > 0;
    return s;
  } catch {
    return fresh();
  }
}

function persist(s: GameState) {
  try {
    const { returning, ...rest } = s;
    localStorage.setItem(SAVE_KEY, JSON.stringify(rest));
  } catch {
    /* private mode / blocked storage: play on without saving */
  }
}

export function createGame() {
  let state = load();
  const listeners = new Set<Listener>();

  function commit(next: GameState, event: GameEvent) {
    state = next;
    persist(state);
    listeners.forEach((fn) => fn(state, event));
  }

  return {
    get: (): Readonly<GameState> => state,
    total: KEEPSAKES.length,
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hasKeepsake: (id: KeepsakeId) => state.keepsakes.includes(id),
    /** Returns false (and changes nothing) on duplicate pickup. */
    collect(id: KeepsakeId): boolean {
      if (state.keepsakes.includes(id) || !KEEPSAKES.some((k) => k.id === id)) return false;
      const keepsakes = [...state.keepsakes, id];
      commit({ ...state, keepsakes }, { type: 'keepsake', id, count: keepsakes.length, total: KEEPSAKES.length });
      return true;
    },
    earn(id: LightId): boolean {
      if (state.lights.includes(id)) return false;
      commit({ ...state, lights: [...state.lights, id] }, { type: 'light', id });
      return true;
    },
    /**
     * Place a light on the Loop ring. Placing implies earning (the loop never punishes skipping).
     * By default the third placement closes the loop at once; the Loop UI passes `{ close: false }` and
     * calls closeLoop() itself when the water-cycle animation has gone round (SPEC §4.3 order).
     */
    place(id: LightId, opts?: { close?: boolean }): boolean {
      if (state.placed.includes(id)) return false;
      const lights = state.lights.includes(id) ? state.lights : [...state.lights, id];
      const placed = [...state.placed, id];
      commit({ ...state, lights, placed }, { type: 'placed', id });
      if (placed.length === 3 && !state.loopClosed && opts?.close !== false) commit({ ...state, loopClosed: true }, { type: 'loopClosed' });
      return true;
    },
    /** Close the loop for good. Also the end-of-scroll path for visitors who skipped the rituals: every light
     *  is filled in quietly with the close, so the closed brush circle never shows a missing dot. */
    closeLoop() {
      if (state.loopClosed) return;
      const lights = [...state.lights];
      for (const id of ['love', 'gratitude', 'forgive'] as LightId[]) if (!lights.includes(id)) lights.push(id);
      commit({ ...state, lights, loopClosed: true }, { type: 'loopClosed' });
    },
    visit(id: StationId) {
      if (state.visited.includes(id)) return;
      commit({ ...state, visited: [...state.visited, id] }, { type: 'visited', id });
    },
    setSound(on: boolean) {
      if (state.sound === on) return;
      commit({ ...state, sound: on }, { type: 'sound', on });
    },
    reset() {
      const s = fresh();
      s.sound = state.sound;
      commit(s, { type: 'reset' });
    },
  };
}

export type Game = ReturnType<typeof createGame>;
