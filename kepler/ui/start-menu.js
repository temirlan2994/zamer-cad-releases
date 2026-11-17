// Стартовое меню: продолжить, новый, пример, открыть, шаблоны.

import { hasContent } from '../core/model.js';
import { createProjectPreview, projectPreviewSvg } from '../core/project-preview.js';
import { TEMPLATES } from '../core/templates.js';
import { saveFile } from './cloud.js';
import { el, escapeHtml, toast } from './dom.js';
import { handleExport, loadTemplate, newProject } from './files.js';
import { buildSample } from './sample.js';
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

function exampleContent(title, note, project) {
  const preview = createProjectPreview(project);
  return `
    <span class="startup-project-preview">${projectPreviewSvg(preview)}</span>
    <span class="startup-project-info"><b>${escapeHtml(title)}</b><small>${escapeHtml(note)}</small></span>`;
}

// Карточки примеров строятся один раз.
function renderTemplates() {
  const box = el('startTemplates');
  if (!box || box.dataset.ready === 'true') return;
  const sample = el('startSample');
  sample.innerHTML = exampleContent('Демо-дом с участком', 'участок, рельеф и инсоляция', buildSample().project);
  for (const t of TEMPLATES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'startup-project-card';
    btn.dataset.template = t.id;
    btn.innerHTML = exampleContent(t.title, t.note, t.build());
    btn.addEventListener('click', () => { loadTemplate(t.id); closeStartMenu(); });
    box.appendChild(btn);
  }
  box.dataset.ready = 'true';
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
  screen.dataset.initial = String(Boolean(initial));
  closeBtn.hidden = initial;
  continueBtn.hidden = !hasContent;
  if (hasContent) {
    continueBtn.querySelector('b').textContent = 'Продолжить текущий проект';
    continueBtn.querySelector('span').textContent = 'локальная копия на этом устройстве';
  }
  document.querySelector('.app')?.setAttribute('inert', '');
  screen.hidden = false;
}

export function closeStartMenu() {
  el('startScreen').hidden = true;
  document.querySelector('.app')?.removeAttribute('inert');
  try { sessionStorage.setItem('kepler-startup-chosen', '1'); } catch { /* режим без sessionStorage */ }
}

export function requestNewProject() {
  const warn = el('startWarn');
  if (el('startScreen').dataset.initial === 'true' && !projectHasContent()) {
    newProject();
    closeStartMenu();
    toast('Новый проект создан');
    return;
  }
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
