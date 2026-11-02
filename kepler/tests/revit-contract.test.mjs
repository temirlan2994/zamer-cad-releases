// Договор с плагином Revit: каждое поле, которое читает C# (атрибуты
// [JsonPropertyName] в revit/src/KeplerExport.cs), есть в нашем JSON.
// Переименуете поле в экспорте — этот тест упадёт раньше, чем плагин.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStructuredExport } from '../core/export.js';
import { buildTemplate } from '../core/templates.js';
import { createItem } from '../core/model.js';

const cs = readFileSync(new URL('../revit/src/KeplerExport.cs', import.meta.url), 'utf8');

// Класс C# → имена JSON-полей.
function fields(className) {
  const start = cs.indexOf(`class ${className}`);
  assert.ok(start >= 0, `нет класса ${className}`);
  const body = cs.slice(start, cs.indexOf('\n    }\n', start));
  return [...body.matchAll(/JsonPropertyName\("([^"]+)"\)/g)].map((m) => m[1]);
}

test('JSON экспорта содержит все поля, которые читает плагин Revit', () => {
  const p = buildTemplate('two-storey');
  p.items.push(createItem('wall-free', 1500, 2000, 2000, 120), createItem('column', 2500, 2000, 400, 400));
  const data = JSON.parse(JSON.stringify(buildStructuredExport(p)));
  const level = data.levels[0];
  const has = (obj, cls) => {
    for (const f of fields(cls)) assert.ok(f in obj, `${cls}.${f} нет в JSON`);
  };
  has(data, 'KeplerExport');
  has(data.building, 'BuildingDto');
  has(data.building.origin, 'Pt');
  has(level, 'LevelDto');
  has(level.rooms[0], 'RoomDto');
  has(level.walls[0], 'WallDto');
  has(level.openings[0], 'OpeningDto');
  has(level.free_walls[0], 'FreeWallDto');
  has(level.columns[0], 'ColumnDto');
  has(level.columns[0].size, 'Size2');
  assert.match(data.schema, /^kepler-export\//, 'плагин проверяет префикс схемы');
});
