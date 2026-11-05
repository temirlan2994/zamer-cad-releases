import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createProject, createRoom } from '../core/model.js';
import { pickStackHit, planHitStack } from '../core/hit-stack.js';
import { deriveWalls } from '../core/walls.js';

test('стопка под курсором идёт сверху вниз: мебель, затем верхняя и нижняя комнаты', () => {
  const project = createProject('Перекрытия');
  const lowerRoom = createRoom('living', 0, 0, 4000, 4000);
  const upperRoom = createRoom('kitchen', 500, 500, 3000, 3000);
  const lowerItem = createItem('bed-double', 2000, 2000, 1600, 2000);
  const upperItem = createItem('coffee-table', 2000, 2000, 900, 600);
  project.rooms.push(lowerRoom, upperRoom);
  project.items.push(lowerItem, upperItem);
  const stack = planHitStack(project, deriveWalls(project), 0.1, { x: 2000, y: 2000 });
  assert.deepEqual(stack.map((hit) => [hit.type, hit.id]).slice(0, 4), [
    ['item', upperItem.id],
    ['item', lowerItem.id],
    ['room', upperRoom.id],
    ['room', lowerRoom.id],
  ]);
  assert.equal(pickStackHit(stack, 1).id, upperItem.id);
  assert.equal(pickStackHit(stack, 2).id, lowerItem.id);
  assert.equal(pickStackHit(stack, 3).id, upperRoom.id);
  assert.equal(pickStackHit(stack, stack.length + 1).id, upperItem.id);
});

test('шахта всегда выше обычной комнаты независимо от порядка в массиве', () => {
  const project = createProject('Шахта сверху');
  const shaft = createRoom('shaft', 1000, 1000, 600, 600);
  const room = createRoom('living', 0, 0, 4000, 4000);
  project.rooms.push(shaft, room);
  const rooms = planHitStack(project, deriveWalls(project), 0.1, { x: 1300, y: 1300 })
    .filter((hit) => hit.type === 'room');
  assert.deepEqual(rooms.map((hit) => hit.id), [shaft.id, room.id]);
});

test('обычное помещение выбирается выше террасы и балкона', () => {
  const project = createProject('Дом выше террасы');
  const room = createRoom('living', 0, 0, 4000, 4000);
  const terrace = createRoom('terrace', 500, 500, 3000, 3000);
  project.rooms.push(room, terrace); // терраса создана позже, но остаётся снизу
  const rooms = planHitStack(project, deriveWalls(project), 0.1, { x: 2000, y: 2000 })
    .filter((hit) => hit.type === 'room');
  assert.deepEqual(rooms.map((hit) => hit.id), [room.id, terrace.id]);
});
