# Kepler Plan — передача проекта (для Codex и других агентов)

Этот файл — полная памятка. Дополняет `CLAUDE.md` (то же самое для Claude Code; в нём есть правила экономии токенов и выбор моделей — для Codex они не нужны).

## Что это
Концепт-планировщик частных домов: чистый JS (ES-модули) + canvas, без фреймворков и сборки. Всё в папке `kepler/`. Интерфейс, комментарии, коммиты — **по-русски**. Репозиторий: `temirlan2994/zamer-cad-releases`; ветка `claude/awesome-gates-znrtlm`, черновой PR #1 (https://github.com/temirlan2994/zamer-cad-releases/pull/1). Не пушить в другие ветки без просьбы пользователя.

## Команды (из `kepler/`)
```bash
npm ci                     # один раз
npm run lint               # eslint
npm test                   # unit, быстро (сейчас 169 тестов, все зелёные)
node --test tests/<имя>.test.mjs
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test --test-concurrency=1 tests/e2e/<имя>.e2e.mjs   # e2e, медленно
npm run serve              # локальный сервер (scripts/serve.mjs); отладочный API — ?debug=1
node scripts/build-artifact.mjs <папка>   # сборка страницы-артефакта claude.ai
```
`playwright install` не запускать (браузер уже стоит). Полный прогон e2e делает CI (`.github/workflows/kepler.yml`).
Перед коммитом: `npm run lint`, `npm test` и e2e тех файлов, что затронуты.

## Устройство
- `kepler/core/` — логика без DOM. `model.js` (проект и этажи, схема **`kepler-plan/5`**; миграции `migrate.js`, фикстуры v1–v4 в `tests/fixtures/`; поднимаешь версию — добавь миграцию, фикстуру и тест), `building.js` (оси дома: world = origin + R(rotation)·local), `walls.js`, `rooms.js`, `catalog.js`, `site.js` (участок), `dxf.js`/`zamer/*` (разбор DXF), `insolation.js`, `norms.js`, `tep.js`, `clearance.js` (проходы/пересечения), `export.js` (JSON `kepler-export/2`, DXF), `ifc.js`, `pdf.js`, `mesh3d.js`, `templates.js`, `variants.js`, `generator.js`, `furnish.js` (автоподбор мебели).
  - Новое в этой сессии: `composite.js` (составная мебель `item.comp`: стол со стульями, диван-конструктор; реестр `TYPES`), `kitchen.js` (кухня Л/Г/П), `blocks.js` (блоки мебели фиксированного размера), `terrain.js` (рельеф), `storage.js` + `memdb.js` (проекты с версиями, облако/браузер), `zip.js`.
