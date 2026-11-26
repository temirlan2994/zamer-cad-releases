// Немодальный каталог въезда в общей боковой библиотеке, как у дверей.
import { ENTRY_CATEGORIES, entryAt, entryById, entryPresets, entryTitle } from '../core/site-entries.js';
import { drawEntryPreview } from '../render.js';
import { closeLibrarySheet, openLibrarySheet } from './mobile.js';
import { renderToolOptions } from './props.js';
import { state } from './state.js';
import { cancelTool, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

let category = 'swing';
let syncedKind = '';
let last = { entryKind: 'gate', opening: 'swing', width: 4000, height: 1800, wicket: false };
const toolCategory = (t) => t.entryKind === 'wicket' ? 'wicket' : t.opening === 'sliding' ? 'sliding' : 'swing';
const hint = 'Кликните по границе участка — можно поставить несколько въездов · Esc — выйти';

function refreshPreset({ options = false } = {}) {
  const t = state.tool;
  if (t?.kind !== 'entry') return;
  last = { ...t };
  if (state.entryGhost) state.entryGhost = entryAt(state.project.site, state.entryGhost, { ...t, kind: t.entryKind });
  setHint(hint);
  if (options) renderToolOptions(true);
  renderEntryLibrary(); requestDraw();
}

export function openSiteEntryMenu() {
  if (state.tool?.kind !== 'entry') {
    const selected = state.selection?.type === 'site' && state.selection.kind === 'entry' ? entryById(state.project.site, state.selection.id) : null;
    if (selected) last = { ...selected, entryKind: selected.kind };
    setTool({ ...last, kind: 'entry' }, hint);
  }
  openLibrarySheet();
}

export function renderEntryLibrary() {
  const t = state.tool;
  const bar = document.getElementById('entryLibraryBar');
  if (!bar || t?.kind !== 'entry') return;
  const cats = document.getElementById('entryCats');
  const search = document.getElementById('entrySearch');
  const wicket = document.getElementById('entryPresetWicket');
  if (!bar.dataset.bound) {
    bar.dataset.bound = '1';
    for (const c of ENTRY_CATEGORIES) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = c.title; button.dataset.entryCat = c.id;
      button.addEventListener('click', () => { category = c.id; search.value = ''; renderEntryLibrary(); });
      cats.append(button);
    }
    search.addEventListener('input', renderEntryLibrary);
    wicket.addEventListener('change', () => { if (state.tool?.kind === 'entry') { state.tool.wicket = wicket.checked; refreshPreset({ options: true }); } });
    document.getElementById('entryLibraryClose').addEventListener('click', () => { cancelTool(); closeLibrarySheet(); });
  }
  const kind = toolCategory(t);
  if (syncedKind !== kind) { syncedKind = kind; category = kind; search.value = ''; }
  for (const button of cats.children) button.setAttribute('aria-pressed', String(button.dataset.entryCat === category));
  document.getElementById('entryLibraryWicketRow').hidden = category === 'wicket';
  wicket.checked = Boolean(t.wicket);
  const box = document.getElementById('entryPresetItems');
  const query = search.value.trim().toLocaleLowerCase('ru');
  const key = JSON.stringify([category, t.entryKind, t.opening, t.width, t.height, query, getComputedStyle(box).getPropertyValue('--desk-accent')]);
  if (box.dataset.presetKey === key) return;
  box.dataset.presetKey = key; box.replaceChildren();
  for (const item of entryPresets(category).filter((p) => !query || `${entryTitle(p)} ${p.width} ${p.height} ${p.width}×${p.height}`.toLocaleLowerCase('ru').includes(query))) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'furniture-chip opening-chip entry-chip'; card.dataset.entryPreset = item.id;
    card.setAttribute('aria-label', `${entryTitle(item)} ${item.width} × ${item.height} мм`);
    const selected = item.kind === t.entryKind && item.opening === t.opening && item.width === t.width && item.height === t.height;
    card.setAttribute('aria-pressed', String(selected)); card.classList.toggle('active', selected);
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 132;
    const label = document.createElement('span'); label.className = 'chip-name'; label.textContent = `${item.width} × ${item.height} мм`;
    card.append(canvas, label); box.append(card); drawEntryPreview(canvas, item);
    card.addEventListener('click', () => {
      if (state.tool?.kind !== 'entry') return;
      Object.assign(state.tool, { entryKind: item.kind, opening: item.opening, width: item.width, height: item.height, wicket: item.kind === 'gate' && state.tool.wicket });
      refreshPreset({ options: true }); closeLibrarySheet();
    });
  }
  if (!box.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'empty-hint'; empty.textContent = 'Ничего не найдено'; box.append(empty);
  }
}

export function renderEntryToolOptions(body) {
  const t = state.tool;
  const wicket = t.entryKind === 'wicket';
  body.innerHTML = `<strong class="to-title">Въезд</strong>
    <label class="prop-field"><span>Тип</span><select id="toEntryType">${ENTRY_CATEGORIES.map((c) => `<option value="${c.id}" ${toolCategory(t) === c.id ? 'selected' : ''}>${c.title}</option>`).join('')}</select></label>
    <label class="prop-field"><span>Ширина, мм</span><input id="toEntryWidth" type="number" min="${wicket ? 600 : 2000}" max="${wicket ? 2000 : 10000}" step="50" value="${t.width}"></label>
    <label class="prop-field"><span>Высота, мм</span><input id="toEntryHeight" type="number" min="600" max="4000" step="50" value="${t.height}"></label>
    ${wicket ? '' : `<label class="check-row"><input id="toEntryWicket" type="checkbox" ${t.wicket ? 'checked' : ''}><span>Калитка</span></label>`}`;
  body.querySelector('#toEntryType').addEventListener('change', (e) => {
    const next = e.target.value; const wasWicket = t.entryKind === 'wicket';
    t.entryKind = next === 'wicket' ? 'wicket' : 'gate'; t.opening = next === 'sliding' ? 'sliding' : 'swing';
    if (wasWicket !== (t.entryKind === 'wicket')) t.width = t.entryKind === 'wicket' ? 1000 : 4000;
    if (t.entryKind === 'wicket') t.wicket = false;
    refreshPreset({ options: true });
  });
  for (const [id, field, min, max] of [['toEntryWidth', 'width', wicket ? 600 : 2000, wicket ? 2000 : 10000], ['toEntryHeight', 'height', 600, 4000]]) {
    body.querySelector(`#${id}`).addEventListener('change', (e) => {
      const value = Number(e.target.value);
      if (Number.isFinite(value) && value > 0) t[field] = Math.max(min, Math.min(max, Math.round(value)));
      e.target.value = t[field]; refreshPreset();
    });
  }
  body.querySelector('#toEntryWicket')?.addEventListener('change', (e) => { t.wicket = e.target.checked; refreshPreset(); });
}
