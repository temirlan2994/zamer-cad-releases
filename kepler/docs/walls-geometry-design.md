# Стены: геометрическая схема (проект, 2026-11-05)

Статус: проект, код стен не менялся. Исполняемая часть — `tests/wall-fixtures.mjs`,
`tests/wall-invariants-lib.mjs`, `tests/wall-invariants.test.mjs`.

## 1. Почему переписываем

Сейчас `core/walls.js` выводит стены как полосы вдоль сторон комнат (`band`) и чинит
стыки цепочкой заплаток: `findAdjacencies` → общие полосы, `subtractIntervals` →
собственные, `covered` → истончение до перегородки, `extendOwnCorners` →
удлинение углов, `cutWallsInsideShafts`, `fillWallJoints` (kind `joint`),
`addThicknessChamfers` (kind `chamfer`). Каждая заплатка знает только свой случай;
наложения и пропуски возникают на пересечении их правил.

Замер инвариантами на 18 фикстурах + 4 этажах шаблонов (раздел 6):
- **e (наложения)** — нарушен на ВСЕХ 22 случаях: куски перекрываются на
  0,25–0,99 м² на этаж (удлинённые углы и `joint` поверх полос). Следствия: швы и
  двойные штрихи на плане, двойной объём в IFC/3D (там `joint`/`chamfer` не
  отфильтрованы), двойные контуры в DXF.
- **c (стена в комнате)** — `diagonalCorners`, `courtyardBetweenL`: удлинение
  наружного угла (`extendOwnCorners`) заходит квадратом 150×150 в соседнюю
  комнату, стоящую по диагонали через зазор 100.
- a, b, d, f на текущих фикстурах держатся — их нынешние фиксы работают, но
  только для известных конфигураций (каждый новый тип узла требует новой заплатки).

## 2. Идея

Комната — внутренний (чистый) ортогональный полигон `P_r` (как сейчас:
`roomPolygon`/`roomRects`). Стена — не объект вдоль стороны, а **область**:

    W = ⋃_r ( Ring_r \ ⋃_{s ∉ Anc(r)} P_s )
    Ring_r = Offset(P_r, t_e по каждому ребру e) \ P_r

- `Offset` с разной толщиной на ребро для ортогонального полигона — это объединение
  прямоугольников: каждое ребро (точнее, каждый его участок с постоянной
  толщиной) выдавливается наружу на `t`; в каждой выпуклой вершине добавляется
  угловой прямоугольник `t_prev × t_next`; вогнутые вершины закрываются сами
  наложением соседних прямоугольников. Всё — ось-ориентированные прямоугольники.
- `Anc(r)` — комнаты, внутри которых стены `r` разрешены: предки по `parentId`;
  для шахты — все комнаты, чей контур она перекрывает (шахта «над» помещениями).
  Вычитание чужих `P_s` даёт бесплатно: обрезку стен шахтой
  (`cutWallsInsideShafts`), запрет стен внутри соседей (дефект c), и
  ликвидацию `covered`.
- Общая стена: у двух комнат на зазоре `g` = толщина пары (как в `findAdjacencies`)
  обе полосы толщиной `g` совпадают — объединение даёт одну полосу без шва.
  Узлы Т/крест/ступени/разные толщины получаются автоматически, без `joint` и
  `chamfer`.
- Терраса/балкон (`isOpenRoom`) не даёт `Ring`, но её `P_s` вычитается (стены дома
  не заходят на террасу). Перила — как сейчас (`openRoomRailingSegments`).

Толщина участка ребра `t_e` (единственный источник, как сейчас):
1. участок напротив соседа на точном зазоре пары → `g` (`sharedWallThickness`);
2. иначе `wallOverrides[e|room|side].thickness`;
3. иначе класс: внутренняя (вложенная или шахта) → `partition`, иначе `exterior`.

