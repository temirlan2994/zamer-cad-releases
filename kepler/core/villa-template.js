import { FURNITURE } from './catalog.js';
import { withDefaultComp } from './composite.js';
import { CORNER_PRESET } from './corner-windows.js';
import { bindFacadeToWall, createCanopyLight, createFacadeElement } from './facade.js';
import { createLandscapeObject } from './landscape.js';
import { createMass } from './masses.js';
import { createItem, createLevel, createProject, createRoom } from './model.js';
import { applyOpeningPreset } from './opening-preset.js';
import { defaultRailings } from './railings.js';
import { createSlabOpening } from './slab-openings.js';
import { setWindowSpan } from './spanning-windows.js';
import { applyStairPreset, applyStairStylePreset } from './stairs.js';

const point = (x, y) => ({ x, y });

function room(level, type, x, y, w, h, name) {
  const result = createRoom(type, x, y, w, h);
  if (name) result.name = name;
  level.rooms.push(result);
  return result;
}

function furniture(level, kind, x, y, rotation = 0) {
  const { w, h } = FURNITURE[kind];
  level.items.push(withDefaultComp(createItem(kind, x, y, w, h, rotation)));
}

function villaGarden(project) {
  const { site } = project;
  site.boundary = [point(-6500, -7000), point(24100, -7000), point(24100, 19500), point(-6500, 19500)];
  site.entry = { x: 8650, y: -7000, angle: 90 };
  const add = (kind, x, y, options) => site.landscape.objects.push(createLandscapeObject(kind, x, y, options));
  add('path', 8650, -4000, {
    points: [point(8650, -7000), point(8650, -1800)], variant: 'pavers', width: 1800,
  });
  add('pond-area', 5400, 12800, {
    points: [point(-1700, 10300), point(1200, 8950), point(5300, 9400), point(8800, 8750),
      point(11200, 10200), point(12800, 12700), point(11700, 15300), point(8100, 16200),
      point(3900, 15500), point(600, 16400), point(-2100, 14800)],
    variant: 'mirror', smooth: true,
  });
  add('water-curtain', 10450, 10050, { w: 1800, h: 900, height: 1850, rotation: 90, variant: 'graphite' });
  add('stairs-out', 15500, 10700, {
    w: 3200, h: 900, height: 450, elev: 0, elevTo: 450, variant: 'stone',
    meta: { tread: 300, steps: 0 },
  });
  add('path', 14600, 13100, {
    points: [point(15500, 11150), point(15500, 12300), point(14500, 14300), point(13000, 15000)],
    width: 1400, variant: 'stepping',
  });
  add('deck-area', 12400, 15600, {
    points: [point(10800, 14800), point(13200, 14800), point(13800, 15400), point(13800, 16900),
      point(10800, 16900)], variant: 'teak', elev: 100,
  });
  add('sunken-lounge', 8750, 15400, { w: 4100, h: 4100, rotation: 270, elev: -450, height: 800, variant: 'teak' });
  for (const [x, y, w, h] of [[-2400, 10900, 1250, 800], [0, 9600, 1550, 950],
    [1100, 9250, 800, 650], [11100, 9900, 1400, 900], [12100, 10600, 750, 650]]) {
    add('boulder', x, y, { w, h, height: Math.round(w * 0.48), rotation: 24 });
  }
  for (const [x, y, size] of [[-3400, 4300, 4200], [20700, 9000, 4400], [20100, -3300, 3800]]) {
    add('tree-pine', x, y, { w: size, h: size, height: size * 2 });
  }
  for (const [x, y, size] of [[-800, 8200, 1300], [500, 8530, 950], [1700, 8320, 1100],
    [7850, 7800, 900], [8900, 7930, 1250], [10000, 7750, 750], [18200, 11200, 1450]]) {
    add('shrub-box', x, y, { w: size, h: size, height: size * 0.8 });
  }
}

