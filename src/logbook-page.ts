// Standalone /logbook/ page: static HTML is complete without this; JS only adds the rail scroll-spy and Print.
import './styles/logbook.css';
import { enhanceLogbook } from './ui/logbook';

const root = document.querySelector<HTMLElement>('[data-logbook]');
if (root) enhanceLogbook(root, null);

const print = document.querySelector<HTMLButtonElement>('[data-print]');
if (print) {
  print.hidden = false;
  print.addEventListener('click', () => window.print());
}