Открытый вопрос — перекрывающиеся комнаты (сейчас `covered` → перегородка): в
новой схеме стена внутри чужого `P_s` исчезает. Предложение: перекрытие — ошибка
планировки (подсветка в нормах), стену не рисовать; если нужно старое поведение —
участок ребра внутри чужой комнаты считать `partition` и `s` добавлять в `Anc(r)`
для этого участка.

## 3. Алгоритм (без зависимостей)

Стены ортогональны (оси дома; поворот — только `building.rotation` при выводе),
поэтому достаточно **сжатой прямоугольной сетки**, как `regionGrid/slabFaces` в
`core/mesh3d.js`:

1. Сегменты рёбер: для каждой закрытой комнаты — `roomBoundaryEdges`, разбитые
   точками смены толщины (общие участки по `findAdjacencies`). Каждому сегменту —
   метаданные `{ key, kind, rooms, sides, wallType, hidden, thickness, edge,
   outward, from, to }` (ровно как нынешние `own/shared` до заплаток).
2. Прямоугольники: выдавливание сегментов + угловые прямоугольники выпуклых
   вершин. Координаты округляются до 0,5 мм (`snap`), чтобы не было щелей-волосков.
3. Сетка: уникальные X и Y всех прямоугольников и всех `P_s` (обычно 50–200 по
   оси; худший случай 40 комнат → ~1500 × 1500, Uint8/Int16 массивы — < 5 мс).
4. Клетка входит в `W`, если её центр покрыт прямоугольником `r` и не лежит в
   `P_s` для `s ∉ Anc(r)`.
5. **Владелец клетки** (для метаданных): среди покрывающих прямоугольников —
   приоритет: сегмент, чьё ребро ближе по нормали (клетка «принадлежит» ребру,
   которое её выдавило); при равенстве — `shared` > `own`; затем толще; затем
   `exterior` > `bearing` > `partition`; затем ключ по алфавиту (детерминизм).
   Угловые прямоугольники наследуют владельца от более толстого из двух рёбер.
6. Выход по каждому ключу: `rects` — клетки владельца, слитые построчно в
   прямоугольники (как `slabFaces`); `polys` — контуры (обход границы клеток,
   ортогональные, без самопересечений). Глобально: `outline` — контуры всей `W`
   (наружные + внутренние циклы), чтобы штрих рисовался один раз, без швов.
7. Скрытая стена (`hidden`): её клетки остаются в `W` для расчётов, но не
   рисуются; контур дома не рвётся (как нынешняя заплатка на торце).

Альтернатива — `polygon-clipping` (Martinez, ~15 КБ, ESM, MIT). Плюсы: произвольные
полигоны (если появятся косые стены), готовые контуры. Минусы: внешняя зависимость
в проекте без сборки (вендорить в `core/vendor/`), плавающая точка и редкие
вырожденные случаи на совпадающих рёбрах — именно наш основной случай (общие
стены лежат точно друг на друге), атрибуция метаданных всё равно нужна своя.
**Выбор: своя сжатая сетка**; косые стены, если появятся, — отдельной задачей.

## 4. Контракт `deriveWalls` и потребители

Сохраняем массив записей стен с теми же полями для `kind: 'own' | 'shared'`
(запись = сегмент из шага 1, `band` — чистое выдавливание без удлинения углов,
`center`, `from/to`, `edge`, `outward`, `rooms`, `sides`, `key`, `thickness`,
`wallType`, `hidden`). **Новое:** `rects` (непересекающиеся куски области этого
сегмента) и `polys`. Записей `joint`/`chamfer` больше нет. Глобальный контур —
отдельная функция `wallOutline(walls)` (из `rects`), не свойство массива (массив
копируют `[...walls]`, свойство бы терялось).

Кто что читает (grep 2026-11-05):

