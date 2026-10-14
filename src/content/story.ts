// Story content: the beat ledger from SPEC.md §3 as data.
// Renderer code must read copy from here, never hard-code it.

export type ChapterId =
  | 'prologue'
  | 'river'
  | 'crossing'
  | 'coast'
  | 'rain'
  | 'workshop'
  | 'loop'
  | 'next';

export interface Chapter {
  id: ChapterId;
  /** Viewport heights of scroll this chapter's <section> occupies. */
  scrollWeight: number;
  eyebrow: string;
  /** Calligraphic CJK accent shown large and sparse (Ma Shan Zheng), optional. */
  seal?: string;
  title: string;
  body: string[];
  /** Mono detail line: coordinates, years. */
  coords?: string;
  /** Atlas / journey-track station this chapter belongs to. */
  station: StationId;
  /** Odometer km at chapter start and end (exact scroll drives it). */
  km: [number, number];
}

export type StationId = 'jiangyin' | 'pacific' | 'oc' | 'seattle' | 'next';

export const STATIONS: { id: StationId; label: string; cjk?: string; lat: number; lon: number }[] = [
  { id: 'jiangyin', label: 'Jiangyin', cjk: '江阴', lat: 31.92, lon: 120.27 },
  { id: 'pacific', label: 'Pacific', lat: 33.0, lon: -170.0 },
  { id: 'oc', label: 'Orange County', lat: 33.68, lon: -117.83 },
  { id: 'seattle', label: 'Seattle', lat: 47.655, lon: -122.308 },
  { id: 'next', label: 'Next', lat: 47.655, lon: -122.308 },
];

// Great-circle distances (haversine, R = 6371 km), computed from STATIONS coords:
// Jiangyin -> Orange County ≈ 10,518 km; Orange County -> Seattle ≈ 1,598 km.
export const KM_JIANGYIN_TO_OC = 10518;
export const KM_OC_TO_SEATTLE = 1598;
export const KM_TOTAL = KM_JIANGYIN_TO_OC + KM_OC_TO_SEATTLE;

export const PERSON = {
  name: 'Jiayi Zhu',
  email: 'jyzyo04@gmail.com',
  github: 'https://github.com/svedison',
  linkedin: 'https://www.linkedin.com/in/jiayi-zhu-549884298/',
  /** Relative to the site base (public/). Prefix with import.meta.env.BASE_URL (or withBase in static.ts) at use sites. */
  resumePdf: 'Jiayi-Zhu-Resume.pdf',
  graduation: 'June 2027',
  available: 'Summer 2027',
};

export const WELLBEING_LINE = 'Currently building an app for the future of personal well-being.';

export const THREE_WORDS = [
  { id: 'love', en: 'Love', cjk: '爱', water: 'river', color: '--lantern' },
  { id: 'gratitude', en: 'Gratitude', cjk: '感恩', water: 'sea', color: '--sea-teal' },
  { id: 'forgive', en: 'Forgive', cjk: '原谅', water: 'rain', color: '--rain-silver' },
] as const;
export type LightId = (typeof THREE_WORDS)[number]['id'];

