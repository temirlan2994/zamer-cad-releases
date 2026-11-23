import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lazyCloudDraft, materializeCloudDraft, projectStatsOf,
} from '../ui/cloud-draft-metadata.js';

test('локальный autosave создаёт ленивый draft без разбора и миниатюры', () => {
  const draft = lazyCloudDraft('{"levels":[]}', 7);
  assert.deepEqual(draft, { text: '{"levels":[]}', order: 7, metadataReady: false });
  assert.equal('preview' in draft, false);
  assert.equal('stats' in draft, false);
});

test('облачная отправка материализует metadata один раз и повторно использует её', () => {
  const draft = lazyCloudDraft('project-json', 8);
  let parses = 0;
  let thumbnails = 0;
  const deps = {
    parse(text) {
      parses += 1;
      assert.equal(text, 'project-json');
      return { levels: [{ rooms: [{ id: 'a' }, { id: 'b' }] }, { rooms: [{ id: 'c' }] }] };
    },
    thumbnail(project) {
      thumbnails += 1;
      assert.equal(project.levels.length, 2);
      return { v: 2, mime: 'image/webp', data: 'preview' };
    },
  };

  const first = materializeCloudDraft(draft, deps);
  const second = materializeCloudDraft(draft, deps);
  assert.equal(first, draft);
  assert.equal(second, draft);
  assert.equal(parses, 1);
  assert.equal(thumbnails, 1);
  assert.deepEqual(draft.stats, { rooms: 3, levels: 2 });
  assert.equal(draft.preview.data, 'preview');
  assert.equal(draft.metadataReady, true);
});

test('ошибка preview не блокирует облачный JSON и тоже кешируется', () => {
  const draft = lazyCloudDraft('ok', 9);
  let attempts = 0;
  materializeCloudDraft(draft, {
    parse: () => ({ levels: [{ rooms: [] }] }),
    thumbnail: () => { attempts += 1; throw new Error('canvas unavailable'); },
  });
  materializeCloudDraft(draft, {
    parse: () => { throw new Error('не должен повториться'); },
    thumbnail: () => { attempts += 1; },
  });
  assert.equal(attempts, 1);
  assert.equal(draft.preview, null);
  assert.deepEqual(draft.stats, { rooms: 0, levels: 1 });
});

test('projectStatsOf терпит неполные старые уровни', () => {
  assert.deepEqual(projectStatsOf({ levels: [{}, { rooms: [1] }] }), { rooms: 1, levels: 2 });
  assert.deepEqual(projectStatsOf(null), { rooms: 0, levels: 0 });
});