| Потребитель | Функции walls.js | Поля | Что меняется |
|---|---|---|---|
| render.js | deriveWalls, doorSymbol, openingRect, doorLeaves, openRoomRailingSegments, facadeDimensionStations | chamfer: poly; band; key, from, rooms[0], hidden, center, wallType, orient, edge, thickness; ветки по kind own/shared/joint/chamfer | заливка по `rects` по типу, штрих — `wallOutline`; ветки joint/chamfer удалить |
| core/mesh3d.js | deriveWalls, openingRect | hidden, band, kind, orient, wallType | выдавливать `rects` (сейчас joint/chamfer попадают, chamfer получает orient 'h') |
| core/ifc.js | deriveWalls, openingRect | hidden, band, kind, key, wallType | IfcWall по сегменту, тело — `rects`; «Стена (стык)» исчезает |
| core/export.js | deriveWalls, openingRect, doorLink, doorLeaves | hidden, kind, key, center, thickness, wallType, rooms, orient | JSON без изменений (center/thickness); DXF — контур из `wallOutline` вместо полос |
| core/dimensions.js | openingRect, sideEdge | band, center, orient, wallType, kind | наружные размеры — по `wallOutline` (внешняя грань) |
| core/hit-stack.js, ui/hit.js | openingRect | kind, band, key, from | hit по `rects` вместо band (точнее в узлах) |
| core/insolation.js | deriveWalls, openingRect | band | без изменений |
| core/wall-edit.js | — | sides, orient, from/to, kind, rooms, edge, outward | без изменений |
| core/wall-thickness.js | findAdjacencies, projectAdjacencies, sharedKey | rooms, thickness, sides, orient, wallType, kind, key | без изменений |
| core/rooms.js | deriveWalls, doorLink, projectAdjacencies | hidden, kind, rooms | без изменений |
| core/opening-spacing.js | openingRect, sideEdge | sides, from, to, kind | без изменений |
| core/duplicate-room.js, norms.js, furnish.js, label-anchor.js | deriveWalls/openingRect/doorSwingRect/doorLeaves | косвенно | без изменений |
| ui/plan-actions.js | deriveWalls, clampOpeningOffset | rooms, kind, from/to, hidden, key, sides, orient, edge, thickness | без изменений |
| ui/props.js, ui/dim-input.js, ui/input.js | deriveWalls, openingRect, clampOpeningOffset | rooms, from/to, kind, thickness, wallType, orient, key | без изменений |
| ui/debug.js | openingRect | band, thickness, kind | без изменений |
| ui/sample.js, sheet.js, store.js, tools.js, variants.js | deriveWalls | передают дальше | без изменений |
| внутри walls.js: wallAt, clampOpeningOffset / openingRect, doorSymbol, doorSwingRect / doorLink | — | sides, from, to / orient, band / rooms, kind | `band` без удлинения углов: проверить проёмы у углов (opening-anchor, opening-spacing тесты) |

tep.js, pdf.js, dxf.js стен не читают.

## 5. Миграция под флагом

1. **`core/ortho-grid.js`** — вынести сжатую сетку из mesh3d (`regionGrid`,
   слияние в прямоугольники, обход контура); mesh3d переходит на неё (тесты
   mesh3d зелёные).
2. **`deriveWallsV2(project)`** в `core/walls-v2.js` рядом со старой: шаги 1–7.
   `KEPLER_WALLS=v2 node --test tests/wall-invariants.test.mjs` — все инварианты
   без todo; плюс тест-сравнение: для каждой фикстуры и шаблона множество записей
   `own/shared` (key, from, to, thickness, wallType) V2 совпадает со старым, а
   объединение `rects` V2 ⊇ объединение старых `band` за вычетом дефектов c.
3. Флаг `project.settings.wallsV2` / `?walls=v2` в `ui/store.js` (точка, где
   кешируются стены). Потребители переводятся по одному: render (заливка+контур),
   mesh3d, ifc, DXF, hit — каждый читает `rects`, если есть, иначе `band`.
4. Прогон всех unit + e2e с флагом, ручная проверка в артефакте (Гостиная 3 со
   ступенями, кухня, шахта).
