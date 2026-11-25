// Каталог въездов: категории и размерные карточки, как в каталоге окон.
import { ENTRY_CATEGORIES, entryById, entryPresets, entryTitle } from '../core/site-entries.js';
import { drawEntryPreview } from '../render.js';
import { closeSheets } from './mobile.js';
import { state } from './state.js';
import { setTool } from './tools.js';

let menu;
let category = 'swing';
let preset = { kind: 'gate', opening: 'swing', width: 4000, height: 1800, wicket: false };

function renderCards() {
  for (const button of menu.querySelectorAll('[data-entry-cat]')) button.setAttribute('aria-pressed', String(button.dataset.entryCat === category));
  menu.querySelector('.entry-menu-wicket').hidden = category === 'wicket';
  const box = menu.querySelector('#entryPresetItems');
  box.replaceChildren();
  for (const item of entryPresets(category)) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'furniture-chip opening-chip entry-chip'; card.dataset.entryPreset = item.id;
    card.setAttribute('aria-label', `${entryTitle(item)} ${item.width} × ${item.height} мм`);
    const selected = item.kind === preset.kind && item.opening === preset.opening && item.width === preset.width && item.height === preset.height;
    card.setAttribute('aria-pressed', String(selected));
    card.classList.toggle('active', selected);
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 132;
    const label = document.createElement('span'); label.className = 'chip-name'; label.textContent = `${item.width} × ${item.height} мм`;
    card.append(canvas, label); box.append(card);
    drawEntryPreview(canvas, item);
    card.addEventListener('click', () => {
      preset = { ...item, wicket: item.kind === 'gate' && menu.querySelector('#entryPresetWicket').checked };
      menu.close();
      setTool({ ...preset, kind: 'entry', entryKind: preset.kind },
        'Кликните по границе участка. Ширина и высота — в свойствах установленного объекта · Esc — выйти');
      closeSheets();
    });
  }
}

export function openSiteEntryMenu() {
  if (!menu) {
    menu = document.createElement('dialog'); menu.id = 'siteEntryMenu'; menu.className = 'entry-menu';
    menu.setAttribute('aria-labelledby', 'entryMenuTitle');
    menu.innerHTML = `<div class="entry-menu-head"><h2 id="entryMenuTitle">Въезд</h2><button type="button" data-entry-close aria-label="Закрыть">×</button></div>
      <div class="entry-catalog"><div class="entry-categories" role="group" aria-label="Тип въезда">${ENTRY_CATEGORIES.map((c) => `<button type="button" data-entry-cat="${c.id}">${c.title}</button>`).join('')}</div>
      <div id="entryPresetItems" aria-label="Размеры въезда"></div></div>
      <label class="check-row entry-menu-wicket"><input id="entryPresetWicket" type="checkbox"><span>Калитка рядом с воротами</span></label>
      <p class="empty-hint">Выберите карточку и поставьте на границе участка. Размеры можно изменить в свойствах.</p>`;
    document.body.append(menu);
    menu.querySelector('[data-entry-close]').addEventListener('click', () => menu.close());
    menu.addEventListener('keydown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      const button = e.target.closest('[data-entry-cat]');
      if (button) { category = button.dataset.entryCat; renderCards(); return; }
      if (e.target !== menu) return;
      const r = menu.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) menu.close();
    });
  }
  const tool = state.tool?.kind === 'entry' ? state.tool : null;
  const selected = state.selection?.type === 'site' && state.selection.kind === 'entry' ? entryById(state.project.site, state.selection.id) : null;
  if (tool) preset = { ...preset, ...tool, kind: tool.entryKind || 'gate' };
  else if (selected) preset = { ...selected };
  category = preset.kind === 'wicket' ? 'wicket' : preset.opening === 'sliding' ? 'sliding' : 'swing';
  menu.querySelector('#entryPresetWicket').checked = Boolean(preset.wicket);
  menu.showModal(); renderCards();
}