- `kepler/ui/` — интерфейс, вход `kepler/app.js`; рисование плана — `kepler/render.js`. `window.__kepler` (для e2e) только с `?debug`. Любой `ui/*.js` должен быть достижим из `app.js` (проверяет `tests/build.test.mjs`), каждый `el('id')` — иметь `id` в `index.html`.
- `kepler/revit/` — надстройка Revit (C#), не компилировалась (нет .NET SDK).
- Единицы — мм, ось Y вниз. Комнаты, стены, мебель — в осях дома; участок и съёмка — в координатах съёмки. `project.rooms/openings/items` — активный этаж из `project.levels[]`.
- Правки пользователя идут через `mutate(fn)` из `ui/store.js` (история отмены/повтора, автосохранение). Перетаскивание — одна запись истории.

## Что сделано в волне 3 (всё закоммичено, lint и тесты зелёные)
- **3.9 Облако.** `ui/cloud.js` (облако `db`+`user` в артефакте claude.ai, иначе браузер), `ui/localdb.js` (IndexedDB), `ui/projects.js` (панель «▤ Проекты»: версии, мои, общие, публикация), `core/zip.js`, экспорт «.zip». В артефакте `downloads` не принимает `.dxf`/`.ifc` — они упаковываются в .zip (`ui/cloud.js` → `saveFile`). Права `db`: `DB_RULES` в `core/storage.js`.
- **3.10 Рельеф.** `site.terrain` (отметки), `core/terrain.js` (Делоне, изолинии, уклон), импорт отметок из DXF (`underlay.marks`), `ui/terrain*.js`, `ui/props-terrain.js`, 3D-земля, экспорт JSON/DXF.
- **3.11 Мебель** (поле `item.comp`, необязательное, схема остаётся 5):
  - Стол со стульями (`comp.type:'dining'`): вид стула, отступ, зазор, стороны; число стульев пересчитывается при растягивании.
  - Диван-конструктор (`'sofa'`): цепочка модулей (сиденье, угол, подлокотник, пуф, шезлонг), «+» на плане, вставка в середину, хит-тест по модулям.
  - Кухня (`'kitchen'`, `core/kitchen.js`): линейная/Г/П, элементы с галочками (мойка, плита, духовой, холодильник, посудомойка, верхние шкафы, вытяжка), перетаскивание вдоль линии.
  - Наложения подлокотник/спинка исправлены, кромки модулей без двойных линий, мебель в IFC (`IfcFurniture`), подсветка проходов по контуру.

## Публикация артефакта (только по просьбе пользователя)
Артефакт: https://claude.ai/artifact/RhrJtkuS4C5mDb9PyKwgPV (последняя опубликованная версия 46 = коммит `fe4e0c8`). Сборка: `node scripts/build-artifact.mjs <папка>`, файлы — по `manifest.json`. Capabilities при публикации: `{db: {rules: DB_RULES}, user: {}, downloads: true}`, где `DB_RULES = [{path:'shared',read:'view',write:'owner'},{path:'shared/{self}',write:'interact'}]`. Публиковать умеет только Claude Code (инструмент Artifact); Codex этого сделать не может.

## Что осталось (по приоритету)
1. **Блоки мебели из DXF пользователя** (стулья и др. без растяжения, выбор в библиотеке). Реестр `core/blocks.js` готов (`registerBlock({id,title,group,w,h,lines})`, сиденье смотрит в +Y). Нужно: парсер блоков из DXF (`INSERT`/`BLOCK` в `core/dxf.js`), загрузка и хранение блоков в проекте, группа «Мои блоки» в библиотеке мебели (`ui/library.js`), использование в `comp.chair` стола. **Блокер:** файл пользователя `клод мебель.dxf` в репозиторий не загружен (в `kepler/assets/furniture/` только пустой `readme.txt`). Спросить пользователя про файл (лучше `kepler/assets/furniture/furniture.dxf`, латиницей).
2. Автоподбор кухни (`core/furnish.js`) всё ещё ставит отдельные предметы, не конструктор — осторожно, ломает расстановку.
3. Мебели нет в 3D (`core/mesh3d.js`).
4. Флаг «Зеркально» у П-образной кухни ничего не меняет — скрыть или пояснить в панели.
5. Нет e2e-теста перетаскивания элементов кухни пальцем (тач).
6. `scripts/check-ifc.py` (нужен ifcopenshell) не прогонялся на новом IFC с мебелью.
7. Триангуляция рельефа O(n²): на >5000 точек секундная задержка.
8. 3.12 Локализация KZ/EN — пользователь пока не просил.
9. Облако и рельеф проверены только тестами; в живом артефакте не открывались.

## Подводные камни
- Большие файлы (`render.js` ~80 КБ, `ui/input.js` ~40 КБ) не читать целиком: `grep -n`, затем нужный фрагмент.
- Кнопки на плане (дивана «+», кухни ↔) обрабатываются в `ui/input.js` раньше перетаскивания предмета; зоны нажатия кладутся в `state._sofaUI`/`state._kitchenUI` при отрисовке.
- Кириллица в именах файлов: Chromium в e2e запускается с `LANG=C.UTF-8` (см. `tests/e2e/helpers.mjs`).
- Для составной мебели габарит предмета (`item.w/h`) вычисляется (`fit`), растягивание мышью отключено (`isFixedSizeComp`).