5. Переключение по умолчанию, удаление `extendOwnCorners`, `fillWallJoints`,
   `addThicknessChamfers`, `cutWallsInsideShafts`, `covered`, веток
   joint/chamfer в render/ifc/mesh3d/export/hit; снять `todo` в
   `wall-invariants.test.mjs`.

## 6. Инварианты (tests/wall-invariants-lib.mjs)

Растеризация 10 мм; кусок стены — `polys` | `poly` | `band`, скрытые не считаются.
- **a holes** — замкнутая пустота допустима только как двор (≥ 300 мм по обеим
  осям), щели — нет.
- **b coverage** — клетка снаружи каждой точки границы закрытой комнаты — стена
  (кроме точек, где стену «съела» шахта).
- **c intrusion** — стены не заходят в чистый контур комнаты, кроме зоны
  вложенных комнат и шахт вместе с их стенами.
- **d thickness** — луч по нормали от грани: длина стены = зазор до соседа
  (≤ 450) или назначенная толщина (максимум по коллинеарным граням — для
  вложенной у грани родителя). Лучи вдоль оси перпендикулярной стены и через
  стены шахты пропускаются.
- **e area** — сумма площадей кусков = площадь объединения (нет наложений).
- **f fragments** — каждая связная часть стен касается закрытой комнаты.

Фикстуры (`tests/wall-fixtures.mjs`): twoRooms, teeJoint, crossJoint,
lRoomWithNeighbour, steppedWithKitchenAndShaft (контур с двумя ступенями + кухня
в ступени + шахта сквозь наружную стену — случай «Гостиная 3»),
notchFilledByNeighbour, shaftInWall, mixedThicknessNode (250/200/100/300 и
смещение оси в узле), terraceNextTo, nestedRoom, offsetPair,
notchNeighbourOverhang, interlockedL, shaftAtCorner, nestedAtSharedWall,
centeredNeighbourAndL, courtyardBetweenL, diagonalCorners; плюс этажи шаблонов.
Колонна — предмет мебели (`FURNITURE.column`), стены не затрагивает; кухня-
конструктор — мебель, к стенам отношения не имеет.

## 7. Риски

- Проёмы у углов: `band` больше не удлинён на угол — `clampOpeningOffset` и
  отрисовка двери у угла могут сместиться (покрыто opening-anchor/opening-spacing/
  openings тестами — прогнать с флагом).
- Атрибуция клеток в узлах определяет, какой стене принадлежит угол (цвет типа,
  IFC-объём, выделение по клику); правило приоритета зафиксировать тестом.
- Перекрывающиеся комнаты меняют поведение (раздел 2).
- Производительность: на перетаскивании стены пересчитываются каждый кадр; сетка
  O(Nx·Ny·rects) — ускорить разностным массивом 2D (O(rects + Nx·Ny)).
- IFC/DXF: число объектов меняется (нет стыков) — сверить revit-contract и
  `scripts/check-ifc.py`.
- Плавающие координаты (свободное перетаскивание) — snap 0,5 мм; волоски тоньше
  0,5 мм отбрасывать.

## 8. Оценка объёма

| Этап | Содержание | Оценка |
|---|---|---|
| 0 | Фикстуры + инварианты (сделано) | — |
| 1 | `core/ortho-grid.js`, перевод mesh3d | 0,5 дня, ~150 строк |
| 2 | `deriveWallsV2`: сегменты, прямоугольники, сетка, атрибуция, rects/polys, `wallOutline`; инварианты зелёные; тест-сравнение со старой | 2–3 дня, ~400 строк + 150 тестов |
| 3 | Потребители под флагом: render (заливка/контур), mesh3d, ifc, DXF, hit, dimensions | 2 дня |
| 4 | Прогон unit+e2e с флагом, правки проёмов у углов, живой артефакт | 1 день |
| 5 | Переключение, удаление заплаток (~250 строк минус), снятие todo | 0,5 дня |
| Итого | | ~6–7 рабочих дней |
