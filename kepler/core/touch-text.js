// Подсказки и сообщения для телефона. Тексты в коде написаны для мыши и
// клавиатуры («Кликните начало оси · Shift — без привязки · Esc — отмена»,
// «… · Ctrl+Z — вернуть»). На телефоне: клик → тап, клавиши-модификаторы и
// горячие клавиши убираются, «Esc — выход» → «Готово — выход» (кнопка в
// нижнем ряду или на плане), «Ctrl+Z» → «⟲» (кнопка в шапке).
//
// Текст режется на части: « · » → «. » → «, ». Часть с клавишей выбрасывается
// целиком, кроме выхода и окончания:
//   «Esc — выход/выйти» → ««Готово» — выход/выйти», если включён инструмент;
//   «Enter или двойной клик — завершить/закончить/готово» → ««Готово» —
//   закончить», если «Готово» и правда заканчивает (цепочка стен, контур);
//   «Esc или тап мимо — закрыть» → «тап мимо — закрыть».
// ctx: { tool — включён инструмент, finish — «Готово» заканчивает, а не отменяет }.

// Клавиши и жесты мыши, которых на телефоне нет.
const KEYS = /\b(?:Esc|Enter|Shift|Ctrl|Alt|Tab|Backspace|Delete|Del|F\d{1,2})\b|Пробел|правая кнопка|правой кнопк|двойн\S*\s+клик|клавиш|[Цц]ифр/;
const HOTKEY = /^\s*[A-Z](?:\s|$)/; // «K — новая крыша», «R — повернуть»
const EXIT = /—\s*(выход|выйти)\s*$/;
const FINISH = /—\s*(?:закончить|завершить|готово)\s*$/;

// Быстрая проверка: есть ли что переводить.
export const TOUCH_WORTH = /[Кк]лик|\b(?:Esc|Enter|Shift|Ctrl|Alt|Tab|Backspace|Delete|Del|F\d{1,2})\b|Пробел|колес|двойн|правая кнопка|\([A-Z]\)/;

function touchPart(part, ctx) {
  if (/\b(?:Esc|Enter)\b/.test(part)) {
    const exit = !/\bEnter\b/.test(part) && part.match(EXIT);
    if (exit) return ctx.tool ? `«Готово» — ${exit[1]}` : '';
    if (FINISH.test(part)) return ctx.finish ? '«Готово» — закончить' : '';
    part = part.replace(/\b(?:Esc|Enter)\s+или\s+/g, '');
  }
  return KEYS.test(part) || HOTKEY.test(part) ? '' : part;
}

const keep = (list, sep) => list.filter((s) => s.trim()).join(sep);

export function touchText(text, ctx = {}) {
  if (!text || !TOUCH_WORTH.test(text)) return text;
  let t = String(text)
    .replace(/Ctrl\+Shift\+Z/g, '⟳')
    .replace(/Ctrl\+Z/g, '⟲')
    .replace(/\s+или\s+(?:Alt|Shift|Ctrl)\+клик\S*/g, '') // «клик мимо или Alt+клик — контур»
    .replace(/\s+или\s+(?:Esc|Enter)\b/g, '') // «кликайте дальше или Esc», «клик по первой точке или Enter — замкнуть»
    .replace(/\s*—\s*Enter\s+[^\s,·]+/g, '') // «Высота, мм — Enter применить»
    .replace(/\s*—\s*Ctrl\+V[^·]*/g, '') // «Скопировано — Ctrl+V вставит рядом»
    .replace(/Двигайте по плану и кликните/g, 'Тапните на плане')
    // скобки с клавишей: «(или Enter)», «(Alt — прямые углы)», «(S)», «(Shift+A)»
    .replace(/\s*\(([^()]*)\)/g, (m, inner) => (KEYS.test(inner) || /^\s*[A-Z]\s*$/.test(inner) ? '' : m));
  const seen = new Set();
  t = keep(t.split(' · ').map((seg) => keep(seg.split('. ').map((sentence) => keep(sentence.split(', ')
    .map((part) => touchPart(part, ctx)), ', ')), '. ')).filter((seg) => {
    if (seen.has(seg)) return false; // «Готово» — один раз
    seen.add(seg);
    return true;
  }), ' · ');
  t = t
    // клик → тап со всеми окончаниями; «клики» → «тапы»
    .replace(/(^|[^а-яёА-ЯЁ])([Кк])лик([а-яё]*)/g, (m, pre, k, end) => `${pre}${k === 'К' ? 'Т' : 'т'}ап${end === 'и' ? 'ы' : end}`)
    .replace(/колес[оа]м?(?:\s+мыши)?/g, 'два пальца')
    .replace(/\s+в панели справа/g, ' в «Свойствах»')
    .replace(/из библиотеки слева/g, 'из каталога')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[·,.—\s]+|[·,—\s]+$/g, '');
  return t || text; // всё про клавиши — пусть остаётся как было
}
