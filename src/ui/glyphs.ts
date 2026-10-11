// Small ink glyphs, one per keepsake (and the moon), drawn as brush-weight line marks on a 24px grid.
// Used by the DOM mirrors (hotspots.ts) in place of a radio-style dot, and by the Satchel as the silhouette of a
// keepsake not yet found (SPEC §4.2). Decorative only: every caller pairs a glyph with a text label.
const PATHS: Record<string, string> = {
  // a folded paper boat on a line of water
  'paper-boat': '<path d="M3 14h18l-3.5 4.5h-11z"/><path d="M12 4.5v9.5M12 4.5l5 9.5M12 4.5l-4.2 9.5"/><path d="M2.5 21c2-.9 3.4-.9 5 0s3.4.9 5 0 3.4-.9 5 0 2.6.6 4-.2"/>',
  // an oil-paper umbrella, ribs showing, held open
  'oil-paper-umbrella': '<path d="M2.5 11.5C4 6.5 7.6 4 12 4s8 2.5 9.5 7.5"/><path d="M2.5 11.5c1.6-1 3.1-1 4.7 0 1.6-1 3.2-1 4.8 0 1.6-1 3.2-1 4.8 0 1.6-1 3.1-1 4.7 0"/><path d="M12 4v15.2c0 1.2-.8 1.8-1.7 1.8s-1.6-.6-1.6-1.5"/><path d="M12 4l-4.8 7.5M12 4l4.8 7.5"/>',
  // a lattice window, lit
  'grandparents-window': '<rect x="4.5" y="4" width="15" height="16" rx="1"/><path d="M12 4v16M4.5 12h15M8.2 4v16M15.8 4v16"/>',
  // three lanterns tied on one cord
  'three-lanterns': '<path d="M3 4.5c3 1.6 15 1.6 18 0"/><path d="M6 6v2M12 7v2M18 6v2"/><ellipse cx="6" cy="11.5" rx="2.3" ry="3.2"/><ellipse cx="12" cy="12.5" rx="2.3" ry="3.2"/><ellipse cx="18" cy="11.5" rx="2.3" ry="3.2"/><path d="M6 14.7v2M12 15.7v2.6M18 14.7v2"/>',
  // a worn, rounded shard of sea glass
  'sea-glass': '<path d="M7 6.5c2.6-2 7.2-2.4 9.6-.4 2.6 2.2 3 6.6 1.2 9.8-1.8 3.2-6.4 4.6-9.6 3-3.4-1.7-4.6-5.6-3.6-8.6.4-1.4 1.2-2.8 2.4-3.8z"/><path d="M9.5 9.2c.8-.9 2-1.3 3.1-1.2"/>',
  // a bundle of lanterns gathered at the cords
  'friends-lanterns': '<path d="M12 3v4M12 7l-5 3M12 7l5 3M12 7v3.2"/><ellipse cx="6.5" cy="13" rx="2.2" ry="3"/><ellipse cx="12" cy="14" rx="2.4" ry="3.3"/><ellipse cx="17.5" cy="13" rx="2.2" ry="3"/><path d="M6.5 16v1.8M12 17.3v2.4M17.5 16v1.8"/>',
  // one round lantern with cap, base and tassel
  'red-lantern': '<path d="M12 2.5v2.5"/><path d="M9 5h6M9 19h6"/><path d="M9.2 5C5.6 6.8 5 10 5 12s.6 5.2 4.2 7h5.6C18.4 17.2 19 14 19 12s-.6-5.2-4.2-7z"/><path d="M12 5c-1.8 2-2.4 4.4-2.4 7s.6 5 2.4 7M12 5c1.8 2 2.4 4.4 2.4 7s-.6 5-2.4 7"/><path d="M12 19v2.8"/>',
  // a folded letter with a seal
  'deans-list-letter': '<rect x="3.5" y="6" width="17" height="12" rx="1"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/><circle cx="12" cy="14.6" r="1.6"/>',
  // a closed umbrella, dripping
  'rain-umbrella': '<path d="M12 3v1.2"/><path d="M12 4.2c-2 2.5-3.2 6.4-3 10.4h6c.2-4-1-7.9-3-10.4z"/><path d="M12 14.6v4.4c0 1.3-.9 2-1.9 2s-1.8-.7-1.8-1.6"/><path d="M17.5 9v1.6M19.5 13v1.6M5 11v1.6"/>',
  // a small pudding cup with a spoon
  'pudding-cup': '<path d="M5.5 10h13l-1.6 9.5H7.1z"/><path d="M5.5 10c.4-2.6 3.2-4.2 6.5-4.2s6.1 1.6 6.5 4.2"/><path d="M14.5 6.2l4.5-3.4"/>',
  // a crescent moon
  moon: '<path d="M15.5 3.8a8.5 8.5 0 1 0 4.7 13.6A7 7 0 0 1 15.5 3.8z"/>',
};

/** Inline SVG for a keepsake glyph (stroke = currentColor). Unknown ids get a plain ring. */
export function glyph(id: string, cls = 'glyph-ink'): string {
  const body = PATHS[id] ?? '<circle cx="12" cy="12" r="6"/>';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
