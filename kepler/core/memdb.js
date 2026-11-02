// Документное хранилище в памяти с тем же API, что у capability `db`
// claude.ai (подмножество): doc(path).get/set/delete/onSnapshot,
// collection(path).get/doc/onSnapshot. Нужно тестам и локальному режиму
// (проекты в браузере: память + зеркало в IndexedDB, см. ui/localdb.js).
//
// Пути — как в `db`: чётное число сегментов — документ, нечётное — коллекция.

const segments = (path) => String(path).split('/').filter(Boolean);

function checkPath(path, wantDoc) {
  const parts = segments(path);
  if (!parts.length || parts.some((s) => !/^[\w\-.~:@+]+$/.test(s) || s === '.' || s === '..')) {
    throw new TypeError(`Неверный путь: ${path}`);
  }
  if ((parts.length % 2 === 0) !== wantDoc) {
    throw new TypeError(`${wantDoc ? 'Документ' : 'Коллекция'}: неверная чётность пути ${path}`);
  }
  return parts.join('/');
}

const freeze = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function docSnapshot(path, body) {
  const id = path.slice(path.lastIndexOf('/') + 1);
  const data = freeze(body);
  return {
    id,
    exists: body !== undefined,
    data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false },
  };
}

// initial: { [path]: body }; onWrite(path, body | null) — после каждой записи.
export function createMemoryDb({ initial = {}, onWrite = null } = {}) {
  const docs = new Map(Object.entries(initial).map(([p, b]) => [checkPath(p, true), freeze(b)]));
  const listeners = new Set();

  const childrenOf = (collPath) => {
    const prefix = `${collPath}/`;
    const depth = segments(collPath).length + 1;
    return [...docs.keys()]
      .filter((p) => p.startsWith(prefix) && segments(p).length === depth)
      .sort();
  };

  function querySnapshot(collPath, filters, order, max) {
    let list = childrenOf(collPath).map((p) => docSnapshot(p, docs.get(p)));
    for (const [field, op, value] of filters) {
      list = list.filter((d) => {
        const v = d.data()[field];
        switch (op) {
          case '==': return v === value;
          case '!=': return v !== value;
          case '<': return v < value;
          case '<=': return v <= value;
          case '>': return v > value;
          case '>=': return v >= value;
          case 'in': return value.includes(v);
          case 'array-contains': return Array.isArray(v) && v.includes(value);
          default: throw new TypeError(`Оператор ${op} не поддержан`);
        }
      });
    }
    if (order) {
      const [field, dir] = order;
      const k = dir === 'desc' ? -1 : 1;
      list.sort((a, b) => {
        const va = a.data()[field];
        const vb = b.data()[field];
        if (va === vb) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        return va < vb ? -k : k;
      });
    }
    if (max) list = list.slice(0, max);
    return { docs: list, size: list.length, empty: list.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }

  function notify(path) {
    for (const l of [...listeners]) {
      if (l.kind === 'doc' ? l.path === path : path.startsWith(`${l.path}/`) && segments(path).length === segments(l.path).length + 1) {
        l.fire();
      }
    }
  }

  function write(path, body) {
    if (body === null) docs.delete(path); else docs.set(path, freeze(body));
    onWrite?.(path, body === null ? null : freeze(body));
    notify(path);
  }

  function makeQuery(collPath, filters = [], order = null, max = 0) {
    return {
      where: (field, op, value) => makeQuery(collPath, [...filters, [field, op, value]], order, max),
      orderBy: (field, dir = 'asc') => makeQuery(collPath, filters, [field, dir], max),
      limit: (n) => makeQuery(collPath, filters, order, n),
      get: async () => querySnapshot(collPath, filters, order, max),
      onSnapshot(next) {
        const l = { kind: 'coll', path: collPath, fire: () => next(querySnapshot(collPath, filters, order, max)) };
        listeners.add(l);
        queueMicrotask(() => listeners.has(l) && l.fire());
        return () => listeners.delete(l);
      },
    };
  }

  function doc(path) {
    const p = checkPath(path, true);
    return {
      id: p.slice(p.lastIndexOf('/') + 1),
      path: p,
      get: async () => docSnapshot(p, docs.get(p)),
      set: async (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('тело — объект'), { code: 'invalid_argument' });
        write(p, data);
      },
      update: async (data) => {
        if (!docs.has(p)) throw Object.assign(new Error('нет документа'), { code: 'invalid_argument' });
        write(p, { ...docs.get(p), ...data });
      },
      delete: async () => { if (docs.has(p)) write(p, null); },
      onSnapshot(next) {
        const l = { kind: 'doc', path: p, fire: () => next(docSnapshot(p, docs.get(p))) };
        listeners.add(l);
        queueMicrotask(() => listeners.has(l) && l.fire());
        return () => listeners.delete(l);
      },
      collection: (sub) => collection(`${p}/${sub}`),
    };
  }

  function collection(path) {
    const p = checkPath(path, false);
    let counter = 0;
    return {
      ...makeQuery(p),
      path: p,
      doc: (id) => doc(`${p}/${id || `d${Date.now().toString(36)}${(counter += 1).toString(36)}`}`),
      add: async (data) => { const ref = doc(`${p}/d${Date.now().toString(36)}${(counter += 1).toString(36)}`); await ref.set(data); return ref; },
    };
  }

  return { doc, collection, dump: () => Object.fromEntries(docs) };
}
