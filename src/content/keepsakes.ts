// Keepsakes (SPEC.md §4.2). 10 total. Stories use only facts Jay confirmed (SPEC §15.1) or the résumé PDF;
// no invented first-person anecdotes. The paper-boat line is a neutral default until Jay writes one (§4.2).
import type { ChapterId } from './story';

export interface KeepsakeDef {
  id: KeepsakeId;
  chapter: ChapterId;
  title: string;
  story: string;
  /** Shown in the Satchel while not yet found. */
  hint: string;
  hidden?: boolean;
}

export type KeepsakeId =
  | 'paper-boat'
  | 'oil-paper-umbrella'
  | 'grandparents-window'
  | 'three-lanterns'
  | 'sea-glass'
  | 'friends-lanterns'
  | 'red-lantern'
  | 'deans-list-letter'
  | 'rain-umbrella'
  | 'pudding-cup';

export const KEEPSAKES: KeepsakeDef[] = [
  {
    id: 'paper-boat',
    chapter: 'river',
    title: 'A paper boat',
    story: 'On the Yangtze. This is where the journey starts.',
    hint: 'Something small is floating near the bank.',
  },
  {
    id: 'oil-paper-umbrella',
    chapter: 'river',
    title: 'An oil-paper umbrella',
    story: 'Plum rain season in Jiangsu: soft rain that goes on for weeks.',
    hint: 'Someone left something under the eaves.',
  },
  {
    id: 'grandparents-window',
    chapter: 'river',
    title: 'My grandparents’ window',
    story:
      'My grandparents raised me through my earliest years, and they have supported me ever since. I’m grateful to them for more than I can write here.',
    hint: 'One window in the courtyard is still lit.',
  },
  {
    id: 'three-lanterns',
    chapter: 'crossing',
    title: 'Three lanterns, tied together',
    story:
      'My parents and I crossed together in 2019. My parents and grandparents have always been my greatest supporters, through every up and down.',
    hint: 'Look beside the boat.',
  },
  {
    id: 'sea-glass',
    chapter: 'crossing',
    title: 'Sea glass',
    story: 'Worn smooth by the sea. The hard parts round off, given time.',
    hint: 'Something glints under the surface.',
    hidden: true,
  },
  {
    id: 'friends-lanterns',
    chapter: 'coast',
    title: 'A bundle of friends’ lanterns',
    story:
      'Orange County sits at 33.7° N, Jiangyin at 31.9° N: nearly the same latitude, an ocean apart. My high-school friends made adapting to a new culture much easier. I’m grateful to every one of them.',
    hint: 'Friends’ lights gather by the boat.',
  },
  {
    id: 'red-lantern',
    chapter: 'rain',
    title: 'A red lantern',
    story: 'As a student leader of the Chinese Student Organization, I led cross-functional marketing initiatives reaching 2,000+ students.',
    hint: 'A red light glows through the rain.',
  },
  {
    id: 'deans-list-letter',
    chapter: 'rain',
    title: 'A Dean’s List letter',
    story: 'Applied & Computational Mathematical Sciences, Discrete Math & Algorithms. GPA 3.70.',
    hint: 'A letter is pinned somewhere dry.',
  },
  {
    id: 'rain-umbrella',
    chapter: 'rain',
    title: 'A rain-soaked umbrella',
    story: 'Seattle teaches you to stop waiting for the rain to end.',
    hint: 'Someone forgot their umbrella on a bench.',
  },
  {
    id: 'pudding-cup',
    chapter: 'workshop',
    title: 'A pudding cup',
    story: 'Creme Pudding Pet Shop, the e-commerce startup I founded and run.',
    hint: 'Something sweet is hiding on the shelf.',
    hidden: true,
  },
];
