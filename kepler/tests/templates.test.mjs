// Шаблоны домов: корректная расстановка, связность, окна наружу, нормы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, buildTemplate } from '../core/templates.js';
import { deserializeProject, serializeProject, levelProject } from '../core/model.js';
import { analyzeConnectivity, validateRoomPlacement } from '../core/rooms.js';
import { deriveWalls, doorLink, openingRect } from '../core/walls.js';
import { normsReport } from '../core/norms.js';

for (const t of TEMPLATES) {
  test(`шаблон «${t.title}»: собирается и проходит проверки`, () => {
    const p = deserializeProject(serializeProject(buildTemplate(t.id)));
    for (const level of p.levels) {
      const lp = levelProject(p, level.id);
      const walls = deriveWalls(lp);
      for (const room of lp.rooms) {
        const v = validateRoomPlacement(lp, room, room.id);
        assert.ok(v.ok && !v.warning, `${level.name} / ${room.name}: ${v.reason || v.warning}`);
      }
      const c = analyzeConnectivity(lp, walls);
      assert.equal(c.hasEntrance, true, `${level.name}: нет входа`);
      assert.deepEqual(c.unreachable, [], `${level.name}: недоступны ${c.unreachable}`);
      for (const o of lp.openings) {
        const placed = openingRect(lp, o, walls);
        assert.ok(placed, `${level.name}: проём ${o.kind} вне стены`);
        if (o.kind === 'window') assert.equal(placed.wall.kind, 'own', `${level.name}: окно не на наружной стене`);
        if (o.kind === 'door') assert.ok(doorLink(lp, o, walls), `${level.name}: дверь ни с чем не связана`);
      }
    }
    const n = normsReport(p);
    assert.deepEqual(n.problems.map((x) => `${x.room.name}: ${x.text}`), []);
    assert.equal(n.insolation.ok, true, 'инсоляция');
  });
}

test('неизвестный шаблон — ошибка', () => {
  assert.throws(() => buildTemplate('nope'), /Нет шаблона/);
});
