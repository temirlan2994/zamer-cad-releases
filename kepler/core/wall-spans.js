// Участки стены: толщина, тип и скрытие на ЧАСТИ стены (выделенный участок),
// а не на всём ключе. Чистый модуль без DOM и без импортов (его читает
// core/walls.js).
//
// wallOverrides[key] = { thickness?, kind?, hidden?, top?, spans?: [
//   { orient: 'h' | 'v', from, to, thickness?, kind?, hidden? }, …] }
//
// • from/to — вдоль оси стены, от начала НОМИНАЛЬНОЙ формы комнаты-хозяина
//   ключа ('e|room|side' — сама комната, 's|a|b' — комната a): перенос
//   комнаты везёт участок с собой, съедание (видимая форма) его не сдвигает.
// • Значения участка перекрывают значения ключа; старые записи без spans
//   читаются как раньше (весь ключ).
// • Толщина общей стены — зазор пары комнат (sharedWallThickness), участок
//   её не задаёт: у 's|…' в spans бывают только kind и hidden.

export const SPAN_PROPS = ['thickness', 'kind', 'hidden'];
const EPS = 1;

const round = (v) => Math.round(v * 2) / 2;

function pick(src) {
  const out = {};
  for (const k of SPAN_PROPS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

const sameProps = (a, b) => SPAN_PROPS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

// Комната-хозяин ключа (id из 'e|id|side' / 's|id|id').
export function spanHostId(key) {
  return String(key || '').split('|')[1] || null;
}

// Начало отсчёта участков: номинальная форма (у съеденной — eatBase.base).
export function spanOrigin(room, orient) {
  const b = room?.eatBase?.base || room;
  if (!b) return 0;
  return orient === 'h' ? Number(b.x) || 0 : Number(b.y) || 0;
}

// Интервал [from, to] (абсолютный, вдоль оси) → куски с итоговым override:
// [{ from, to, override }]. Без участков — один кусок с override ключа.
export function overridePieces(override, origin, orient, from, to) {
  const spans = (override?.spans || []).filter((s) => s && s.orient === orient);
  if (!spans.length) return [{ from, to, override }];
  const cuts = new Set([from, to]);
  for (const s of spans) {
    for (const v of [s.from + origin, s.to + origin]) if (v > from + EPS && v < to - EPS) cuts.add(v);
  }
  const xs = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const a = xs[i]; const b = xs[i + 1];
    const mid = (a + b) / 2 - origin;
    let ov = override;
    for (const s of spans) if (mid > s.from && mid < s.to) ov = { ...ov, ...pick(s) };
    const last = out[out.length - 1];
    if (last && sameProps(last.override, ov)) last.to = b;
    else out.push({ from: a, to: b, override: ov });
  }
  return out;
}

// Склеить соседние одинаковые участки, выбросить пустые.
function normalize(spans) {
  const byOrient = { h: [], v: [] };
  for (const s of spans) if (s && byOrient[s.orient] && s.to - s.from > EPS && Object.keys(pick(s)).length) byOrient[s.orient].push(s);
  const out = [];
  for (const orient of ['h', 'v']) {
    const list = byOrient[orient].sort((a, b) => a.from - b.from);
    for (const s of list) {
      const last = out[out.length - 1];
      if (last && last.orient === orient && Math.abs(last.to - s.from) <= EPS && sameProps(last, s)) last.to = s.to;
      else out.push({ ...s });
    }
  }
  return out;
}

// Записать patch на участок [relFrom, relTo] (от начала хозяина) оси orient.
// → новый override (исходный не меняется).
export function writeSpan(override, orient, relFrom, relTo, patch) {
  const from = round(Math.min(relFrom, relTo));
  const to = round(Math.max(relFrom, relTo));
  const next = [];
  const covered = [];
  for (const s of override?.spans || []) {
    if (!s || s.orient !== orient || s.to <= from + EPS || s.from >= to - EPS) { next.push({ ...s }); continue; }
    if (s.from < from - EPS) next.push({ ...s, to: from });
    if (s.to > to + EPS) next.push({ ...s, from: to });
    const a = Math.max(s.from, from); const b = Math.min(s.to, to);
    next.push({ ...s, from: a, to: b, ...patch });
    covered.push({ from: a, to: b });
  }
  covered.sort((a, b) => a.from - b.from);
  let at = from;
  for (const c of covered) {
    if (c.from - at > EPS) next.push({ orient, from: at, to: c.from, ...patch });
    at = Math.max(at, c.to);
  }
  if (to - at > EPS) next.push({ orient, from: at, to, ...patch });
  const out = { ...(override || {}) };
  const spans = normalize(next);
  if (spans.length) out.spans = spans; else delete out.spans;
  return out;
}

// Значение на весь ключ: patch в сам override, из участков эти поля убираются.
export function writeWhole(override, patch) {
  const out = { ...(override || {}), ...patch };
  if (out.spans) {
    const spans = normalize(out.spans.map((s) => {
      const c = { ...s };
      for (const k of Object.keys(patch)) delete c[k];
      return c;
    }));
    if (spans.length) out.spans = spans; else delete out.spans;
  }
  return out;
}

// Поворот комнаты на 90° по часовой (core/room-group.js): участки стороны
// переезжают на повёрнутую сторону. h → v: отсчёт тот же; v → h: от
// противоположного конца (oldH — высота комнаты до поворота).
export function turnSpans(override, oldH) {
  if (!override?.spans?.length) return override;
  return {
    ...override,
    spans: override.spans.map((s) => (s.orient === 'h'
      ? { ...s, orient: 'v' }
      : { ...s, orient: 'h', from: round(oldH - s.to), to: round(oldH - s.from) })),
  };
}
