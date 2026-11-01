// Демонстрационный проект «Дом · 1 этаж».

import { arrangeRoom, defaultItemsFor } from '../core/furnish.js';
import { createOpening, createProject, createRoom } from '../core/model.js';
import { ensureSite } from '../core/site.js';
import { deriveWalls } from '../core/walls.js';

export function buildSample() {
  const project = createProject('Дом · 1 этаж');
  const site = ensureSite(project);
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.name = 'Спальня';
  const bath = createRoom('bathroom', 2900, 1900, 2000, 2000);
  bath.parentId = bedroom.id;
  bath.name = 'Санузел';
  const living = createRoom('living', 5100, 0, 5000, 4200);
  const kitchen = createRoom('kitchen', 5100, 4300, 3600, 3000);
  const hall = createRoom('hall', 0, 4100, 3000, 2400);
  project.rooms.push(bedroom, bath, living, kitchen, hall);

  project.openings.push(createOpening('door', hall.id, 2, 1500, 900));
  project.openings.push(createOpening('door', bedroom.id, 2, 1200, 800));
  project.openings.push(createOpening('door', bedroom.id, 1, 700, 800));
  project.openings.push(createOpening('door', bath.id, 0, 1000, 700));
  project.openings.push(createOpening('door', living.id, 2, 1800, 900));
  project.openings.push(createOpening('window', bedroom.id, 0, 2500, 1500));
  project.openings.push(createOpening('window', living.id, 0, 2500, 1800));
  project.openings.push(createOpening('window', kitchen.id, 1, 1500, 1200));

  // Участок вокруг дома: граница, въезд, дорога, север и сосед.
  site.boundary = [
    { x: -5000, y: -6000 }, { x: 16000, y: -6000 },
    { x: 16000, y: 12000 }, { x: -5000, y: 12000 },
  ];
  site.entry = { x: 5000, y: 12000, dir: -90 };
  site.roads.push({ id: 'road-sample', points: [{ x: 5000, y: 12000 }, { x: 5000, y: 16000 }], width: 3500 });
  site.neighbors.push({ id: 'nbr-sample', x: 24000, y: 2000, w: 8000, h: 9000, height: 6500 });
  site.north = 20;
  site.sun.enabled = true;

  const rejected = new Map();
  const walls = deriveWalls(project);
  for (const room of project.rooms) {
    for (const item of defaultItemsFor(room)) project.items.push(item);
  }
  for (const room of project.rooms) {
    rejected.set(room.id, arrangeRoom(project, room, walls));
  }
  return { project, rejected };
}
