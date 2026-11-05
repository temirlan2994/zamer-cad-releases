// Ландшафт (благоустройство участка): каталог объектов и геометрия. Без DOM.
//
// Данные: project.site.landscape = { objects: [...] } — в координатах
// участка (съёмки), как граница и соседи. Поле необязательное: в старых
// проектах его нет, normalizeLandscape() даёт пустой список (схема
// kepler-plan/5 не меняется).
//
// Объект: { id, kind, x, y, rotation, w, h, r?, height, variant, color?, points?,
//           width?, smooth?, locked?, meta }
//   x, y      — центр (для линейных/площадных — центр габарита, syncShape);
//   w, h      — габарит в собственных осях до поворота (мм); у линейных и
//               площадных — габарит точек (с полушириной линии), rotation = 0;
//   r         — радиус кроны (только деревья/кусты-шары, = w/2);
//   rotation  — градусы по часовой (ось Y вниз);
//   points    — вершины в мире: shape 'line' — ось, 'poly' — контур;
//   width     — ширина линейного объекта (мм);
//   smooth    — линия/контур сглажены сплайном Катмулла-Рома через вершины;
//   locked    — «замок»: не двигается, не удаляется и не правится мышью;
//   meta      — свободные параметры вида (места парковки и т.п.).
//
// Формы (shape):
//   'point'  — точечный объект с круглой кроной/основанием, масштаб по одной оси;
//   'circle' — круглая площадка (w = h);
//   'rect'   — прямоугольник/овал (round: true — эллипс), стороны независимы;
//   'line'   — линейный (дорожка, ограждение по ломаной);
//   'poly'   — площадной (газон, гравий, плитка, пруд произвольной формы).

import { pointInPolygon, pointToSegmentDistance } from './zamer/geometry.js';
import { CORNER_IDS, areaOf, layoutBoards, layoutSlabs, pathLayout } from './path-geometry.js';

export const LANDSCAPE_CATEGORIES = [
  { id: 'green', title: 'Озеленение' },
  { id: 'site', title: 'Ландшафт и площадки' },
];

export const LANDSCAPE_SHAPES = ['point', 'circle', 'rect', 'line', 'poly'];

// Дерево ближе этого расстояния к стене дома — мягкое предупреждение.
export const TREE_HOUSE_MIN = 3000;

// Палитра «вид сверху» — приглушённая, эскизная (маркер/акварель):
// шалфейно-оливковые зелёные, тауп-дерево, светлая плитка и гравий.
// Тёмная тема и стиль «Чертёж» получают её производные в отрисовке
// (ui/render-landscape-kit.js); 3D берёт эти же краски.
export const LS_COLORS = {
  leaf: ['#8a9a6e', '#a2b085', '#bfc8a3'],
  leafDark: ['#6f8063', '#86967a', '#a5b298'],
  birch: ['#a7b78a', '#bcc9a0', '#d4ddbf'],
  oak: ['#74865f', '#8d9e77', '#abb995'],
  pine: ['#5f7a68', '#76907e', '#97ac9c'],
  spruce: ['#566f6b', '#6c8682', '#8ca3a0'],
  thuja: ['#62795e', '#7a9174', '#9aae92'],
  box: ['#6e8662', '#879e7a', '#a8bb9a'],
  juniper: ['#6c8784', '#86a09c', '#a6bcb8'],
  grass: ['#b2b28c', '#c7c5a3', '#969f7d'],
  lawn: ['#d2dbbd', '#c4cfab', '#dfe6cf'],
  soil: ['#8a7d6c', '#7a6e5f', '#9d8f7d'],
  stone: ['#aaa9a3', '#c4c3bc', '#8d8c86'],
  gravel: ['#dfdbd1', '#c6c1b4', '#ece9e2'],
  tiles: ['#d8d7d2', '#c8c7c1', '#e5e4df'],
  deck: ['#b19b85', '#9b8571', '#c5b19c'],
  asphalt: ['#9fa1a1', '#8f9192', '#b0b2b2'],
  roof: ['#8f8379', '#a59a90', '#776c63'],
  water: ['#9cc5c4', '#7fb0b2', '#c4dddb'],
  pond: ['#88aeb0', '#70979b', '#aecac9'],
  sand: ['#e6ddc6', '#d8cdb2', '#efe9d8'],
  rubber: ['#a2b29c', '#8e9f89', '#b8c5b3'],
  wood: ['#a48c75', '#8d7562', '#baa38c'],
  metal: ['#6c6f73', '#595c60', '#8b8e92'],
  fire: ['#d9a46e', '#c27f58', '#f0d6b0'],
  coping: ['#e6e1d6', '#cfc8ba', '#f3efe7'],
  glass: ['#d8e3e4', '#bdd0d2', '#eef4f4'],
  car: ['#e3e3e0', '#5c6168', '#9b9088', '#8b98a3', '#cac5b9', '#7e8779'],
  flowers: ['#c9a2b6', '#d8c08c', '#b3a4c8', '#f1ede6', '#d5b39b', '#c398a9'],
  fruit: ['#c58f7e', '#d6be80', '#b48089', '#d6a37a'],
};

const v = (id, title, colors = null) => (colors ? { id, title, colors } : { id, title });

