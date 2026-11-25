// Единая точка входа для ворот двух типов и отдельной калитки.
import { closeSheets } from './mobile.js';
import { state } from './state.js';
import { setTool } from './tools.js';

let menu;
let preset = { kind: 'gate', opening: 'swing', wicket: false };
const icon = (path) => `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${path}"/></svg>`;

export function openSiteEntryMenu() {
  if (!menu) {
    menu = document.createElement('dialog');
    menu.id = 'siteEntryMenu';
    menu.className = 'entry-menu';
    menu.setAttribute('aria-labelledby', 'entryMenuTitle');
    menu.innerHTML = `<form method="dialog">
      <div class="entry-menu-head"><h2 id="entryMenuTitle">Въезд</h2><button type="button" data-entry-close aria-label="Закрыть">×</button></div>
      <fieldset><legend>Что поставить</legend>
        <label class="entry-choice"><input type="radio" name="entryChoice" value="swing">${icon('M4 4v24M44 4v24M5 8h18v17H5M25 8h18v17H25M20 15v4M28 15v4')}<span>Ворота распашные</span></label>
        <label class="entry-choice"><input type="radio" name="entryChoice" value="sliding">${icon('M4 4v24M44 4v24M5 7h38v17H5M7 28h31m-5-4 5 4-5 4')}<span>Ворота раздвижные</span></label>
        <label class="entry-choice"><input type="radio" name="entryChoice" value="wicket">${icon('M12 3v26M36 3v26M13 7h20v19H13M28 15h2')}<span>Калитка</span></label>
      </fieldset>
      <label class="check-row entry-menu-wicket"><input id="entryPresetWicket" type="checkbox"><span>Калитка рядом с воротами</span></label>
      <p class="empty-hint">Ставится на границе участка. Размеры и сторона калитки — в свойствах.</p>
      <button class="primary-inline" id="entryMenuPlace" type="submit">Установить</button>
    </form>`;
    document.body.append(menu);
    menu.querySelector('[data-entry-close]').addEventListener('click', () => menu.close());
    const sync = () => {
      const wicket = menu.querySelector('[name="entryChoice"]:checked')?.value === 'wicket';
      menu.querySelector('.entry-menu-wicket').hidden = wicket;
    };
    menu.addEventListener('change', sync);
    menu.addEventListener('keydown', (e) => e.stopPropagation());
    menu.addEventListener('click', (e) => {
      if (e.target !== menu) return;
      const r = menu.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) menu.close();
    });
    menu.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const choice = menu.querySelector('[name="entryChoice"]:checked').value;
      preset = { kind: choice === 'wicket' ? 'wicket' : 'gate', opening: choice === 'sliding' ? 'sliding' : 'swing', wicket: menu.querySelector('#entryPresetWicket').checked };
      menu.close();
      setTool({ kind: 'entry', entryKind: preset.kind, opening: preset.opening, wicket: preset.kind === 'gate' && preset.wicket },
        'Кликните по границе участка — новый въезд. Размеры и калитка — в свойствах · Esc — выйти');
      closeSheets();
    });
  }
  const tool = state.tool?.kind === 'entry' ? state.tool : null;
  const choice = (tool?.entryKind || preset.kind) === 'wicket' ? 'wicket' : tool?.opening || preset.opening;
  menu.querySelector(`[name="entryChoice"][value="${choice === 'sliding' || choice === 'wicket' ? choice : 'swing'}"]`).checked = true;
  menu.querySelector('#entryPresetWicket').checked = tool ? Boolean(tool.wicket) : preset.wicket;
  menu.querySelector('.entry-menu-wicket').hidden = choice === 'wicket';
  menu.showModal();
}
