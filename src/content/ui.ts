// Interface microcopy: labels, hints, confirmations and live-region announcements for the HUD, overlays
// and game UI. Data only (plus tiny formatters for strings that carry a number or a name). Story copy
// lives in story.ts; résumé facts in resume.ts. Renderers read these; they never hard-code copy.

export const HUD_COPY = {
  controls: 'Journey controls',
  home: (name: string) => `${name}: back to the start`,
  lights: 'Lights earned',
  lightNotYet: 'not yet',
  lightEarned: 'earned',
  /** The legend under the three dots (hover / focus): what they are and what they add up to. */
  lightsLegendTitle: 'Three lights',
  lightsLegendNote: 'Earn all three to close the circle.',
  /** Shown for 2 s beside the dots when one is earned (live.ts announces it to screen readers). */
  lightCaption: (cjk: string, en: string) => `${cjk} ${en}: earned`,
  /** The Loop chapter's start meta carries the water cycle, not coordinates. */
  cycle: 'The cycle',
  tools: 'Tools',
  satchel: (n: number, total: number) => `Satchel: ${n} of ${total} keepsakes found`,
  menu: 'Menu',
  sound: 'Sound',
  soundTitle: 'Sound (S)',
  atlas: 'Atlas',
  atlasTitle: 'Atlas (M)',
  /** Phones: the bottom bar's current-station button opens the Atlas. */
  atlasHere: (place: string) => `${place}. Open the Atlas`,
  logbook: 'Logbook',
  logbookTitle: 'Logbook (L)',
  resumePdf: 'Résumé (PDF)',
  journey: 'Journey',
  position: 'Position',
  travelled: 'Travelled',
  localTime: 'Local time',
  nextShore: 'Next shore',
  /** The prologue's two clocks. */
  clocks: { jiangyin: 'Jiangyin', seattle: 'Seattle' },
};

export const TALLY_COPY = {
  found: 'keepsakes found',
  lights: 'Lights earned',
  replay: 'Replay the journey',
  reset: 'Reset',
  confirm: 'Clear every keepsake and light, and start fresh?',
  yes: 'Yes, reset',
  keep: 'Keep everything',
  earned: ' (earned)',
  notYet: ' (not yet)',
  back: (n: number, total: number) => `Back to the start. Your ${n} of ${total} keepsakes are kept.`,
  lookCloser: 'Look closer',
  seed: (line: string) => `The seed under glass. ${line}`,
};

export const HOTSPOT_COPY = {
  group: 'Keepsakes in this chapter',
  hidden: (hint: string) => `Hidden keepsake. ${hint}`,
  found: 'Keepsake found: ',
  open: 'Keepsake: ',
  releaseLantern: (title: string) => `${title}: release one more lantern`,
  inSatchel: (title: string) => `${title}: in your satchel`,
  somethingHidden: 'Something hidden',
  pickUp: 'Pick it up',
  /** Appended to a mirror whose 3D object is out of view right now (it still works from here). */
  dormant: 'not in view right now, still works from here',
  /** The moon's mirror while the sky has no moon (under water, at dawn). */
  moonDormant: 'not in the sky right now, still works from here',
};

export const LIVE_COPY = {
  keepsake: (title: string, n: number, total: number) => `Keepsake found: ${title}. ${n} of ${total}.`,
  light: (en: string, n: number) => `Light earned: ${en}. ${n} of 3.`,
  loopClosed: 'The loop is closed. Love, gratitude, forgive.',
  reset: 'Journey reset. Keepsakes and lights cleared.',
  arrived: (place: string) => `Arrived: ${place}.`,
  welcomeBack: (n: number, total: number) => `Welcome back. You found ${n} of ${total}.`,
};

export const SATCHEL_COPY = {
  title: 'Satchel',
  of: (total: number) => `of ${total} keepsakes`,
  close: 'Close satchel',
  reset: 'Reset progress',
  confirm: 'Empty the satchel and start the journey fresh?',
  yes: 'Yes, reset',
  keep: 'Keep everything',
  notFound: 'Not found yet',
  goThere: 'Go there',
  /** Group headings for chapters whose station label is not the right name. */
  workshop: 'The workshop',
  crossing: 'The crossing',
};

export const ATLAS_COPY = {
  title: 'Atlas',
  sub: 'The ink clears where you have been. Choose a place to travel there.',
  close: 'Close atlas',
  latitude: 'Nearly the same latitude.',
  latitudeFigures: '31.9° N · 33.7° N',
  km: 'km, the long way here',
  legs: (jyToOc: string, ocToSea: string) =>
    `Jiangyin → Orange County ${jyToOc} km · Orange County → Seattle ${ocToSea} km · great-circle`,
  legend: 'Map key',
  keepsakeFound: 'Keepsake found',
  stillOut: 'Still out there',
  notVisited: 'Not yet visited',
  nextShore: 'Next shore',
  yangtze: 'Yangtze',
  pacific: 'Pacific Ocean',
  visited: 'Visited',
  fog: 'In the fog',
  count: (found: number, n: number) => `${found} of ${n} keepsake${n > 1 ? 's' : ''}`,
  stationAria: (name: string, isHere: boolean, visited: boolean, found: number, n: number) =>
    `${name}${isHere ? ', you are here' : ''}. ${visited ? 'Visited' : 'Not yet visited'}.${n ? ` ${found} of ${n} keepsakes found.` : ''} Travel here.`,
};

export const LOGBOOK_COPY = {
  title: 'Logbook',
  openPage: 'Open as a page',
  close: 'Close',
  index: 'Logbook index',
  kicker: 'Logbook · Résumé',
  sections: {
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
    contact: 'Contact',
  },
  onShelf: 'On the shelf',
  download: 'Download résumé',
  pdf: 'PDF',
  graduating: 'Graduating',
  available: 'Available',
  email: 'Email',
  github: 'GitHub',
  linkedin: 'LinkedIn',
  resume: 'Résumé',
  /** Workshop inspect card. */
  hintTouch: 'Drag to turn it · pinch to look closer',
  hintDesk:
    'Drag or <kbd>←</kbd> <kbd>→</kbd> to turn · <kbd>+</kbd> <kbd>−</kbd> or the wheel to look closer · <kbd>Esc</kbd> puts it back',
  moreBelow: 'More below',
  putBack: 'Put it back',
  readInLogbook: 'Read in the Logbook',
  pickUp: 'click to pick it up',
  shortSkills: 'Skills',
  shortEducation: 'UW',
};

export const AUDIO_COPY = {
  off: 'Sound off',
  turnOn: 'Turn sound on',
  locked: 'Sound off, tap to enable',
  on: 'Sound on',
  turnOff: 'Turn sound off',
};