// Каталог. Поля:
//   kind, title, cat, group — тип, название, категория, подгруппа;
//   shape, w, h, min, max   — форма и размеры (мм), допустимые пределы;
//   round                   — эллипс (попадание и контур по эллипсу);
//   height, tall            — высота (тень, 3D этапа 2), «высокий» объект;
//   cover                   — покрытие (учёт площади в ТЭП этапа 2);
//   layer                   — слой отрисовки: ground | low | tall;
//   look, colors, variants  — стиль рисования и краски;
//   stage                   — 1: доступно в каталоге (2 — только описание).
const RAW = [
  // ---------------------------------------------------------- Озеленение
  { kind: 'tree-pine', title: 'Сосна', cat: 'green', group: 'Деревья', shape: 'point', w: 5000, min: 1500, max: 12000, height: 15000, look: 'pine', colors: 'pine',
    variants: [v('scots', 'Сосна обыкновенная'), v('mugo', 'Сосна горная', ['#5a7668', '#71897c', '#91a698'])], keywords: 'хвойное дерево' },
  { kind: 'tree-spruce', title: 'Ель', cat: 'green', group: 'Деревья', shape: 'point', w: 4000, min: 1200, max: 10000, height: 14000, look: 'spruce', colors: 'spruce',
    variants: [v('common', 'Ель обыкновенная'), v('blue', 'Ель голубая', ['#6a8489', '#829ba0', '#a2b7bb'])], keywords: 'хвойное дерево ёлка' },
  { kind: 'tree-birch', title: 'Берёза', cat: 'green', group: 'Деревья', shape: 'point', w: 5000, min: 1500, max: 12000, height: 14000, look: 'deciduous', colors: 'birch',
    variants: [v('summer', 'Летняя крона'), v('autumn', 'Осенняя крона', ['#c4a772', '#d3bb8c', '#e2d1ab'])], keywords: 'лиственное дерево' },
  { kind: 'tree-oak', title: 'Дуб / клён', cat: 'green', group: 'Деревья', shape: 'point', w: 9000, min: 3000, max: 18000, height: 16000, look: 'deciduous', colors: 'oak',
    variants: [v('oak', 'Дуб'), v('maple', 'Клён', ['#7e9466', '#97aa7f', '#b3c39c']), v('maple-red', 'Клён красный', ['#a97e70', '#bb9586', '#cdaea0'])], keywords: 'лиственное широкая крона' },
  { kind: 'tree-fruit', title: 'Плодовое дерево', cat: 'green', group: 'Деревья', shape: 'point', w: 4000, min: 1500, max: 8000, height: 5000, look: 'fruit', colors: 'leaf',
    variants: [v('apple', 'Яблоня'), v('pear', 'Груша'), v('cherry', 'Вишня'), v('apricot', 'Абрикос')], keywords: 'сад яблоня груша вишня' },
  { kind: 'tree-thuja', title: 'Туя / кипарис', cat: 'green', group: 'Деревья', shape: 'rect', round: true, w: 900, h: 1400, min: [500, 700], max: [2500, 3500], height: 6000, look: 'thuja', colors: 'thuja',
    variants: [v('thuja', 'Туя колонновидная'), v('cypress', 'Кипарис', ['#5a705c', '#708672', '#8fa290'])], keywords: 'колонновидное хвойное' },
  { kind: 'tree-bonsai', title: 'Бонсай-сосна', cat: 'green', group: 'Деревья', shape: 'point', w: 2600, min: 1200, max: 5000, height: 2500, look: 'bonsai', colors: 'pine',
    variants: [v('niwaki', 'Ниваки'), v('cloud', 'Облачная стрижка')], keywords: 'японский сад декоративное' },
  { kind: 'shrub-box', title: 'Самшит шаровидный', cat: 'green', group: 'Кустарники', shape: 'point', w: 900, min: 300, max: 2500, height: 900, look: 'ball', colors: 'box',
    variants: [v('box', 'Самшит'), v('pittosporum', 'Шар светлый', ['#93a678', '#abbb91', '#c6d2ae'])], keywords: 'шар куст японский сад' },
  { kind: 'shrub-juniper', title: 'Можжевельник стелющийся', cat: 'green', group: 'Кустарники', shape: 'rect', round: true, w: 2400, h: 1400, min: [600, 400], max: [6000, 4000], height: 500, look: 'juniper', colors: 'juniper',
    variants: [v('blue', 'Сизый'), v('green', 'Зелёный', ['#6c8566', '#849c7d', '#a3b69a'])], keywords: 'хвойный почвопокровный' },
  { kind: 'shrub-flower', title: 'Сирень / спирея', cat: 'green', group: 'Кустарники', shape: 'point', w: 2200, min: 800, max: 5000, height: 2500, look: 'shrub', colors: 'leaf',
    variants: [v('lilac', 'Сирень'), v('spiraea', 'Спирея'), v('hydrangea', 'Гортензия')], keywords: 'цветущий куст' },
  { kind: 'hedge', title: 'Живая изгородь (секция)', cat: 'green', group: 'Кустарники', shape: 'rect', w: 3000, h: 800, min: [600, 400], max: [20000, 2500], height: 1800, look: 'hedge', colors: 'leafDark',
    variants: [v('trim', 'Стриженая'), v('free', 'Свободная')], keywords: 'туя граница' },
  { kind: 'bed-round', title: 'Клумба круглая', cat: 'green', group: 'Цветники', shape: 'circle', w: 2000, min: 600, max: 8000, height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('roses', 'Розы', ['#c08b98']), v('lavender', 'Лаванда', ['#a99cc4'])], keywords: 'цветы' },
  { kind: 'bed-rect', title: 'Клумба прямоугольная', cat: 'green', group: 'Цветники', shape: 'rect', w: 3000, h: 1200, min: [600, 400], max: [15000, 6000], height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('roses', 'Розы', ['#c08b98']), v('lavender', 'Лаванда', ['#a99cc4'])], keywords: 'цветы' },
  { kind: 'bed-strip', title: 'Цветочная полоса', cat: 'green', group: 'Цветники', shape: 'rect', w: 6000, h: 600, min: [1000, 300], max: [30000, 2000], height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('lavender', 'Лаванда', ['#a99cc4']), v('tulips', 'Тюльпаны', ['#c99187', '#d8c08c'])], keywords: 'бордюр миксбордер' },
  { kind: 'lawn-patch', title: 'Газон (пятно)', cat: 'green', group: 'Газон', shape: 'rect', round: true, w: 5000, h: 3500, min: [1000, 1000], max: [40000, 40000], height: 0, cover: true, look: 'lawn', colors: 'lawn',
    variants: [v('mown', 'Стриженый, полосы'), v('meadow', 'Мавританский', ['#cdd8b3', '#bfcca2', '#dbe3c6'])], keywords: 'трава' },
  { kind: 'grass-clump', title: 'Декоративные злаки', cat: 'green', group: 'Газон', shape: 'point', w: 1000, min: 400, max: 3000, height: 1000, look: 'grass', colors: 'grass',
    variants: [v('miscanthus', 'Мискантус'), v('festuca', 'Овсяница сизая', ['#98aaa9', '#b0c0bf', '#7f9291'])], keywords: 'куртина травы' },
  { kind: 'boulder', title: 'Валун', cat: 'green', group: 'Камни', shape: 'rect', w: 1200, h: 900, min: [300, 300], max: [5000, 5000], height: 700, look: 'boulder', colors: 'stone',
    variants: [v('one', 'Одиночный'), v('trio', 'Группа из трёх')], keywords: 'камень японский сад' },
  { kind: 'lawn-area', title: 'Газон (контур)', cat: 'green', group: 'Газон', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'lawn-area', colors: 'lawn',
    variants: [v('mown', 'Стриженый, полосы'), v('meadow', 'Мавританский', ['#cdd8b3', '#bfcca2', '#dbe3c6']), v('moss', 'Мох', ['#a3b08a', '#94a27b', '#b5c09d'])], keywords: 'трава мох рисовать контур' },
  { kind: 'hedge-line', title: 'Живая изгородь (по линии)', cat: 'green', group: 'Кустарники', shape: 'line', w: 6000, h: 800, height: 1800, look: 'hedge-line', colors: 'leafDark',
    variants: [v('trim', 'Стриженая'), v('free', 'Свободная')], keywords: 'туя граница рисовать линия' },

  // ------------------------------------------------- Ландшафт и площадки
  { kind: 'parking-1', layer: 'ground', title: 'Парковочное место', cat: 'site', group: 'Парковка', shape: 'rect', w: 2500, h: 5300, min: [2300, 4500], max: [4000, 7000], height: 1500, cover: true, look: 'parking', colors: 'asphalt',
    variants: [v('car', 'С машиной'), v('empty', 'Пустое')], keywords: 'машина стоянка' },
  { kind: 'parking-2', layer: 'ground', title: 'Парковка на 2 машины', cat: 'site', group: 'Парковка', shape: 'rect', w: 5200, h: 5300, min: [4600, 4500], max: [8000, 7000], height: 1500, cover: true, look: 'parking', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('pavers', 'Плитка', ['#b9b7b1', '#a8a6a0', '#c9c7c1']), v('asphalt', 'Асфальт', ['#9fa1a1', '#8f9192', '#b0b2b2'])], meta: { spaces: 2 }, keywords: 'машина стоянка гравий' },
  { kind: 'parking-guest', layer: 'ground', title: 'Гостевая парковка', cat: 'site', group: 'Парковка', shape: 'rect', w: 2500, h: 5300, min: [2300, 4500], max: [8000, 7000], height: 0, cover: true, look: 'parking-grass', colors: 'lawn',
    variants: [v('grid', 'Газонная решётка')], keywords: 'эко-парковка' },
  { kind: 'carport', title: 'Навес для машины', cat: 'site', group: 'Парковка', shape: 'rect', w: 3000, h: 6000, min: [2600, 4800], max: [7000, 8000], height: 2600, tall: true, cover: true, look: 'carport', colors: 'metal',
    variants: [v('poly', 'Поликарбонат'), v('wood', 'Дерево', ['#9b8571', '#b19b85', '#806b59'])], keywords: 'carport гараж' },
  { kind: 'pad', title: 'Площадка', cat: 'site', group: 'Площадки', shape: 'rect', w: 4000, h: 3000, min: [800, 800], max: [30000, 30000], height: 0, cover: true, look: 'pad', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('tiles', 'Плитка'), v('deck', 'Настил')], keywords: 'гравий плитка настил' },
  { kind: 'pad-round', title: 'Площадка круглая', cat: 'site', group: 'Площадки', shape: 'circle', w: 4000, min: 800, max: 20000, height: 0, cover: true, look: 'pad', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('tiles', 'Плитка'), v('deck', 'Настил')], keywords: 'гравий плитка настил' },
  { kind: 'terrace-deck', title: 'Терраса-настил', cat: 'site', group: 'Площадки', shape: 'rect', w: 6000, h: 3500, min: [1500, 1200], max: [30000, 15000], height: 300, cover: true, look: 'deck', colors: 'deck',
    variants: [v('larch', 'Лиственница'), v('wpc', 'ДПК графит', ['#7b7570', '#69645f', '#8d8782']), v('teak', 'Тик', ['#bba184', '#a58b70', '#cdb598'])], keywords: 'доски настил' },
  { kind: 'gazebo', title: 'Беседка', cat: 'site', group: 'Отдых', shape: 'rect', w: 3500, h: 3500, min: [2000, 2000], max: [8000, 8000], height: 3200, tall: true, look: 'gazebo', colors: 'roof',
    variants: [v('hip', 'Четырёхскатная'), v('hex', 'Шестигранная'), v('flat', 'Павильон, плоская крыша', ['#7c8085', '#8f9398', '#686c71'])], keywords: 'павильон' },
  { kind: 'pergola', title: 'Пергола', cat: 'site', group: 'Отдых', shape: 'rect', w: 3000, h: 4000, min: [1500, 1500], max: [10000, 10000], height: 2700, tall: true, look: 'pergola', colors: 'wood',
    variants: [v('wood', 'Дерево'), v('metal', 'Металл', ['#6c6f73', '#595c60', '#8b8e92'])], keywords: 'навес' },
  { kind: 'bbq-zone', layer: 'ground', title: 'Зона барбекю', cat: 'site', group: 'Отдых', shape: 'rect', w: 4000, h: 3000, min: [2500, 2000], max: [10000, 8000], height: 900, cover: true, look: 'bbq', colors: 'tiles',
    variants: [v('tiles', 'Плитка')], keywords: 'гриль мангал стол' },
  { kind: 'firepit', title: 'Яма для костра со скамьёй', cat: 'site', group: 'Отдых', shape: 'circle', w: 5200, min: 2800, max: 9000, height: 450, cover: true, look: 'firepit', colors: 'gravel',
    variants: [v('bench', 'Круговая скамья'), v('stones', 'Каменное кольцо')], keywords: 'костёр очаг огонь' },
  { kind: 'grill', title: 'Мангал', cat: 'site', group: 'Отдых', shape: 'rect', w: 1000, h: 500, min: [500, 300], max: [3000, 1200], height: 900, look: 'grill', colors: 'metal',
    variants: [v('grill', 'Мангал')], keywords: 'гриль барбекю' },
  { kind: 'pool', title: 'Бассейн', cat: 'site', group: 'Вода', shape: 'rect', w: 7000, h: 5200, min: [3000, 2000], max: [25000, 15000], height: 0, cover: true, look: 'pool', colors: 'water',
    variants: [v('loungers', 'С лежаками'), v('plain', 'Только чаша')], keywords: 'вода плавание' },
  { kind: 'jacuzzi', title: 'Джакузи', cat: 'site', group: 'Вода', shape: 'rect', w: 2200, h: 2200, min: [1600, 1600], max: [3500, 3500], height: 900, cover: true, look: 'jacuzzi', colors: 'water',
    variants: [v('square', 'Квадратное'), v('round', 'Круглое')], keywords: 'спа купель' },
  { kind: 'pond', title: 'Декоративный пруд', cat: 'site', group: 'Вода', shape: 'rect', round: true, w: 4000, h: 2600, min: [1000, 800], max: [20000, 15000], height: 0, cover: true, look: 'pond', colors: 'pond',
    variants: [v('lilies', 'С кувшинками'), v('mirror', 'Зеркальный')], keywords: 'вода' },
  { kind: 'fountain', title: 'Фонтан / водная чаша', cat: 'site', group: 'Вода', shape: 'circle', w: 1600, min: 600, max: 5000, height: 900, look: 'fountain', colors: 'water',
    variants: [v('bowl', 'Чаша')], keywords: 'вода' },
  { kind: 'sandbox', title: 'Песочница', cat: 'site', group: 'Дети', shape: 'rect', w: 2000, h: 2000, min: [1000, 1000], max: [5000, 5000], height: 300, cover: true, look: 'sandbox', colors: 'sand',
    variants: [v('wood', 'Деревянная')], keywords: 'дети песок' },
  { kind: 'playground', layer: 'ground', title: 'Детская площадка', cat: 'site', group: 'Дети', shape: 'rect', w: 6000, h: 4500, min: [3000, 3000], max: [15000, 12000], height: 3000, cover: true, look: 'playground', colors: 'rubber',
    variants: [v('rubber', 'Резиновое покрытие'), v('sand', 'Песок', ['#e6ddc6', '#d8cdb2', '#efe9d8'])], keywords: 'горка дети' },
  { kind: 'swing', title: 'Качели', cat: 'site', group: 'Дети', shape: 'rect', w: 2800, h: 1600, min: [1500, 1000], max: [5000, 3000], height: 2300, look: 'swing', colors: 'wood',
    variants: [v('two', 'Две доски')], keywords: 'дети' },
  { kind: 'greenhouse', title: 'Теплица', cat: 'site', group: 'Хозяйство', shape: 'rect', w: 3000, h: 6000, min: [2000, 2000], max: [6000, 12000], height: 2500, tall: true, cover: true, look: 'greenhouse', colors: 'glass',
    variants: [v('arch', 'Арочная')], keywords: 'огород' },
  { kind: 'vegbeds', title: 'Грядки', cat: 'site', group: 'Хозяйство', shape: 'rect', w: 4000, h: 3000, min: [1000, 1000], max: [20000, 15000], height: 300, cover: true, look: 'vegbeds', colors: 'soil',
    variants: [v('raised', 'Высокие грядки')], keywords: 'огород овощи' },
  { kind: 'compost', title: 'Компостер', cat: 'site', group: 'Хозяйство', shape: 'rect', w: 1000, h: 1000, min: [600, 600], max: [3000, 2000], height: 900, look: 'compost', colors: 'wood',
    variants: [v('box', 'Ящик')], keywords: '' },
  { kind: 'well', title: 'Колодец', cat: 'site', group: 'Хозяйство', shape: 'circle', w: 1400, min: 900, max: 2500, height: 1800, look: 'well', colors: 'stone',
    variants: [v('roof', 'С крышей'), v('open', 'Открытый')], keywords: 'вода' },
  { kind: 'septic', title: 'Септик (условно)', cat: 'site', group: 'Хозяйство', shape: 'circle', w: 2000, min: 1000, max: 4000, height: 0, look: 'septic', colors: 'stone',
    variants: [v('tank', 'Ёмкость')], keywords: 'канализация' },
  { kind: 'loungers', title: 'Шезлонги (пара)', cat: 'site', group: 'Мебель', shape: 'rect', w: 1800, h: 2000, min: [800, 1800], max: [4000, 2200], height: 400, look: 'loungers', colors: 'coping',
    variants: [v('white', 'Белые'), v('teak', 'Тик', ['#bba184', '#a58b70', '#efe6d6'])], keywords: 'лежак' },
  { kind: 'bench', title: 'Садовая скамья', cat: 'site', group: 'Мебель', shape: 'rect', w: 1600, h: 600, min: [800, 400], max: [4000, 900], height: 450, look: 'bench', colors: 'wood',
    variants: [v('wood', 'Дерево')], keywords: 'лавка' },
  { kind: 'table-set', title: 'Стол со стульями', cat: 'site', group: 'Мебель', shape: 'rect', w: 2400, h: 2400, min: [1600, 1600], max: [5000, 4000], height: 750, look: 'table-set', colors: 'wood',
    variants: [v('round', 'Круглый'), v('rect', 'Прямоугольный')], keywords: 'обед уличный' },
  { kind: 'lamp', title: 'Садовый светильник', cat: 'site', group: 'Мебель', shape: 'point', w: 400, min: 200, max: 1000, height: 900, look: 'lamp', colors: 'metal',
    variants: [v('bollard', 'Столбик'), v('pole', 'Фонарь на опоре')], keywords: 'свет фонарь' },
  { kind: 'fence', title: 'Ограждение (секция)', cat: 'site', group: 'Ограждение', shape: 'rect', w: 3000, h: 150, min: [500, 50], max: [10000, 400], height: 1800, look: 'fence', colors: 'wood',
    variants: [v('wood', 'Дерево'), v('metal', 'Металл', ['#6c6f73', '#595c60', '#8b8e92'])], keywords: 'забор' },
  { kind: 'gate', title: 'Калитка / ворота', cat: 'site', group: 'Ограждение', shape: 'rect', w: 4000, h: 200, min: [800, 100], max: [7000, 400], height: 1800, look: 'gate', colors: 'metal',
    variants: [v('gate', 'Ворота распашные'), v('wicket', 'Калитка')], keywords: 'въезд забор' },
  // Линейные и площадные — рисуются мышью (ui/landscape.js, инструмент draw-landscape).
  { kind: 'path', title: 'Дорожка', cat: 'site', group: 'Дорожки', shape: 'line', w: 6000, h: 1000, min: [300, 300], max: [500000, 6000], height: 0, cover: true, look: 'path', colors: 'tiles',
    variants: [
      v('stepping', 'Плиты-ступени', ['#d6d4ce', '#c5c3bc', '#e3e1dc']), v('pavers', 'Брусчатка', ['#b9b7b1', '#a8a6a0', '#c9c7c1']),
      v('deck', 'Настил-доски', ['#b19b85', '#9b8571', '#c5b19c']), v('gravel', 'Гравий', ['#dfdbd1', '#c6c1b4', '#ece9e2']),
      v('concrete', 'Бетон', ['#d3d3cf', '#c2c2be', '#e0e0dc']),
    ], keywords: 'тропинка плиты ступени настил гравий брусчатка рисовать линия' },
  // Плита и доска — отдельные элементы («Разорвать» дорожку) или поштучно.
  { kind: 'slab', layer: 'ground', title: 'Плита', cat: 'site', group: 'Дорожки', shape: 'rect', w: 450, h: 900, min: [100, 100], max: [5000, 5000], height: 40, cover: true, look: 'slab', colors: ['#d6d4ce', '#c5c3bc', '#e3e1dc'],
    variants: [v('stone', 'Камень'), v('concrete', 'Бетон', ['#d3d3cf', '#c2c2be', '#e0e0dc']), v('pavers', 'Брусчатка', ['#b9b7b1', '#a8a6a0', '#c9c7c1'])], keywords: 'плита ступень дорожка камень' },
  { kind: 'board', layer: 'ground', title: 'Доска', cat: 'site', group: 'Дорожки', shape: 'rect', w: 145, h: 1200, min: [40, 100], max: [400, 6000], height: 40, cover: true, look: 'board', colors: 'deck',
    variants: [v('larch', 'Лиственница'), v('wpc', 'ДПК графит', ['#7b7570', '#69645f', '#8d8782']), v('teak', 'Тик', ['#bba184', '#a58b70', '#cdb598'])], keywords: 'доска настил дорожка' },
  { kind: 'fence-line', title: 'Ограждение (по линии)', cat: 'site', group: 'Ограждение', shape: 'line', w: 6000, h: 150, min: [300, 50], max: [500000, 1500], height: 1800, look: 'fence-line', colors: 'wood',
    variants: [v('picket', 'Штакетник'), v('mesh', 'Сетка', ['#8b8e92', '#6c6f73', '#a9acb0']), v('hedge', 'Живая изгородь', ['#6f8063', '#86967a', '#a5b298'])], keywords: 'забор штакетник сетка рисовать линия' },
  { kind: 'paving-area', title: 'Мощение (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'area-paving', colors: 'tiles',
    variants: [v('tiles', 'Плитка 500×500'), v('pavers', 'Брусчатка', ['#b9b7b1', '#a8a6a0', '#c9c7c1']), v('concrete', 'Бетон', ['#d3d3cf', '#c2c2be', '#e0e0dc'])], keywords: 'плитка брусчатка рисовать контур' },
  { kind: 'gravel-area', title: 'Гравий (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'area-gravel', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('white', 'Белый (японский)', ['#e6e2d8', '#cfcabd', '#f4f1ea'])], keywords: 'гравий отсыпка рисовать контур' },
  { kind: 'deck-area', title: 'Настил (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 300, cover: true, look: 'area-deck', colors: 'deck',
    variants: [v('larch', 'Лиственница'), v('wpc', 'ДПК графит', ['#7b7570', '#69645f', '#8d8782']), v('teak', 'Тик', ['#bba184', '#a58b70', '#cdb598'])], keywords: 'терраса доски рисовать контур' },
  { kind: 'pond-area', title: 'Пруд (контур)', cat: 'site', group: 'Вода', shape: 'poly', w: 5000, h: 3000, height: 0, cover: true, look: 'area-pond', colors: 'pond',
    variants: [v('lilies', 'С кувшинками'), v('mirror', 'Зеркальный')], keywords: 'вода рисовать контур' },
  { kind: 'pool-area', title: 'Бассейн-чаша (контур)', cat: 'site', group: 'Вода', shape: 'poly', w: 6000, h: 3000, height: 0, cover: true, look: 'area-pool', colors: 'water',
    variants: [v('mosaic', 'Голубая мозаика'), v('dark', 'Тёмная чаша', ['#6f9aa2', '#5c868f', '#93b6bc'])], keywords: 'вода бассейн рисовать контур' },
];

