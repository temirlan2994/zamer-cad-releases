// Наружная отделка. Размеры в миллиметрах, высота null — во всю высоту стены.
export const FACADE_ELEMENTS = Object.freeze({
  slats: { name: 'Деревянные рейки', w: 1200, d: 65, h: null, finishes: { 'Термоясень': '#94674a', 'Светлый дуб': '#ba926b', 'Морёный дуб': '#554337' } },
  stone: { name: 'Каменная панель', w: 1200, d: 50, h: null, finishes: { 'Известняк': '#aca69a', 'Травертин': '#c4b7a3', 'Сланец': '#626669' } },
  canopy: { name: 'Навес', w: 3600, d: 1800, h: 240, finishes: { 'Графит': '#404448', 'Бронза': '#68584c', 'Светлый металл': '#babdc1' } },
  band: { name: 'Межэтажный пояс', w: 3600, d: 200, h: 320, finishes: { 'Графит': '#404448', 'Бронза': '#68584c', 'Светлый металл': '#babdc1' } },
  post: { name: 'Стойка навеса', w: 180, d: 180, h: null, compositionOnly: true, finishes: { 'Графит': '#404448', 'Термоясень': '#94674a', 'Светлый металл': '#babdc1' } },
  decking: { name: 'Настил террасы', w: 3600, d: 2400, h: 140, compositionOnly: true, finishes: { 'Лиственница': '#9b7960', 'Тик': '#b59370', 'ДПК графит': '#66625e' } },
  light: { name: 'Линейная подсветка', w: 2400, d: 45, h: 35, finishes: { 'Тёплый белый': '#ffdd9f', 'Нейтральный белый': '#fff1db', 'Холодный белый': '#deefff' } },
});

export const isFacadeKind = (kind) => Object.hasOwn(FACADE_ELEMENTS, kind);
