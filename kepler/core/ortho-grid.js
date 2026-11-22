// Сжатая прямоугольная сетка для ортогональной геометрии (без DOM).
// Клетка (i, j) — прямоугольник xs[i]..xs[i+1] × ys[j]..ys[j+1]. Координаты
// округляются до 0,5 мм, чтобы совпадающие грани давали одну линию сетки
// (иначе — щели-волоски).

export function snapHalf(v) {
  return Math.round(v * 2) / 2;
}

// Ось сетки по набору координат: отсортированные уникальные значения
// (с шагом 0,5 мм) и поиск индекса линии по координате.
export function gridAxis(values) {
  const keys = [...new Set(values.map((v) => Math.round(v * 2)))].sort((a, b) => a - b);
  const index = new Map(keys.map((k, i) => [k, i]));
  return { coords: keys.map((k) => k / 2), at: (v) => index.get(Math.round(v * 2)) };
}

// Слияние клеток с одинаковой меткой (label ≥ 0; −1 — пусто) в
// прямоугольники: построчно в полосы, затем одинаковые полосы соседних строк —
// в один прямоугольник. → Map(label → [{ x, y, w, h }]).
export function mergeCells(label, xs, ys) {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const out = new Map();
  let open = new Map();
  for (let j = 0; j < ny; j += 1) {
    const next = new Map();
    let i = 0;
    while (i < nx) {
      const lab = label[j * nx + i];
      if (lab < 0) { i += 1; continue; }
      let i1 = i + 1;
      while (i1 < nx && label[j * nx + i1] === lab) i1 += 1;
      const key = `${lab}|${i}|${i1}`;
      let rect = open.get(key);
      if (rect) rect.h = ys[j + 1] - rect.y;
      else {
        rect = { x: xs[i], y: ys[j], w: xs[i1] - xs[i], h: ys[j + 1] - ys[j] };
        if (!out.has(lab)) out.set(lab, []);
        out.get(lab).push(rect);
      }
      next.set(key, rect);
      i = i1;
    }
    open = next;
  }
  return out;
}

// Контуры области клеток (filled[k] ≠ 0). Обход — занятые клетки справа
// (по часовой на экране, ось Y вниз); в «щипке» (две клетки по диагонали)
// поворачиваем к своей клетке — циклы простые, без восьмёрок.
// → [{ pts, area }]: area > 0 — внешний контур, < 0 — дыра.
export function traceCycles(filled, xs, ys) {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const W = nx + 1;
  const out = new Map(); // вершина → [направления]; 0 E, 1 S, 2 W, 3 N
  const add = (i, j, d) => {
    const v = j * W + i;
    const list = out.get(v);
    if (list) list.push(d); else out.set(v, [d]);
  };
  const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && filled[j * nx + i] !== 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(i, j, 0);
      if (!on(i + 1, j)) add(i + 1, j, 1);
      if (!on(i, j + 1)) add(i + 1, j + 1, 2);
      if (!on(i - 1, j)) add(i, j + 1, 3);
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const cycles = [];
  for (const [startV, startList] of out) {
    while (startList.length) {
      const startDir = startList.pop();
      const pts = [];
      let v = startV;
      let dir = startDir;
      let prevDir = -1;
      for (let guard = 0; guard < 4 * (nx + 1) * (ny + 1) + 8; guard += 1) {
        if (dir !== prevDir) pts.push({ x: xs[v % W], y: ys[Math.floor(v / W)] });
        prevDir = dir;
        const i = (v % W) + DX[dir];
        const j = Math.floor(v / W) + DY[dir];
        v = j * W + i;
        const list = out.get(v) || [];
        let next = -1;
        let closed = false;
        for (const cand of [(dir + 1) % 4, dir, (dir + 3) % 4]) {
          if (v === startV && cand === startDir) { closed = true; break; }
          const at = list.indexOf(cand);
          if (at >= 0) { list.splice(at, 1); next = cand; break; }
        }
        if (closed || next < 0) {
          if (closed && startDir === prevDir && pts.length > 1) pts.shift();
          break;
        }
        dir = next;
      }
      // Убрать вершины на прямой (старт мог оказаться посреди стороны).
      const clean = pts.filter((p, k) => {
        const a = pts[(k - 1 + pts.length) % pts.length];
        const b = pts[(k + 1) % pts.length];
        return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
      });
      if (clean.length < 4) continue;
      let s = 0;
      for (let k = 0; k < clean.length; k += 1) {
        const a = clean[k]; const b = clean[(k + 1) % clean.length];
        s += a.x * b.y - b.x * a.y;
      }
      cycles.push({ pts: clean, area: s / 2 });
    }
  }
  return cycles;
}

// Контуры объединения прямоугольников (см. traceCycles).
export function rectsCycles(rects) {
  const list = rects.filter((r) => r && r.w > 0 && r.h > 0);
  if (!list.length) return [];
  const ax = gridAxis(list.flatMap((r) => [r.x, r.x + r.w]));
  const ay = gridAxis(list.flatMap((r) => [r.y, r.y + r.h]));
  const nx = ax.coords.length - 1;
  const filled = new Uint8Array(nx * (ay.coords.length - 1));
  for (const r of list) {
    const i0 = ax.at(r.x); const i1 = ax.at(r.x + r.w);
    const j0 = ay.at(r.y); const j1 = ay.at(r.y + r.h);
    for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) filled[j * nx + i] = 1;
  }
  return traceCycles(filled, ax.coords, ay.coords);
}