export const CHAPTERS: Chapter[] = [
  {
    id: 'prologue',
    scrollWeight: 1.4,
    eyebrow: 'Jiangyin, Jiangsu',
    seal: '江阴',
    title: 'The long way here.',
    body: [
      'Jiayi Zhu. Born beside the Yangtze, studying math + CS in Seattle, graduating June 2027. This is how I got here. Take the boat.',
    ],
    coords: '31.92° N · 120.27° E',
    station: 'jiangyin',
    km: [0, 0],
  },
  {
    id: 'river',
    scrollWeight: 1.6,
    eyebrow: '01 / Where it starts',
    seal: '爱',
    title: 'Born beside the Yangtze, 2004.',
    body: [
      'I was born in Jiangyin, a river city in Jiangsu, in 2004. I spent much of my early childhood with my grandparents. That’s where love started for me.',
    ],
    coords: '31.92° N · 120.27° E · 长江',
    station: 'jiangyin',
    km: [0, 0],
  },
  {
    id: 'crossing',
    scrollWeight: 1.6,
    eyebrow: '02 / The crossing · 2019',
    title: 'Across the Pacific, together.',
    body: [
      'In 2019 my parents and I crossed the Pacific so I could go to high school in the United States. My parents and grandparents have always been my greatest supporters, through every up and down.',
      'The first year was hard. I didn’t have the language yet.',
    ],
    coords: 'Pacific Ocean',
    station: 'pacific',
    km: [0, KM_JIANGYIN_TO_OC],
  },
  {
    id: 'coast',
    scrollWeight: 1.0,
    eyebrow: '03 / Orange County · 2019–2023',
    seal: '感恩',
    title: 'Nearly the same latitude. A new language.',
    body: [
      'Orange County, 2019–2023. The friends I made here made a new language and a new culture feel like home. I’m grateful to every one of them.',
    ],
    coords: '33.68° N · 117.83° W',
    station: 'oc',
    km: [KM_JIANGYIN_TO_OC, KM_JIANGYIN_TO_OC],
  },
  {
    id: 'rain',
    scrollWeight: 2.4,
    eyebrow: '04 / Seattle · University of Washington',
    seal: '原谅',
    title: 'Then it started raining.',
    body: [
      'University of Washington, Applied & Computational Mathematical Sciences: Discrete Math & Algorithms. Dean’s List. I helped lead the Chinese Student Organization, reaching 2,000+ students.',
      'Forgiveness falls like rain, on everyone, and lets love grow again.',
    ],
    coords: '47.655° N · 122.308° W',
    station: 'seattle',
    km: [KM_JIANGYIN_TO_OC, KM_TOTAL],
  },
  {
    id: 'workshop',
    scrollWeight: 2.8,
    eyebrow: '05 / What I build',
    title: 'Pipelines, golden records, and a pet shop.',
    body: [
      'Three software engineering internships centered on data platforms and pipelines, a hackathon, a small business, and something new that is still growing. Pick anything up.',
    ],
    coords: 'Seattle · Bellevue · Jacksonville',
    station: 'seattle',
    km: [KM_TOTAL, KM_TOTAL],
  },
  {
    id: 'loop',
    scrollWeight: 1.6,
    eyebrow: '06 / The loop',
    title: 'Love. Gratitude. Forgive.',
    body: [
      'When there is love, gratitude grows. Gratitude makes room for forgiveness. Forgiveness lets love thrive again. I practice these three words every day. They are a circle.',
    ],
    coords: 'river → sea → rain → river',
    station: 'next',
    km: [KM_TOTAL, KM_TOTAL],
  },
  {
    id: 'next',
    scrollWeight: 1.2,
    eyebrow: '07 / Next shore',
    title: 'Graduating June 2027.',
    body: [
      'I graduate in June 2027 and can start Summer 2027. Right now, I’m building an app for the future of personal well-being.',
    ],
    coords: 'Dawn · the next shore',
    station: 'next',
    km: [KM_TOTAL, KM_TOTAL],
  },
];

export const MOON_POEM = {
  zh: '海上生明月，天涯共此时。',
  en: 'Over the sea the bright moon rises; though far apart, we share this moment.',
  attribution: 'Zhang Jiuling (张九龄), Tang dynasty',
  /** The moon hotspot's name (3D hotspot in the crossing, its DOM mirror, and the no-JS card). */
  label: 'The moon',
  /** Tooltip on the moon's DOM mirror. */
  hint: 'Look up',
  /** The line under the poem: the current time in Jiangyin, or just the refrain if the clock is unavailable. */
  now: (time: string) => `It’s ${time} in Jiangyin right now. Same moon.`,
  nowFallback: 'Same moon.',
  close: 'Close',
};

/** Ch.3 coast: the latitude comparison (SPEC §2) in words, for readers who cannot see the drawn latitude line.
 *  Figures come from STATIONS. */
export const LATITUDE_LINE = (a: { label: string; lat: number }, b: { label: string; lat: number }) =>
  `${a.label}, ${a.lat.toFixed(1)}° N. ${b.label}, ${b.lat.toFixed(1)}° N. Nearly the same latitude, on opposite sides of the Pacific.`;

