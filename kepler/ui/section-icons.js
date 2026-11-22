// Пиктограммы общих действий чертежа. Доступное название задаёт кнопка.
const paths = {
  section: 'M3 19h18M5 16V7l7-4 7 4v9M6 12h12M11 7v9',
  elevation: 'M2 20h20M5 17V8l7-5 7 5v9M8 9h2v3H8zM14 9h2v3h-2zM11 17v-3h2v3',
  terrain: 'M2 16l6-7 4 3 5-6 5 4M3 19h18',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  split: 'M3 5h18v14H3zM3 12h18',
  full: 'M3 5h18v14H3z',
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
  back: 'M19 12H5m6-6-6 6 6 6',
  more: 'M5 12h1m5 0h1m5 0h1',
};
export function sectionIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;
}