// Поверхность для баланса территории (ТЭП): green — озеленение (газон,
// цветники, проекции крон), hard — твёрдые покрытия, water — вода, null —
// не покрытие (малые формы, ограждения).
const WATER_KINDS = new Set(['pool', 'jacuzzi', 'pond', 'fountain', 'pond-area', 'pool-area']);
function surfaceOf(raw) {
  if (WATER_KINDS.has(raw.kind)) return 'water';
  if ((raw.cat === 'green' && raw.kind !== 'boulder') || raw.kind === 'vegbeds' || raw.kind === 'parking-guest') return 'green';
  return raw.cover ? 'hard' : null;
}

// Группы видимости в панели: растения, покрытия (площади и дорожки), малые формы.
export const LANDSCAPE_VIS = [
  { id: 'shadows', title: 'Тени' },
  { id: 'plants', title: 'Деревья и кусты' },
  { id: 'covers', title: 'Покрытия и дорожки' },
  { id: 'objects', title: 'Малые формы' },
  { id: 'labels', title: 'Подписи' },
];
function visGroupOf(raw, layer) {
  if (raw.kind === 'hedge-line' || (raw.cat === 'green' && layer !== 'ground' && raw.shape !== 'poly')) return 'plants';
  if (layer === 'ground' || raw.shape === 'poly' || raw.kind === 'path') return 'covers';
  return 'objects';
}

