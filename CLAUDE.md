# Kepler Plan — памятка для Claude

Проект — в папке `kepler/`: концепт-планировщик частных домов, чистый JS (ES-модули) + canvas, без фреймворков и сборки. Интерфейс, комментарии и коммиты — по-русски.

## Экономия токенов
- Одна задача на сессию; ответы короткие.
- Большие файлы не читать целиком: сначала grep, потом нужный фрагмент.
- Тесты — только связанные с правкой; полный прогон делает CI на GitHub.
- Артефакт публиковать только по просьбе.

## Команды (из `kepler/`)
- `npm run lint`, `npm test` (unit, быстро), `node --test tests/<имя>.test.mjs`.
- e2e (Playwright, медленно): `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test --test-concurrency=1 tests/e2e/<имя>.e2e.mjs`. Не запускать `playwright install`.
- Артефакт: `node scripts/build-artifact.mjs <папка>`, затем публикация папки по `manifest.json` в https://claude.ai/artifact/RhrJtkuS4C5mDb9PyKwgPV.

## Устройство
- `core/` — логика без DOM: `model.js` (проект и этажи, схема `kepler-plan/5`; миграции — `migrate.js`, фикстуры v1–v4), `building.js` (оси дома: world = origin + R(rotation)·local), `walls.js`, `rooms.js`, `catalog.js`, `site.js`, `dxf.js`, `insolation.js`, `norms.js`, `tep.js`, `clearance.js`, `export.js` (JSON `kepler-export/2`, DXF), `ifc.js`, `pdf.js`, `mesh3d.js`, `templates.js`, `variants.js`, `generator.js`, `composite.js` (составная мебель `item.comp`: стол со стульями, диван-конструктор), `kitchen.js` (кухня Л/Г/П), `blocks.js` (блоки фиксированного размера), `zip.js`, `terrain.js` (рельеф).
- `ui/` — интерфейс, вход `app.js`; рисование плана — `render.js`. `window.__kepler` (для e2e) — только с `?debug`.
- `revit/` — надстройка Revit (C#); не компилировалась — нет .NET SDK.
- Единицы — мм, ось Y вниз. Комнаты, стены, мебель — в осях дома; участок и съёмка — в координатах съёмки.
- `project.rooms/openings/items` — это активный этаж из `project.levels[]`.

## Работа
- Ветка `claude/awesome-gates-znrtlm`, черновой PR #1.
- Осталось из плана (волна 3):
  - 3.9 Облако — сделано: `ui/cloud.js` (облако `db`+`user` или браузер), `ui/localdb.js` (IndexedDB), `ui/projects.js` (панель «Проекты»), `core/zip.js`, экспорт «.zip», скачивание через `downloads` (dxf/ifc там только в .zip). Не проверено в живом артефакте. При публикации артефакта объявить `capabilities: {db: {rules: DB_RULES}, user: {}, downloads: true}` (`DB_RULES` — в `core/storage.js`).
  - 3.10 Рельеф — сделано: `site.terrain` (отметки), `core/terrain.js` (Делоне, изолинии, уклон), импорт отметок из DXF (`underlay.marks`), `ui/terrain*.js`, 3D-земля, экспорт JSON/DXF. Не проверено в живом артефакте; триангуляция O(n²) — на >5000 точек медленно.
  - 3.11 Мебель — сделано: `comp` (стол с автостульями, диван-конструктор, кухня Л/Г/П с элементами), наложения исправлены. Осталось: импорт блоков из DXF пользователя (стулья без растяжения; реестр `core/blocks.js` готов, файла в репозитории нет — `kepler/assets/furniture/`), автоподбор кухни на конструктор, мебель в 3D, `scripts/check-ifc.py` с ifcopenshell не прогонялся.
  - 3.12 Локализация KZ/EN (пока не нужна).

## Выбор модели (решай сам)
- Основная сессия — на Sonnet. Обычные правки делай сам, без агентов: агент начинает с нуля и на мелочах тратит больше.
- Поиск по многим файлам → агент `scout` (Haiku) вместо чтения файлов в основной сессии.
- Трудное — архитектура новой функции, баг после неудачной попытки, геометрия и повороты → агент `architect` (Opus): точная постановка + что уже проверено.
- Коммит и пуш — в основной сессии, после проверки результата агента.
