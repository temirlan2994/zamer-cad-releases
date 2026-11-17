// Телефон: подсказки и сообщения без клавиатуры и мыши (core/touch-text.js).
// Подсказка на плане, подсказка 3D и всплывающие сообщения хранят исходный
// текст — его сравнивает код (например, «эта подсказка ещё моя?»); вариант для
// пальцев кладётся в data-touch и показывается вместо текста (styles.css).
// В «Свойствах», каталоге, замечаниях и строке параметров текст заменяется на
// месте при каждой перерисовке. На компьютере ничего не меняется.

import { TOUCH_WORTH, touchText } from '../core/touch-text.js';

const MIRRORED = ['canvasHint', 'v3Hint', 'toast'];

// opts: { isPhone(), context() → { tool, finish } }
export function bindTouchHints({ isPhone, context }) {
  const mirror = (node) => {
    const raw = node.textContent;
    const touch = isPhone() ? touchText(raw, context()) : raw;
    if (touch && touch !== raw) { if (node.dataset.touch !== touch) node.dataset.touch = touch; } else if ('touch' in node.dataset) delete node.dataset.touch;
  };
  const rewrite = (root) => {
    if (!isPhone()) return;
    const ctx = context();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!TOUCH_WORTH.test(n.nodeValue)) continue;
      const next = touchText(n.nodeValue, ctx);
      if (next !== n.nodeValue) n.nodeValue = next; // characterData — наблюдатель (childList) не зовётся снова
    }
  };
  for (const id of MIRRORED) {
    const node = document.getElementById(id);
    if (!node) continue;
    new MutationObserver(() => mirror(node)).observe(node, { childList: true, characterData: true, subtree: true });
    mirror(node);
  }
  const roots = ['propsBody', 'toolOptionsBody', 'issuesPanel'].map((id) => document.getElementById(id));
  roots.push(document.querySelector('.library'));
  for (const root of roots.filter(Boolean)) {
    new MutationObserver(() => rewrite(root)).observe(root, { childList: true, subtree: true });
    rewrite(root);
  }
}
