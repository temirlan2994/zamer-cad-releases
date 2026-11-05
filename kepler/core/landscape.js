// Ландшафт (благоустройство участка): каталог объектов и геометрия. Без DOM.
//
// Данные: project.site.landscape = { objects: [...] } — в координатах
// участка (съёмки), как граница и соседи. Поле необязательное: в старых
// проектах его нет, normalizeLandscape() даёт пустой список (схема
// kepler-plan/5 не меняется).
//
// Объект: { id, kind, x, y, rotation, w, h, r?, height, variant, color?, points?, meta }
//   x, y      — центр (для линейных/площадных — центр габарита точек);
//   w, h      — габарит в собственных осях до поворота (мм);
//   r         — радиус кроны (только деревья/кусты-шары, = w/2);
//   rotation  — градусы по часовой (ось Y вниз);
//   points    — для shape 'line' (ось дорожки, ширина = h) и 'poly' (контур);
//   meta      — свободные параметры вида (места парковки и т.п.).
//
// Формы (shape):
//   'point'  — точечный объект с круглой кроной/основанием, масштаб по одной оси;
//   'circle' — круглая площадка (w = h);
//   'rect'   — прямоугольник/овал (round: true — эллипс), стороны независимы;
//   'line'   — линейный (дорожка, изгородь по ломаной) — этап 2;
//   'poly'   — площадной (газон, гравий, плитка, пруд произвольной формы) — этап 2.

import { pointInPolygon, pointToSegmentDistance } from './zamer/geometry.js';

export const LANDSCAPE_CATEGORIES = [
  { id: 'green', title: 'Озеленение' },
  { id: 'site', title: 'Ландшафт и площадки' },
];

export const LANDSCAPE_SHAPES = ['point', 'circle', 'rect', 'line', 'poly'];

// Дерево ближе этого расстояния к стене дома — мягкое предупреждение.
export const TREE_HOUSE_MIN = 3000;