const pair = (value, fallback) => (Array.isArray(value) ? value : [value ?? fallback, value ?? fallback]);

function finalizeDef(raw) {
  const square = raw.shape === 'point' || raw.shape === 'circle';
  const w = raw.w;
  const h = square ? raw.w : (raw.h ?? raw.w);
  const [minW, minH] = pair(raw.min, Math.round(Math.min(w, h) * 0.3));
  const [maxW, maxH] = pair(raw.max, Math.max(w, h) * 4);
  const layer = raw.layer || (raw.height >= 2500 ? 'tall' : raw.cover && raw.height <= 450 ? 'ground' : 'low');
  return {
    stage: 1,
    round: square,
    tall: raw.height >= 3000,
    cover: false,
    variants: [v('default', 'Обычный')],
    keywords: '',
    meta: null,
    ...raw,
    w, h,
    min: { w: minW, h: minH },
    max: { w: maxW, h: maxH },
    layer,
    shadow: layer !== 'ground' && raw.height >= 400,
    lockAspect: square,
    surface: surfaceOf(raw),
    vis: visGroupOf(raw, layer),
    colors: Array.isArray(raw.colors) ? raw.colors : LS_COLORS[raw.colors] || LS_COLORS.leaf,
  };
}

export const LANDSCAPE_CATALOG = RAW.map(finalizeDef);
const BY_KIND = new Map(LANDSCAPE_CATALOG.map((d) => [d.kind, d]));