/** Prologue calls to action. */
export const PROLOGUE_CTA = {
  begin: 'Begin',
  skip: 'Skip to Logbook',
};

/** Ch.7 Next shore: the contact block under the headline (facts come from PERSON). */
export const SHORE_COPY = {
  available: 'Available to start',
  hello: 'Say hello',
  elsewhere: 'Elsewhere',
  logbook: 'Logbook',
  resume: 'Résumé (PDF)',
  github: 'GitHub',
  linkedin: 'LinkedIn',
};

/** Footer credits. The Poem row is followed by MOON_POEM.zh and MOON_POEM.attribution. */
export const COLOPHON = {
  rows: {
    type: { term: 'Type', text: 'Newsreader, IBM Plex Mono, Ma Shan Zheng and Noto Serif SC, via Google Fonts (SIL Open Font License)' },
    poem: { term: 'Poem', text: 'Public domain.' },
    world: { term: 'World', text: 'Drawn in code with three.js. Nothing you type in the rain is sent or stored.' },
    sound: { term: 'Sound', text: 'Synthesized live in the browser with the Web Audio API. No recordings. Off until you turn it on.' },
  },
  copyright: (name: string) => `© 2026 ${name}`,
};

/** Ch.4 letting-go ritual (ui/forgive.ts). The line on the sheet is the rain chapter's forgive line. */
export const FORGIVE_COPY = {
  label: 'Something you want to let go of',
  note: '(optional, never sent or saved)',
  letGo: 'Let go',
  earned: ': earned',
  again: 'Let go of something else',
};

/** Ch.4 in-world beat captions (ui/forgive.ts): the quad's seasons as time passing at UW, and the CSO lantern
 *  release (from the red-lantern keepsake and the chapter body). No years: start dates are not in the sources. */
export const RAIN_BEATS = {
  kicker: 'The seasons turn at UW',
  seasons: ['Spring on the quad', 'Summer', 'Fall', 'Winter'] as const,
  again: 'Spring, again',
  lantern: 'Chinese Student Organization · 2,000+ students',
};

/** Ch.6 Close the loop (ui/loopUI.ts). */
export const LOOP_COPY = {
  kicker: 'Close the loop',
  /** The water cycle between stations, in SPEC §2's own words, keyed by the station it leaves. */
  arcs: { love: 'runs to the sea', gratitude: 'rises into cloud', forgive: 'rains again' },
  hint: 'Drag each light to its place on the ring, or tap a light and then its place.',
  closing: 'All three are home. Watch the water go round.',
  closed: 'The loop is closed. Love, gratitude, forgive: river, sea, rain, and back to the river.',
  picked: (en: string) => `${en} picked up. Now choose its place on the ring.`,
  wrong: (en: string, cjk: string, water: string) => `Not there. ${en} (${cjk}) belongs to the ${water}.`,
  placed: (en: string, cjk: string, water: string) => `${en} (${cjk}) is on the ${water}.`,
  tokenPlaced: (en: string, cjk: string, water: string) => `${en} light (${cjk}), on the ${water}`,
  tokenOpen: (en: string, cjk: string, earned: boolean) =>
    `${en} light (${cjk})${earned ? '' : ', not yet earned: placing it earns it'}. Pick up`,
  stationFilled: (water: string, en: string, cjk: string) => `${water}: ${en} (${cjk}) is here`,
  stationArmed: (picked: string, water: string, en: string, cjk: string) =>
    `Place ${picked} on the ${water}, the place for ${en} (${cjk})`,
  stationIdle: (water: string, en: string, cjk: string) => `${water}: the place for ${en} (${cjk}). Pick a light first`,
  pickFirst: (water: string, en: string) => `${water}: the place for ${en}. Pick a light first.`,
};

/** Easter eggs (ui/eggs.ts, SPEC §4.5). */
export const EGG_COPY = {
  dryCaption: 'Rare: it’s dry in Seattle right now.',
  /** Restates the résumé's CSO figure (resume.ts): 2,000+ students. */
  lanternCaption: 'Students reached: 2,000+',
  lanternLabel: 'Students reached',
  /** The counter tops out at the résumé's number and never passes it. */
  lanternTop: 2000,
};