// Палитра «вид сверху»: средние тона, одинаково читаются на светлом и
// тёмном холсте (растительность и материалы — не токены темы, а «краски»).
export const LS_COLORS = {
  leaf: ['#4f8a3c', '#6aa84f', '#8cc46a'],
  leafDark: ['#3d6f35', '#52883f', '#6f9f55'],
  birch: ['#7fb35a', '#9ccc6f', '#bfe08c'],
  oak: ['#3f7a34', '#579141', '#77ad57'],
  pine: ['#2f6a43', '#3f8255', '#5c9d6b'],
  spruce: ['#24584a', '#2f6d5b', '#4a8a74'],
  thuja: ['#356f3a', '#4b8a47', '#6aa45d'],
  box: ['#3f7d3a', '#5b9a4a', '#8ccf6c'],
  juniper: ['#3e7a66', '#57947c', '#79b096'],
  grass: ['#a8b06a', '#c7c486', '#7f9a52'],
  lawn: ['#79a957', '#8bb965', '#6b9a4b'],
  soil: ['#6e5442', '#5d4637', '#80634e'],
  stone: ['#9a9a94', '#b7b6ae', '#7f7f79'],
  gravel: ['#c8bda8', '#a99f8c', '#ddd3c0'],
  tiles: ['#c6c0b5', '#a9a398', '#d9d4ca'],
  deck: ['#a8714a', '#8e5d3b', '#bf875c'],
  asphalt: ['#7d838b', '#6c727a', '#90969d'],
  roof: ['#7a5a46', '#946e56', '#5f4434'],
  water: ['#58b7dc', '#2f8fc4', '#a9e2f5'],
  pond: ['#3f8c95', '#2d6f7a', '#86c7c9'],
  sand: ['#e3cc93', '#d4b878', '#efdfb2'],
  rubber: ['#4f9a6e', '#3f845c', '#6db68a'],
  wood: ['#9b6a43', '#7f5536', '#b88458'],
  metal: ['#4a4f57', '#373b42', '#6c727b'],
  fire: ['#ffb43c', '#ff6a2a', '#ffe7a0'],
  coping: ['#e6e1d6', '#cfc8ba', '#f3efe7'],
  glass: ['#cfe7ef', '#a8cfdc', '#eef8fb'],
  car: ['#d9dde3', '#2c3440', '#9a2f2f', '#3a5f8f', '#c9c2b0', '#5b6b5a'],
  flowers: ['#e84d6f', '#f2c14e', '#b06ad9', '#ffffff', '#ff8c42', '#e05a9e'],
  fruit: ['#e0533d', '#f0b43c', '#c8314b', '#f08a3c'],
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
//   stage                   — 1: доступно сейчас, 2: только описание (этап 2).
const RAW = [
  // ---------------------------------------------------------- Озеленение
  { kind: 'tree-pine', title: 'Сосна', cat: 'green', group: 'Деревья', shape: 'point', w: 5000, min: 1500, max: 12000, height: 15000, look: 'pine', colors: 'pine',
    variants: [v('scots', 'Сосна обыкновенная'), v('mugo', 'Сосна горная', ['#2d6450', '#3d7a62', '#5a957a'])], keywords: 'хвойное дерево' },
  { kind: 'tree-spruce', title: 'Ель', cat: 'green', group: 'Деревья', shape: 'point', w: 4000, min: 1200, max: 10000, height: 14000, look: 'spruce', colors: 'spruce',
    variants: [v('common', 'Ель обыкновенная'), v('blue', 'Ель голубая', ['#3d6e78', '#55868f', '#7aa6ad'])], keywords: 'хвойное дерево ёлка' },
  { kind: 'tree-birch', title: 'Берёза', cat: 'green', group: 'Деревья', shape: 'point', w: 5000, min: 1500, max: 12000, height: 14000, look: 'deciduous', colors: 'birch',
    variants: [v('summer', 'Летняя крона'), v('autumn', 'Осенняя крона', ['#c99a3a', '#ddb556', '#efd27c'])], keywords: 'лиственное дерево' },
  { kind: 'tree-oak', title: 'Дуб / клён', cat: 'green', group: 'Деревья', shape: 'point', w: 9000, min: 3000, max: 18000, height: 16000, look: 'deciduous', colors: 'oak',
    variants: [v('oak', 'Дуб'), v('maple', 'Клён', ['#4d8a3a', '#6aa548', '#8fc062']), v('maple-red', 'Клён красный', ['#9a3b2f', '#b8513d', '#d3775a'])], keywords: 'лиственное широкая крона' },
  { kind: 'tree-fruit', title: 'Плодовое дерево', cat: 'green', group: 'Деревья', shape: 'point', w: 4000, min: 1500, max: 8000, height: 5000, look: 'fruit', colors: 'leaf',
    variants: [v('apple', 'Яблоня'), v('pear', 'Груша'), v('cherry', 'Вишня'), v('apricot', 'Абрикос')], keywords: 'сад яблоня груша вишня' },
  { kind: 'tree-thuja', title: 'Туя / кипарис', cat: 'green', group: 'Деревья', shape: 'rect', round: true, w: 900, h: 1400, min: [500, 700], max: [2500, 3500], height: 6000, look: 'thuja', colors: 'thuja',
    variants: [v('thuja', 'Туя колонновидная'), v('cypress', 'Кипарис', ['#2e5d3f', '#3f7550', '#5b8f68'])], keywords: 'колонновидное хвойное' },
  { kind: 'tree-bonsai', title: 'Бонсай-сосна', cat: 'green', group: 'Деревья', shape: 'point', w: 2600, min: 1200, max: 5000, height: 2500, look: 'bonsai', colors: 'pine',
    variants: [v('niwaki', 'Ниваки'), v('cloud', 'Облачная стрижка')], keywords: 'японский сад декоративное' },
  { kind: 'shrub-box', title: 'Самшит шаровидный', cat: 'green', group: 'Кустарники', shape: 'point', w: 900, min: 300, max: 2500, height: 900, look: 'ball', colors: 'box',
    variants: [v('box', 'Самшит'), v('pittosporum', 'Шар светлый', ['#6f9e4a', '#8cb95c', '#b9dc86'])], keywords: 'шар куст японский сад' },
  { kind: 'shrub-juniper', title: 'Можжевельник стелющийся', cat: 'green', group: 'Кустарники', shape: 'rect', round: true, w: 2400, h: 1400, min: [600, 400], max: [6000, 4000], height: 500, look: 'juniper', colors: 'juniper',
    variants: [v('blue', 'Сизый'), v('green', 'Зелёный', ['#3f7a45', '#56925a', '#7aae6e'])], keywords: 'хвойный почвопокровный' },
  { kind: 'shrub-flower', title: 'Сирень / спирея', cat: 'green', group: 'Кустарники', shape: 'point', w: 2200, min: 800, max: 5000, height: 2500, look: 'shrub', colors: 'leaf',
    variants: [v('lilac', 'Сирень'), v('spiraea', 'Спирея'), v('hydrangea', 'Гортензия')], keywords: 'цветущий куст' },
  { kind: 'hedge', title: 'Живая изгородь (секция)', cat: 'green', group: 'Кустарники', shape: 'rect', w: 3000, h: 800, min: [600, 400], max: [20000, 2500], height: 1800, look: 'hedge', colors: 'leafDark',
    variants: [v('trim', 'Стриженая'), v('free', 'Свободная')], keywords: 'туя граница' },
  { kind: 'bed-round', title: 'Клумба круглая', cat: 'green', group: 'Цветники', shape: 'circle', w: 2000, min: 600, max: 8000, height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('roses', 'Розы', ['#d2364f']), v('lavender', 'Лаванда', ['#9b7fd1'])], keywords: 'цветы' },
  { kind: 'bed-rect', title: 'Клумба прямоугольная', cat: 'green', group: 'Цветники', shape: 'rect', w: 3000, h: 1200, min: [600, 400], max: [15000, 6000], height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('roses', 'Розы', ['#d2364f']), v('lavender', 'Лаванда', ['#9b7fd1'])], keywords: 'цветы' },
  { kind: 'bed-strip', title: 'Цветочная полоса', cat: 'green', group: 'Цветники', shape: 'rect', w: 6000, h: 600, min: [1000, 300], max: [30000, 2000], height: 400, cover: true, look: 'flowerbed', colors: 'soil',
    variants: [v('mixed', 'Пёстрая'), v('lavender', 'Лаванда', ['#9b7fd1']), v('tulips', 'Тюльпаны', ['#e8433f', '#f2c14e'])], keywords: 'бордюр миксбордер' },
  { kind: 'lawn-patch', title: 'Газон (пятно)', cat: 'green', group: 'Газон', shape: 'rect', round: true, w: 5000, h: 3500, min: [1000, 1000], max: [40000, 40000], height: 0, cover: true, look: 'lawn', colors: 'lawn',
    variants: [v('mown', 'Стриженый, полосы'), v('meadow', 'Мавританский', ['#8fb35e', '#a5c470', '#79a04f'])], keywords: 'трава' },
  { kind: 'grass-clump', title: 'Декоративные злаки', cat: 'green', group: 'Газон', shape: 'point', w: 1000, min: 400, max: 3000, height: 1000, look: 'grass', colors: 'grass',
    variants: [v('miscanthus', 'Мискантус'), v('festuca', 'Овсяница сизая', ['#7f9fa3', '#9bb8b9', '#647f83'])], keywords: 'куртина травы' },
  { kind: 'boulder', title: 'Валун', cat: 'green', group: 'Камни', shape: 'rect', w: 1200, h: 900, min: [300, 300], max: [5000, 5000], height: 700, look: 'boulder', colors: 'stone',
    variants: [v('one', 'Одиночный'), v('trio', 'Группа из трёх')], keywords: 'камень японский сад' },
  { kind: 'lawn-area', title: 'Газон (контур)', cat: 'green', group: 'Газон', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'lawn', colors: 'lawn', stage: 2, keywords: 'трава' },
  { kind: 'hedge-line', title: 'Живая изгородь (по линии)', cat: 'green', group: 'Кустарники', shape: 'line', w: 6000, h: 800, height: 1800, look: 'hedge', colors: 'leafDark', stage: 2 },

  // ------------------------------------------------- Ландшафт и площадки
  { kind: 'parking-1', layer: 'ground', title: 'Парковочное место', cat: 'site', group: 'Парковка', shape: 'rect', w: 2500, h: 5300, min: [2300, 4500], max: [4000, 7000], height: 1500, cover: true, look: 'parking', colors: 'asphalt',
    variants: [v('car', 'С машиной'), v('empty', 'Пустое')], keywords: 'машина стоянка' },
  { kind: 'parking-2', layer: 'ground', title: 'Парковка на 2 машины', cat: 'site', group: 'Парковка', shape: 'rect', w: 5200, h: 5300, min: [4600, 4500], max: [8000, 7000], height: 1500, cover: true, look: 'parking', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('pavers', 'Плитка', ['#9a9690', '#85817b', '#b0aca5']), v('asphalt', 'Асфальт', ['#7d838b', '#6c727a', '#90969d'])], meta: { spaces: 2 }, keywords: 'машина стоянка гравий' },
  { kind: 'parking-guest', layer: 'ground', title: 'Гостевая парковка', cat: 'site', group: 'Парковка', shape: 'rect', w: 2500, h: 5300, min: [2300, 4500], max: [8000, 7000], height: 0, cover: true, look: 'parking-grass', colors: 'lawn',
    variants: [v('grid', 'Газонная решётка')], keywords: 'эко-парковка' },
  { kind: 'carport', title: 'Навес для машины', cat: 'site', group: 'Парковка', shape: 'rect', w: 3000, h: 6000, min: [2600, 4800], max: [7000, 8000], height: 2600, tall: true, cover: true, look: 'carport', colors: 'metal',
    variants: [v('poly', 'Поликарбонат'), v('wood', 'Дерево', ['#8e5d3b', '#a8714a', '#6f4529'])], keywords: 'carport гараж' },
  { kind: 'pad', title: 'Площадка', cat: 'site', group: 'Площадки', shape: 'rect', w: 4000, h: 3000, min: [800, 800], max: [30000, 30000], height: 0, cover: true, look: 'pad', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('tiles', 'Плитка'), v('deck', 'Настил')], keywords: 'гравий плитка настил' },
  { kind: 'pad-round', title: 'Площадка круглая', cat: 'site', group: 'Площадки', shape: 'circle', w: 4000, min: 800, max: 20000, height: 0, cover: true, look: 'pad', colors: 'gravel',
    variants: [v('gravel', 'Гравий'), v('tiles', 'Плитка'), v('deck', 'Настил')], keywords: 'гравий плитка настил' },
  { kind: 'terrace-deck', title: 'Терраса-настил', cat: 'site', group: 'Площадки', shape: 'rect', w: 6000, h: 3500, min: [1500, 1200], max: [30000, 15000], height: 300, cover: true, look: 'deck', colors: 'deck',
    variants: [v('larch', 'Лиственница'), v('wpc', 'ДПК графит', ['#5d5650', '#4b4540', '#706962']), v('teak', 'Тик', ['#b7834f', '#9c6b3e', '#cf9a65'])], keywords: 'доски настил' },
  { kind: 'gazebo', title: 'Беседка', cat: 'site', group: 'Отдых', shape: 'rect', w: 3500, h: 3500, min: [2000, 2000], max: [8000, 8000], height: 3200, tall: true, look: 'gazebo', colors: 'roof',
    variants: [v('hip', 'Четырёхскатная'), v('hex', 'Шестигранная'), v('flat', 'Павильон, плоская крыша', ['#5a5f66', '#6d737a', '#474b51'])], keywords: 'павильон' },
  { kind: 'pergola', title: 'Пергола', cat: 'site', group: 'Отдых', shape: 'rect', w: 3000, h: 4000, min: [1500, 1500], max: [10000, 10000], height: 2700, tall: true, look: 'pergola', colors: 'wood',
    variants: [v('wood', 'Дерево'), v('metal', 'Металл', ['#4a4f57', '#373b42', '#6c727b'])], keywords: 'навес' },
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
    variants: [v('rubber', 'Резиновое покрытие'), v('sand', 'Песок', ['#e3cc93', '#d4b878', '#efdfb2'])], keywords: 'горка дети' },
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
    variants: [v('white', 'Белые'), v('teak', 'Тик', ['#b7834f', '#9c6b3e', '#efe6d6'])], keywords: 'лежак' },
  { kind: 'bench', title: 'Садовая скамья', cat: 'site', group: 'Мебель', shape: 'rect', w: 1600, h: 600, min: [800, 400], max: [4000, 900], height: 450, look: 'bench', colors: 'wood',
    variants: [v('wood', 'Дерево')], keywords: 'лавка' },
  { kind: 'table-set', title: 'Стол со стульями', cat: 'site', group: 'Мебель', shape: 'rect', w: 2400, h: 2400, min: [1600, 1600], max: [5000, 4000], height: 750, look: 'table-set', colors: 'wood',
    variants: [v('round', 'Круглый'), v('rect', 'Прямоугольный')], keywords: 'обед уличный' },
  { kind: 'lamp', title: 'Садовый светильник', cat: 'site', group: 'Мебель', shape: 'point', w: 400, min: 200, max: 1000, height: 900, look: 'lamp', colors: 'metal',
    variants: [v('bollard', 'Столбик'), v('pole', 'Фонарь на опоре')], keywords: 'свет фонарь' },
  { kind: 'fence', title: 'Ограждение (секция)', cat: 'site', group: 'Ограждение', shape: 'rect', w: 3000, h: 150, min: [500, 50], max: [10000, 400], height: 1800, look: 'fence', colors: 'wood',
    variants: [v('wood', 'Дерево'), v('metal', 'Металл', ['#4a4f57', '#373b42', '#6c727b'])], keywords: 'забор' },
  { kind: 'gate', title: 'Калитка / ворота', cat: 'site', group: 'Ограждение', shape: 'rect', w: 4000, h: 200, min: [800, 100], max: [7000, 400], height: 1800, look: 'gate', colors: 'metal',
    variants: [v('gate', 'Ворота распашные'), v('wicket', 'Калитка')], keywords: 'въезд забор' },
  { kind: 'path', title: 'Дорожка', cat: 'site', group: 'Площадки', shape: 'line', w: 6000, h: 1000, height: 0, cover: true, look: 'path', colors: 'tiles', stage: 2,
    variants: [v('stepping', 'Плиты-ступени'), v('gravel', 'Гравий'), v('deck', 'Деревянная')] },
  { kind: 'paving-area', title: 'Мощение (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'pad', colors: 'tiles', stage: 2 },
  { kind: 'gravel-area', title: 'Гравий (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 0, cover: true, look: 'pad', colors: 'gravel', stage: 2 },
  { kind: 'deck-area', title: 'Настил (контур)', cat: 'site', group: 'Площадки', shape: 'poly', w: 6000, h: 4000, height: 300, cover: true, look: 'deck', colors: 'deck', stage: 2 },
  { kind: 'pond-area', title: 'Пруд (контур)', cat: 'site', group: 'Вода', shape: 'poly', w: 5000, h: 3000, height: 0, cover: true, look: 'pond', colors: 'pond', stage: 2 },
  { kind: 'pool-area', title: 'Бассейн-чаша (контур)', cat: 'site', group: 'Вода', shape: 'poly', w: 6000, h: 3000, height: 0, cover: true, look: 'pool', colors: 'water', stage: 2 },
];

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

export function createLandscapeObject(kind, x, y, opts = {}) {
  const def = landscapeDef(kind);
  if (!def) throw new Error(`Неизвестный объект ландшафта: ${kind}`);
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
  if (opts.points) obj.points = opts.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  return syncRadius(clampSize(obj, def), def);
}

function normDeg(d) {
  const n = Number(d) || 0;
  return ((n % 360) + 360) % 360;
}

// Размер в пределах типа; у круглых — w = h.
export function clampSize(obj, def = landscapeDef(obj.kind)) {
  if (!def) return obj;
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
  const obj = createLandscapeObject(raw.kind, x, y, {
    id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
    rotation: num(raw.rotation) || 0,
    w: num(raw.w) ?? (r != null ? r * 2 : def.w),
    h: num(raw.h) ?? (r != null ? r * 2 : def.h),
    height: num(raw.height) ?? def.height,
    variant: def.variants.some((x2) => x2.id === raw.variant) ? raw.variant : undefined,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : undefined,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined,
    points: Array.isArray(raw.points)
      ? raw.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : undefined,
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
  const l = toLocal(obj, p);
  const a = obj.w / 2 + tol;
  const b = obj.h / 2 + tol;
  if (isRoundObject(obj)) return (l.x * l.x) / (a * a) + (l.y * l.y) / (b * b) <= 1;
  return Math.abs(l.x) <= a && Math.abs(l.y) <= b;
}

// Верхний объект под точкой: высокие (кроны) поверх, затем позже добавленные.
export function hitLandscape(objects, p, tol = 0) {
  const order = { tall: 2, low: 1, ground: 0 };
  let best = null;
  objects.forEach((obj, index) => {
    if (!pointInObject(obj, p, tol)) return;
    const z = (order[landscapeDef(obj.kind)?.layer] ?? 1) * 1e6 + index;
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
  return objectOutline(obj, 16).some((p) => !pointInPolygon(p, boundary));
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
    if (isOutsideSite(obj, boundary)) add(obj.id, 'За границей участка');
    if (isTree(def) && footprints.length) {
      const d = Math.min(...footprints.map((f) => distanceToPolygon(obj, f)));
      if (d < TREE_HOUSE_MIN) add(obj.id, `Дерево в ${(d / 1000).toFixed(1)} м от дома (рекомендуется от ${TREE_HOUSE_MIN / 1000} м)`);
    }
  }
  return out;
}

// Площадь объекта, м² (для сводки и ТЭП этапа 2).
export function objectAreaM2(obj) {
  const area = isRoundObject(obj) ? (Math.PI * obj.w * obj.h) / 4 : obj.w * obj.h;
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