export function landscapeDef(kind) {
  return BY_KIND.get(kind) || null;
}

// Каталог для панели: только то, что умеет редактор этого этапа.
export function landscapeByCategory(cat, { all = false } = {}) {
  return LANDSCAPE_CATALOG.filter((d) => d.cat === cat && (all || d.stage === 1));
}

export function searchLandscape(query, { all = false } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return LANDSCAPE_CATALOG.filter((d) => (all || d.stage === 1)
    && `${d.title} ${d.group} ${d.kind} ${d.keywords}`.toLowerCase().includes(q));
}

export function variantOf(obj, def = landscapeDef(obj?.kind)) {
  if (!def) return null;
  return def.variants.find((x) => x.id === obj.variant) || def.variants[0];
}

// Краски объекта: свой цвет → цвет варианта → краски типа.
export function objectColors(obj, def = landscapeDef(obj?.kind)) {
  const base = def?.colors || LS_COLORS.leaf;
  const variant = variantOf(obj, def);
  const colors = variant?.colors ? [...variant.colors, ...base.slice(variant.colors.length)] : [...base];
  if (obj?.color) colors[0] = obj.color;
  return colors;
}

let seq = 0;
export function makeLandscapeId() {
  seq = (seq + 1) % 1e6;
  return `ls-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- Объекты

export const isPathShape = (def) => def?.shape === 'line' || def?.shape === 'poly';
export const LINE_WIDTH_MIN = 50;
export const LINE_WIDTH_MAX = 10000;

export function createLandscapeObject(kind, x, y, opts = {}) {
  const def = landscapeDef(kind);
  if (!def) throw new Error(`Неизвестный объект ландшафта: ${kind}`);
  if (isPathShape(def)) return createShapeObject(def, x, y, opts);
  const obj = {
    id: opts.id || makeLandscapeId(),
    kind,
    x: Math.round(x),
    y: Math.round(y),
    rotation: normDeg(opts.rotation || 0),
    w: opts.w ?? def.w,
    h: opts.h ?? def.h,
    height: opts.height ?? def.height,
    variant: opts.variant || def.variants[0].id,
    meta: { ...(def.meta || {}), ...(opts.meta || {}) },
  };
  if (opts.color) obj.color = opts.color;
  if (opts.locked) obj.locked = true;
  return syncRadius(clampSize(obj, def), def);
}

// Линейный/площадной: точки в мире; без точек — заготовка по габариту типа
// с центром (x, y).
function createShapeObject(def, x, y, opts) {
  const line = def.shape === 'line';
  let points = Array.isArray(opts.points) ? opts.points : null;
  if (!points) {
    const a = (opts.w ?? def.w) / 2;
    const b = (line ? 0 : (opts.h ?? def.h)) / 2;
    points = line
      ? [{ x: x - a, y }, { x: x + a, y }]
      : [{ x: x - a, y: y - b }, { x: x + a, y: y - b }, { x: x + a, y: y + b }, { x: x - a, y: y + b }];
  }
  const obj = {
    id: opts.id || makeLandscapeId(),
    kind: def.kind,
    x: Math.round(x),
    y: Math.round(y),
    rotation: 0,
    w: 1,
    h: 1,
    height: opts.height ?? def.height,
    variant: opts.variant || def.variants[0].id,
    meta: { ...(def.meta || {}), ...(opts.meta || {}) },
    points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  };
  if (line) {
    obj.width = clampWidth(opts.width ?? def.h);
    Object.assign(obj, pathParams(opts, obj.points.length));
  }
  if (opts.smooth) obj.smooth = true;
  if (opts.color) obj.color = opts.color;
  if (opts.locked) obj.locked = true;
  return syncShape(obj);
}

export const clampWidth = (w) => Math.min(LINE_WIDTH_MAX, Math.max(LINE_WIDTH_MIN, Math.round(Number(w) || 1000)));

// Необязательные поля линейного объекта (углы и укладка); без них — как
// раньше: «естественная» укладка, угол по умолчанию для материала.
//   corner   — тип угла: miter | butt | slab | round (core/path-geometry.js);
//   vcorners — тип угла по вершинам (массив длиной points, null — общий);
//   laying   — natural | strict; slabL × slabW — плита вдоль × поперёк, мм;
//   gap      — зазор, мм; align — center | left | right; offset — шаг от начала, мм;
//   checker  — шахматный тон (строгая); deck — straight | stagger (настил);
//   boardW, boardL — ширина и длина доски, мм.
export const LAYINGS = ['natural', 'strict'];
export const ALIGNS = ['center', 'left', 'right'];
export const DECKS = ['straight', 'stagger'];
export function pathParams(raw, count) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const num = (v, lo, hi) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : null);
  if (CORNER_IDS.includes(raw.corner)) out.corner = raw.corner;
  if (Array.isArray(raw.vcorners) && raw.vcorners.length === count && raw.vcorners.some((c) => CORNER_IDS.includes(c))) {
    out.vcorners = raw.vcorners.map((c) => (CORNER_IDS.includes(c) ? c : null));
  }
  if (LAYINGS.includes(raw.laying)) out.laying = raw.laying;
  if (ALIGNS.includes(raw.align) && raw.align !== 'center') out.align = raw.align;
  if (DECKS.includes(raw.deck)) out.deck = raw.deck;
  if (raw.checker === true) out.checker = true;
  const fields = { slabL: [100, 5000], slabW: [100, 6000], gap: [0, 2000], offset: [-100000, 100000], boardW: [40, 400], boardL: [200, 6000] };
  for (const [k, [lo, hi]] of Object.entries(fields)) {
    const val = num(raw[k], lo, hi);
    if (val != null) out[k] = val;
  }
  return out;
}

// Тип угла по умолчанию: плиты-ступени — угловая плита, остальное — срез.
export const defaultCorner = (o) => (o?.kind === 'path' && o.variant === 'stepping' ? 'slab' : 'miter');
export const objectCorner = (o) => o?.corner || defaultCorner(o);

// Тип угла в каждой вершине линии (концы — null).
export function pathCorners(o) {
  const n = o.points?.length || 0;
  const base = objectCorner(o);
  return Array.from({ length: n }, (_, i) => (i > 0 && i < n - 1 ? o.vcorners?.[i] || base : null));
}

// Геометрия полосы линейного объекта: участки, куски, контур (мир).
export function lineLayout(o) {
  const def = landscapeDef(o.kind);
  const smooth = Boolean(o.smooth && (o.points?.length || 0) >= 3);
  return pathLayout(objectPath(o), { width: o.width || def?.h || 1000, corners: smooth ? [] : pathCorners(o), smooth });
}

// Доски настила дорожки (строгая/естественная, прямая/со сдвигом).
export function pathBoards(o) {
  return layoutBoards(null, o, { layout: lineLayout(o) });
}

// Габарит (x, y, w, h) по точкам — после любой правки вершин.
export function syncShape(obj) {
  const path = objectPath(obj);
  if (!path.length) return obj;
  const pad = obj.width ? obj.width / 2 : 0;
  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  obj.x = Math.round((minX + maxX) / 2);
  obj.y = Math.round((minY + maxY) / 2);
  obj.w = Math.max(1, Math.round(maxX - minX));
  obj.h = Math.max(1, Math.round(maxY - minY));
  obj.rotation = 0;
  return obj;
}

// Копия объекта со сдвигом (новый id) — вставка, дубликат.
export function cloneLandscapeObject(o, dx = 0, dy = 0) {
  const copy = JSON.parse(JSON.stringify(o));
  copy.id = makeLandscapeId();
  delete copy.locked;
  return translateObject(copy, dx, dy);
}

// Сдвиг объекта целиком (с вершинами).
export function translateObject(o, dx, dy) {
  o.x += dx;
  o.y += dy;
  if (Array.isArray(o.points)) for (const p of o.points) { p.x += dx; p.y += dy; }
  return o;
}

// Поворот объекта вокруг точки (cx, cy) на deg: у фигур вращаются вершины.
export function rotateObjectAbout(o, cx, cy, deg) {
  const a = (deg * Math.PI) / 180;
  const rot = (p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: Math.round(cx + dx * Math.cos(a) - dy * Math.sin(a)), y: Math.round(cy + dx * Math.sin(a) + dy * Math.cos(a)) };
  };
  if (isPathShape(landscapeDef(o.kind)) && Array.isArray(o.points)) {
    o.points = o.points.map(rot);
    return syncShape(o);
  }
  const c = rot(o);
  o.x = c.x;
  o.y = c.y;
  o.rotation = normDeg((o.rotation || 0) + deg);
  return o;
}

// ------------------------------------------------- Вершины линий и контуров

export const minVertices = (o) => (landscapeDef(o.kind)?.shape === 'poly' ? 3 : 2);

export function moveVertex(o, index, p) {
  if (!o.points?.[index]) return o;
  o.points[index] = { x: Math.round(p.x), y: Math.round(p.y) };
  return syncShape(o);
}

// Вставка вершины после index (на ребре index → index+1).
export function insertVertex(o, index, p) {
  o.points.splice(index + 1, 0, { x: Math.round(p.x), y: Math.round(p.y) });
  if (Array.isArray(o.vcorners)) o.vcorners.splice(index + 1, 0, null);
  return syncShape(o);
}

export function removeVertex(o, index) {
  if (!o.points || o.points.length <= minVertices(o)) return false;
  o.points.splice(index, 1);
  if (Array.isArray(o.vcorners)) {
    o.vcorners.splice(index, 1);
    if (!o.vcorners.some(Boolean)) delete o.vcorners;
  }
  syncShape(o);
  return true;
}

// Вершина под точкой (мир), tol — мм.
export function hitVertex(o, p, tol) {
  let best = -1;
  let bestD = tol;
  (o.points || []).forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

// Ребро (индекс начальной вершины) под точкой: по сглаженной линии, если
// она сглажена (seg — номер исходного ребра у каждой точки выборки).
export function hitEdge(o, p, tol) {
  const closed = landscapeDef(o.kind)?.shape === 'poly';
  const path = objectPath(o);
  const n = path.length;
  let best = null;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = path[i];
    const b = path[(i + 1) % n];
    const d = pointToSegmentDistance(p, a, b);
    if (d <= tol && (!best || d < best.d)) best = { d, seg: a.seg };
  }
  return best ? best.seg : -1;
}

// ------------------------------------------------- Сглаживание и выборка

// Кривая Катмулла-Рома (центростремительная) через вершины: точки выборки
// { x, y, seg }, seg — исходное ребро. closed — замкнутый контур.
export function smoothPath(points, closed = false, stepMm = 250) {
  const n = points.length;
  if (n < 3 && !closed) return points.map((p, i) => ({ x: p.x, y: p.y, seg: Math.min(i, n - 2) }));
  const at = (i) => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
    if (i >= n) return { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y };
    return points[i];
  };
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i += 1) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    const t01 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)) || 1e-3;
    const t12 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)) || 1e-3;
    const t23 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)) || 1e-3;
    // Касательные (Барри–Голдман) для центростремительного варианта.
    const m1 = {
      x: (p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12) + (p2.x - p1.x) / t12,
      y: (p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12) + (p2.y - p1.y) / t12,
    };
    const m2 = {
      x: (p2.x - p1.x) / t12 - (p3.x - p1.x) / (t12 + t23) + (p3.x - p2.x) / t23,
      y: (p2.y - p1.y) / t12 - (p3.y - p1.y) / (t12 + t23) + (p3.y - p2.y) / t23,
    };
    m1.x *= t12; m1.y *= t12; m2.x *= t12; m2.y *= t12;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = Math.max(2, Math.min(32, Math.ceil(len / stepMm)));
    for (let j = 0; j < k; j += 1) {
      const t = j / k;
      const t2 = t * t; const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1; const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2; const h11 = t3 - t2;
      out.push({
        x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
        y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
        seg: i,
      });
    }
  }
  if (!closed) out.push({ x: points[n - 1].x, y: points[n - 1].y, seg: n - 2 });
  return out;
}

// Ось линии или контур площади (сглаженные, если smooth), мир.
export function objectPath(o) {
  const pts = o.points || [];
  const closed = landscapeDef(o.kind)?.shape === 'poly';
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y, seg: 0 }));
  if (o.smooth && pts.length >= (closed ? 3 : 3)) return smoothPath(pts, closed);
  return pts.map((p, i) => ({ x: p.x, y: p.y, seg: closed ? i : Math.min(i, pts.length - 2) }));
}

export function polylineLength(pts, closed = false) {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// Полоса шириной width вдоль ломаной: левый край + правый в обратном порядке.
export function ribbonOutline(path, width) {
  const n = path.length;
  if (n < 2) return [];
  const hw = width / 2;
  const left = [];
  const right = [];
  const norm = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  for (let i = 0; i < n; i += 1) {
    const n1 = i > 0 ? norm(path[i - 1], path[i]) : null;
    const n2 = i < n - 1 ? norm(path[i], path[i + 1]) : null;
    let nx = (n1?.x || 0) + (n2?.x || 0);
    let ny = (n1?.y || 0) + (n2?.y || 0);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const ref = n1 || n2;
    const cos = Math.max(0.5, nx * ref.x + ny * ref.y); // срез острых углов
    const k = hw / cos;
    left.push({ x: path[i].x + nx * k, y: path[i].y + ny * k });
    right.push({ x: path[i].x - nx * k, y: path[i].y - ny * k });
  }
  return [...left, ...right.reverse()];
}

// Точка и направление на расстоянии s вдоль ломаной.
export function pointAlong(path, s) {
  let rest = s;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]; const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len || i === path.length - 2) {
      const t = len ? Math.min(1, Math.max(0, rest / len)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    rest -= len;
  }
  const p = path[0] || { x: 0, y: 0 };
  return { x: p.x, y: p.y, angle: 0 };
}

// Плиты-ступени дорожки: { x, y, angle (рад), along, across, tone, ci
// (номер краски 0..2), corner? }. «Естественная» укладка — детерминированный
// разброс тона, поворота и сдвига по id (как раньше); «строгая» — ровные
// одинаковые плиты с постоянным шагом. На изломах — по типу угла, без
// наложений (core/path-geometry.js).
export function steppingSlabs(o) {
  return layoutSlabs(null, o, { layout: lineLayout(o) });
}

// Длина (м) линейного объекта; у площадного — периметр.
export function objectLengthM(o) {
  const def = landscapeDef(o.kind);
  if (!isPathShape(def)) return 0;
  return polylineLength(objectPath(o), def.shape === 'poly') / 1000;
}

function normDeg(d) {
  const n = Number(d) || 0;
  return ((n % 360) + 360) % 360;
}

// Размер в пределах типа; у круглых — w = h.
export function clampSize(obj, def = landscapeDef(obj.kind)) {
  if (!def || isPathShape(def)) return obj;
  const cl = (val, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(val) || lo)));
  obj.w = cl(obj.w, def.min.w, def.max.w);
  obj.h = def.lockAspect ? obj.w : cl(obj.h, def.min.h, def.max.h);
  return obj;
}

function syncRadius(obj, def) {
  if (def?.shape === 'point') obj.r = Math.round(obj.w / 2);
  else delete obj.r;
  return obj;
}

// Новый размер (из панели или ручкой): пределы типа + радиус кроны.
export function resizeObject(obj, w, h = w) {
  const def = landscapeDef(obj.kind);
  if (isPathShape(def)) {
    // Фигура: вершины масштабируются от центра габарита.
    const pad = obj.width || 0;
    const kx = Math.max(1, w - pad) / Math.max(1, obj.w - pad);
    const ky = Math.max(1, h - pad) / Math.max(1, obj.h - pad);
    const cx = obj.x; const cy = obj.y;
    obj.points = obj.points.map((p) => ({ x: Math.round(cx + (p.x - cx) * kx), y: Math.round(cy + (p.y - cy) * ky) }));
    return syncShape(obj);
  }
  obj.w = w;
  obj.h = h;
  clampSize(obj, def);
  return syncRadius(obj, def);
}

export function normalizeLandscapeObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const def = landscapeDef(raw.kind);
  if (!def) return null;
  const num = (val) => (Number.isFinite(Number(val)) ? Number(val) : null);
  const x = num(raw.x);
  const y = num(raw.y);
  if (x == null || y == null) return null;
  const r = num(raw.r);
  if (isPathShape(def)) {
    const points = Array.isArray(raw.points) ? raw.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
    if (points.length < (def.shape === 'poly' ? 3 : 2)) return null;
    return createLandscapeObject(raw.kind, x, y, {
      id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
      height: num(raw.height) ?? def.height,
      variant: def.variants.some((x2) => x2.id === raw.variant) ? raw.variant : undefined,
      color: typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : undefined,
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined,
      points,
      width: num(raw.width) ?? undefined,
      smooth: raw.smooth === true,
      locked: raw.locked === true,
      ...(def.shape === 'line' ? pathParams(raw, points.length) : {}),
    });
  }
  const obj = createLandscapeObject(raw.kind, x, y, {
    id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
    rotation: num(raw.rotation) || 0,
    w: num(raw.w) ?? (r != null ? r * 2 : def.w),
    h: num(raw.h) ?? (r != null ? r * 2 : def.h),
    height: num(raw.height) ?? def.height,
    variant: def.variants.some((x2) => x2.id === raw.variant) ? raw.variant : undefined,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : undefined,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined,
    locked: raw.locked === true,
  });
  return obj;
}

// Необязательное поле участка: битые объекты отбрасываются, нет поля — пусто.
export function normalizeLandscape(raw) {
  const list = Array.isArray(raw?.objects) ? raw.objects : [];
  const seen = new Set();
  const objects = [];
  for (const item of list) {
    const obj = normalizeLandscapeObject(item);
    if (!obj) continue;
    if (seen.has(obj.id)) obj.id = makeLandscapeId();
    seen.add(obj.id);
    objects.push(obj);
  }
  return { objects };
}

// ---------------------------------------------------------------- Геометрия

const rad = (deg) => ((deg || 0) * Math.PI) / 180;

// Точка мира → собственные оси объекта (центр в 0,0).
export function toLocal(obj, p) {
  const a = -rad(obj.rotation);
  const dx = p.x - obj.x;
  const dy = p.y - obj.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

export function toWorld(obj, lx, ly) {
  const a = rad(obj.rotation);
  return { x: obj.x + lx * Math.cos(a) - ly * Math.sin(a), y: obj.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

export function isRoundObject(obj, def = landscapeDef(obj.kind)) {
  if (!def) return false;
  if (def.round) return true;
  return obj.kind === 'jacuzzi' && obj.variant === 'round';
}

// Углы габарита (с поворотом): nw, ne, se, sw.
export function objectCorners(obj) {
  const a = obj.w / 2;
  const b = obj.h / 2;
  return [
    { id: 'nw', ...toWorld(obj, -a, -b) },
    { id: 'ne', ...toWorld(obj, a, -b) },
    { id: 'se', ...toWorld(obj, a, b) },
    { id: 'sw', ...toWorld(obj, -a, b) },
  ];
}

// Контур объекта для проверок (эллипс — многоугольником).
export function objectOutline(obj, segments = 24) {
  const def = landscapeDef(obj.kind);
  if (def?.shape === 'poly') return objectPath(obj).map(({ x, y }) => ({ x, y }));
  if (def?.shape === 'line') return lineLayout(obj).outline;
  if (!isRoundObject(obj)) return objectCorners(obj).map(({ x, y }) => ({ x, y }));
  const out = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    out.push(toWorld(obj, (Math.cos(t) * obj.w) / 2, (Math.sin(t) * obj.h) / 2));
  }
  return out;
}

export function objectBox(obj) {
  const pts = objectCorners(obj);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// Попадание точки (мир) в объект; tol — запас в мм (клик по мелочи).
export function pointInObject(obj, p, tol = 0) {
  const def = landscapeDef(obj.kind);
  if (def?.shape === 'line') {
    const path = objectPath(obj);
    const half = (obj.width || def.h) / 2 + tol;
    for (let i = 0; i < path.length - 1; i += 1) if (pointToSegmentDistance(p, path[i], path[i + 1]) <= half) return true;
    return false;
  }
  if (def?.shape === 'poly') {
    const path = objectPath(obj);
    if (path.length < 3) return false;
    if (pointInPolygon(p, path)) return true;
    return tol > 0 && distanceToPolygon(p, path) <= tol;
  }
  const l = toLocal(obj, p);
  const a = obj.w / 2 + tol;
  const b = obj.h / 2 + tol;
  if (isRoundObject(obj)) return (l.x * l.x) / (a * a) + (l.y * l.y) / (b * b) <= 1;
  return Math.abs(l.x) <= a && Math.abs(l.y) <= b;
}

// Порядок внутри слоя: площади → линии → остальные (и в отрисовке).
export const SHAPE_RANK = { poly: 0, line: 1, point: 2, circle: 2, rect: 2 };

// Верхний объект под точкой: высокие (кроны) поверх, затем позже добавленные.
export function hitLandscape(objects, p, tol = 0) {
  const order = { tall: 2, low: 1, ground: 0 };
  let best = null;
  objects.forEach((obj, index) => {
    if (!pointInObject(obj, p, tol)) return;
    const def = landscapeDef(obj.kind);
    const z = (order[def?.layer] ?? 1) * 1e6 + (SHAPE_RANK[def?.shape] ?? 2) * 1e5 + index;
    if (!best || z > best.z) best = { obj, z };
  });
  return best?.obj || null;
}

// Объекты, центр которых внутри многоугольника (рамка выделения).
export function objectsInPolygon(objects, polygon) {
  return objects.filter((o) => pointInPolygon({ x: o.x, y: o.y }, polygon));
}

// Выходит ли объект за границу участка (хоть одна точка контура снаружи).
export function isOutsideSite(obj, boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) return false;
  // Линии (ограждение по границе) — по оси; точки на самой границе — внутри.
  const def = landscapeDef(obj.kind);
  const pts = def?.shape === 'line' ? objectPath(obj) : objectOutline(obj, 16);
  return pts.some((p) => !pointInPolygon(p, boundary) && distanceToPolygon(p, boundary) > 50);
}

export function distanceToPolygon(p, polygon) {
  if (pointInPolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    best = Math.min(best, pointToSegmentDistance(p, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return best;
}

const isTree = (def) => def?.group === 'Деревья';

// Мягкие предупреждения: id → [текст]. footprints — контуры дома (мир).
export function landscapeWarnings(objects, { boundary = null, footprints = [] } = {}) {
  const out = new Map();
  const add = (id, text) => { if (!out.has(id)) out.set(id, []); out.get(id).push(text); };
  for (const obj of objects || []) {
    const def = landscapeDef(obj.kind);
    // Предупреждение «за границей участка» отключено: на скошенных границах и в углах давало ложные срабатывания.
    if (isTree(def) && footprints.length) {
      const d = Math.min(...footprints.map((f) => distanceToPolygon(obj, f)));
      if (d < TREE_HOUSE_MIN) add(obj.id, `Дерево в ${(d / 1000).toFixed(1)} м от дома (рекомендуется от ${TREE_HOUSE_MIN / 1000} м)`);
    }
  }
  return out;
}

// Площадь объекта, м² (для сводки и ТЭП этапа 2).
export function objectAreaM2(obj) {
  const def = landscapeDef(obj.kind);
  if (def?.shape === 'poly') return polygonArea(objectPath(obj)) / 1e6;
  if (def?.shape === 'line') {
    if (obj.kind === 'path' && obj.variant === 'stepping') {
      return steppingSlabs(obj).reduce((s, sl) => s + sl.along * sl.across, 0) / 1e6;
    }
    // Скругления меняют площадь — по контуру; срез/встык/угловая — длина × ширина.
    if (!obj.smooth && pathCorners(obj).includes('round')) return areaOf(lineLayout(obj).outline) / 1e6;
    return (polylineLength(objectPath(obj)) * (obj.width || def.h)) / 1e6;
  }
  const area =isRoundObject(obj) ? (Math.PI * obj.w * obj.h) / 4 : obj.w * obj.h;
  return area / 1e6;
}

export function landscapeSummary(objects) {
  let trees = 0;
  let cover = 0;
  for (const obj of objects || []) {
    const def = landscapeDef(obj.kind);
    if (isTree(def)) trees += 1;
    if (def?.cover) cover += objectAreaM2(obj);
  }
  return { count: (objects || []).length, trees, coverM2: cover };
}

// Ручки выбранного объекта (мир): квадраты на углах (размер) и круги снаружи
// углов (поворот); outPx — отступ кругов в экранных пикселях.
export function landscapeHandles(obj, outPx, scale) {
  const out = outPx / (scale || 1);
  const a = obj.w / 2;
  const b = obj.h / 2;
  const corners = objectCorners(obj);
  const sign = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };
  const k = Math.SQRT1_2;
  const rotators = Object.entries(sign).map(([id, [sx, sy]]) => ({ id, ...toWorld(obj, sx * (a + out * k), sy * (b + out * k)) }));
  return { corners, rotators };
}

// Детерминированный «случайный» ряд по id (текстуры, разброс цветов).
export function seededRandom(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