function villaFacades(project, ground, upper, living, kitchen, suite, bedroom, livingCorner) {
  const exterior = project.settings.exterior;
  project.masses = [];
  function south(kind, level, host, from, to, z) {
    const element = createFacadeElement(kind, {
      point: { x: (from + to) / 2, y: host.y + host.h + exterior, z },
      normal: { x: 0, y: 1 }, level, from, to,
    }, project.masses);
    element.w = to - from;
    bindFacadeToWall(project, element, level.id, host.id, 2);
    project.masses.push(element);
    return element;
  }
  for (const [level, west, east] of [[ground, living, kitchen], [upper, suite, bedroom]]) {
    const z = level.elevation;
    // Keep the lower stone panel on the pier between the glazing and the slats.
    if (level === ground) south('stone', level, west, west.x + livingCorner.width - exterior / 2, west.x + west.w - 1400, z);
    else south('stone', level, west, west.x, west.x + 950, z);
    south('slats', level, west, west.x + west.w - 1400, west.x + west.w, z);
    south('stone', level, east, east.x, east.x + 850, z);
    south('band', level, west, west.x, west.x + west.w, z + level.height - 250);
    south('light', level, west, west.x, west.x + west.w, z + level.height - 460);
  }
  const canopy = south('canopy', ground, kitchen, kitchen.x, kitchen.x + kitchen.w, ground.height - 520);
  canopy.d = 2400;
  canopy.y = kitchen.y + kitchen.h + exterior + canopy.d / 2;
  project.masses.push(createCanopyLight(canopy, project.masses));
  for (const x of [kitchen.x + 280, kitchen.x + kitchen.w - 280]) {
    project.masses.push(createMass({
      name: 'Колонна террасы', x, y: canopy.y + canopy.d / 2 - 200,
      z0: ground.elevation, w: 260, d: 320, h: canopy.z0 - ground.elevation, color: '#4b4b46',
    }));
  }
}

