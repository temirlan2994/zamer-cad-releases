// Стартовое меню: продолжить, новый, пример, открыть, шаблоны.

import { hasContent } from '../core/model.js';
import { TEMPLATES } from '../core/templates.js';
import { saveFile } from './cloud.js';
import { el, escapeHtml, toast } from './dom.js';
import { handleExport, loadTemplate, newProject } from './files.js';
import { state } from './state.js';

const projectHasContent = () => hasContent(state.project);

// Битое автосохранение: предупреждение и кнопка «Скачать копию».
function showBroken(warn, broken) {
  warn.hidden = false;
  warn.innerHTML = `
    <span>⚠ Прошлый проект из автосохранения не открылся${broken.error?.message ? ` (${escapeHtml(broken.error.message)})` : ''}.
    Открыт пустой проект, копия прежних данных сохранена в резерв браузера.</span>
    <div class="warn-actions">
      <button id="warnBrokenSave" class="primary-inline">Скачать копию</button>
      <button id="warnBrokenHide">Скрыть</button>
    </div>`;
  warn.querySelector('#warnBrokenSave').addEventListener('click', () => {
    saveFile('автосохранение-повреждено.kepler.json', broken.text, 'application/json');
  });
  warn.querySelector('#warnBrokenHide').addEventListener('click', () => { warn.hidden = true; });
}

// Кнопки шаблонов строятся один раз.
function renderTemplates() {
  const box = el('startTemplates');
  if (!box || box.childElementCount) return;
  for (const t of TEMPLATES) {
    const btn = document.createElement('button');
    btn.className = 'start-item';
    btn.dataset.template = t.id;
    btn.innerHTML = `<b>${t.title}</b><span>${t.note}</span>`;
    btn.addEventListener('click', () => { loadTemplate(t.id); closeStartMenu(); });
    box.appendChild(btn);
  }
}

export function openStartMenu({ initial = false, broken = null } = {}) {
  renderTemplates();
  const screen = el('startScreen');
  const warn = el('startWarn');
  const closeBtn = el('startClose');
  const continueBtn = el('startContinue');
  warn.hidden = true;
  warn.innerHTML = '';
  if (broken?.text) showBroken(warn, broken);
  const hasContent = projectHasContent();
  closeBtn.hidden = initial && !hasContent;
  continueBtn.hidden = initial && !hasContent;
  screen.hidden = false;
}

export function closeStartMenu() {
  el('startScreen').hidden = true;
}

export function requestNewProject() {
  const warn = el('startWarn');
  if (projectHasContent()) {
    // Спрашиваем подтверждение, прежде чем стереть текущий проект.
    warn.hidden = false;
    warn.innerHTML = `
      <span>⚠ Текущий проект «${escapeHtml(state.project.name)}» будет закрыт. Сохранить его в файл перед этим?</span>
      <div class="warn-actions">
        <button id="warnSave" class="primary-inline">Сохранить и создать</button>
        <button id="warnDiscard" class="danger">Создать без сохранения</button>
        <button id="warnCancel">Отмена</button>
      </div>`;
    warn.querySelector('#warnSave').addEventListener('click', () => {
      handleExport('project');
      newProject();
      closeStartMenu();
      toast('Новый проект создан, старый сохранён в файл');
    });
    warn.querySelector('#warnDiscard').addEventListener('click', () => {
      newProject();
      closeStartMenu();
      toast('Новый проект. Прежний можно вернуть через Ctrl+Z');
    });
    warn.querySelector('#warnCancel').addEventListener('click', () => { warn.hidden = true; });
    return;
  }
  newProject();
  closeStartMenu();
}