export function buildGardenVilla(door, opening) {
  const p = createProject('Вилла у воды');
  const ground = p.levels[0];
  ground.height = 3600;
  const upper = createLevel('2 этаж', ground.height, 3300, 'L2');
  p.levels.push(upper);
  p.envelope.zeroAboveGround = 450;
  p.envelope.roofThickness = 320;
  p.envelope.roof.overhang = 550;
  p.envelope.roof.drainage = 'internal';
  p.site.buildingHeight = upper.elevation + upper.height + p.envelope.roofThickness;

  const study = room(ground, 'cabinet', 0, -1000, 3900, 3600);
  const washroom = room(ground, 'bathroom', 4000, -1000, 2400, 3600);
  const living = room(ground, 'living', 0, 2700, 6400, 4900);
  const hall = room(ground, 'stairs-room', 6500, 0, 4300, 6500, 'Двухсветный холл');
  const utility = room(ground, 'laundry', 10900, -1000, 2800, 3600);
  const pantry = room(ground, 'pantry', 13800, -1000, 3500, 3600);
  const kitchen = room(ground, 'kitchen', 10900, 2700, 6400, 4900, 'Кухня-столовая');
  const terrace = room(ground, 'terrace', 10900, 7850, 6400, 2400, 'Терраса у воды');
  terrace.railings = [];
  door(ground, study, living);
  door(ground, washroom, hall);
  door(ground, living, hall, 950);
  door(ground, kitchen, hall, 950);
  door(ground, utility, hall);
  door(ground, pantry, kitchen);
  opening(ground, 'door', hall, 0, 0.5, 1200).entryRole = 'main';
  const terraceDoor = opening(ground, 'door', kitchen, 2, 0.74, 1600);
  Object.assign(terraceDoor, { type: 'sliding', entryRole: 'terrace' });

  const guest = room(upper, 'bedroom', 250, -1000, 6150, 3200, 'Гостевая спальня');
  const suite = room(upper, 'master-bedroom', 250, 2300, 6150, 5100);
  const gallery = room(upper, 'stairs-room', hall.x, hall.y, hall.w, hall.h, 'Галерея второго света');
  const bathroom = room(upper, 'bathroom', 10900, -1000, 3100, 3100);
  const wardrobe = room(upper, 'wardrobe-room', 14100, -1000, 2700, 3100);
  const bedroom = room(upper, 'bedroom', 10900, 2200, 5900, 4300, 'Спальня с балконом');
  const balcony = room(upper, 'balcony', 10900, 6750, 5900, 2000, 'Стеклянный балкон');
  balcony.railings = defaultRailings(balcony, upper.rooms, p.settings).map((rail) => ({ ...rail, type: 'glass', height: 1100 }));
  door(upper, guest, gallery);
  door(upper, suite, gallery, 900, 0.27);
  door(upper, bathroom, gallery);
  door(upper, bedroom, gallery, 900, 0.27);
  door(upper, wardrobe, bedroom);
  Object.assign(opening(upper, 'door', bedroom, 2, 0.77, 1400), { type: 'sliding', entryRole: 'terrace' });

  const tall = (level, host, side, at, width) => applyOpeningPreset(
    opening(level, 'window', host, side, at, width),
    { type: 'panoramic', width, height: level.height - 500, sill: 100, heightMode: 'level' },
  );
  const wingWidth = 4150;
  const corner = tall(ground, living, 2, (wingWidth - p.settings.exterior) / (2 * living.w), wingWidth);
  corner.presetId = CORNER_PRESET;
  corner.corner = { end: 'from', returnWidth: 3100, joint: 'post' };
  tall(ground, kitchen, 2, 0.37, 2500);
  tall(ground, kitchen, 1, 0.5, 2300);
  tall(ground, study, 3, 0.5, 1700);
  opening(ground, 'window', washroom, 0, 0.5, 900);
  opening(ground, 'window', utility, 0, 0.5, 1000);
  tall(upper, guest, 3, 0.5, 1700);
  tall(upper, suite, 2, 0.45, 3200);
  tall(upper, suite, 3, 0.51, 2400);
  tall(upper, bedroom, 2, 0.37, 2350);
  tall(upper, bedroom, 1, 0.52, 2300);
  opening(upper, 'window', bathroom, 0, 0.5, 1000);
  const atriumWindow = tall(ground, hall, 2, 0.5, 3700);
  setWindowSpan(p, ground.id, atriumWindow, upper.elevation + upper.height - 350);

  const stair = createItem('stairs', 8650, 0, 0, 0, 180);
  applyStairPreset(stair, 'u', ground.height);
  applyStairStylePreset(stair, 'interior-glass');
  stair.toLevel = upper.id;
  // Both flights meet the northern gallery. Side walkways lead to the bedroom doors.
  const landingY = 1800;
  stair.y = landingY + stair.h / 2;
  ground.items.push(stair);
  const atrium = createSlabOpening(p, upper.id, [point(7460, landingY), point(9840, landingY),
    point(9840, 5450), point(10800, 5450), point(10800, 6500), point(6500, 6500),
    point(6500, 5450), point(7460, 5450)]);
  atrium.stairId = stair.id;
  atrium.fromLevelId = ground.id;
  atrium.atrium = { roomId: hall.id, upperRoomId: gallery.id, windowId: atriumWindow.id, railing: true };

  furniture(ground, 'sofa', 4050, 3300);
  furniture(ground, 'coffee-table', 4050, 4950);
  furniture(ground, 'dining-table-6', 14350, 4850);
  furniture(ground, 'kitchen-row', 12200, 3040);
  furniture(ground, 'fridge', 16650, 3070);
  furniture(ground, 'washer', 11300, -620);
  furniture(ground, 'dryer', 12000, -620);
  furniture(ground, 'shower', 4480, -500);
  furniture(ground, 'toilet-wall', 5740, -600);
  furniture(ground, 'washbasin', 4550, 2330, 180);
  furniture(ground, 'desk', 1950, -580);
  furniture(upper, 'bed-double', 2680, 350);
  furniture(upper, 'bed-double', 3200, 4150);
  furniture(upper, 'bed-double', 13450, 4050);
  furniture(upper, 'bath', 12000, -600);
  furniture(upper, 'toilet-wall', 13620, 1500, 270);
  furniture(upper, 'washbasin', 13250, -720);
  furniture(upper, 'wardrobe', 15500, -620);
  villaFacades(p, ground, upper, living, kitchen, suite, bedroom, corner);
  villaGarden(p);
  return p;
}
