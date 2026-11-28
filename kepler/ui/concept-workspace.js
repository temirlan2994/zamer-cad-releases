import { CONCEPT_STAGES, COST_CATEGORIES, CONSTRUCTION_SYSTEMS, ensureConcept, normalizeBudget, normalizeConstruction } from '../core/concept-data.js';
import { createDesignVariant, activateDesignVariant, renameDesignVariant, deleteDesignVariant, designVariants } from '../core/design-variants.js';
import { analyzeConceptReadiness, compareDesignVariants } from '../core/concept-readiness.js';
import { REGULATION_PROFILES, REGULATION_LIMITS, normalizeRegulations } from '../core/concept-regulations.js';
import { createReviewSnapshot, rememberReviewSnapshot, importReviewResponse, makeReviewResponse, reviewChanges } from '../core/concept-review.js';
import { buildConceptHandoff } from '../core/concept-handoff.js';
import { budgetCsv } from '../core/concept-budget.js';
import { projectPreviewSvg, createProjectPreview } from '../core/project-preview.js';
import { WALL_T_MIN, WALL_T_MAX } from '../core/walls.js';
import { state } from './state.js';
import { mutate, undo, redo, PROJECT_CHANGE_EVENT } from './store.js';
import { escapeHtml as esc, toast } from './dom.js';
import { cancelTool, selectObject } from './tools.js';
import { switchLevel } from './levels.js';
import { fitView } from './view.js';
import { openHomeMission } from './project-route.js';
import { saveFile, saveZip, getBackend } from './cloud.js';

let dialog, content, tab = 'overview', token = 0, lastReport = null;
const number = (value, digits = 1) => value == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const money = (value, currency) => `${number(value, 0)} ${esc(currency)}`;
const date = (value) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : 'Дата не задана'; };
const LABEL = { checked: 'Проверено', blocked: 'Исправить', error: 'Ошибка', attention: 'Проверить', unknown: 'Нужны данные', approved: 'Согласовано', revision: 'Доработать', pending: 'Ожидает решения' };
const badge = (status) => `<span class="concept-badge" data-state="${esc(status)}">${esc(LABEL[status] || status)}</span>`;
const field = (name, label, value = '', type = 'text', attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value ?? '')}" ${attrs}></label>`;
const area = (name, label, value = '') => `<label class="concept-wide">${esc(label)}<textarea name="${esc(name)}" rows="2">${esc(value)}</textarea></label>`;
const action = (id, title, attrs = '') => `<button type="button" data-concept-action="${id}" ${attrs}>${title}</button>`;
const snapshotDifference = (snapshot) => {
  const changes = reviewChanges(state.project, snapshot);
  return changes.length ? `Отличия текущего дома: ${changes.map(esc).join(', ')}` : 'Совпадает с текущим домом';
};


function change(fn) {
  try { if (!mutate(fn)) toast('Проект сейчас доступен только для чтения', true); }
  catch (error) { toast(error.message, true); }
}

function findingsHtml(findings) {
  if (!findings.length) return '<p class="concept-note">В пределах выполненных проверок замечаний не найдено.</p>';
  return `<ul class="concept-findings">${findings.map((finding) => `<li>${badge(finding.status)}<span>${esc(finding.title)}</span>${finding.target ? action('focus', 'Показать', `data-target="${esc(JSON.stringify(finding.target))}" data-level="${esc(finding.levelId || '')}"`) : ''}</li>`).join('')}</ul>`;
}

function overviewHtml(report) {
  return `<div class="concept-hero"><div><span class="concept-eyebrow">Путь к согласованной концепции</span><h2>${report.checked} из ${report.stages.length} этапов проверено</h2>
    <p>Готовность относится к выполненным проверкам и введённым данным. Изменения модели требуют нового согласования снимка.</p></div>
    <progress max="${report.stages.length}" value="${report.checked}" aria-label="Готовность концепции"></progress></div>
    ${report.next ? `<div class="concept-next"><strong>Следующий шаг: ${esc(report.next.title)}</strong><p>${esc(report.next.detail)}</p>${stageAction(report.next)}</div>` : '<p class="concept-note">Все перечисленные этапы пройдены. Подготовьте комплект и выполните внешнюю приёмку.</p>'}
    <ol class="concept-stage-list">${report.stages.map((stage) => `<li>${badge(stage.status)}<div><strong>${esc(stage.title)}</strong><small>${esc(stage.detail)}</small></div>${stageAction(stage)}</li>`).join('')}</ol>`;
}

function stageAction(stage) {
  return action(stage.route ? 'route' : 'tab', 'Открыть', stage.route ? `data-route="${stage.route}"` : `data-tab="${stage.tab}"`);
}

function variantsHtml() {
  const p = state.project, variants = compareDesignVariants(p), selected = p.concept?.selectedVariantId;
  return `<h2>Варианты дома</h2><p>Участок и задание семьи общие. План, фасады, конструктивные решения и расценки каждого варианта сохраняются отдельно. Перед переключением текущие изменения сохраняются.</p>
    <form data-concept-form="variant"><div class="concept-inline">${field('name', 'Название нового варианта', '', 'text', 'maxlength="120" required')}
    <button type="submit">Создать копию текущего дома</button></div></form>
    ${!variants.length ? '<p class="concept-note">Создайте второй вариант: исходный дом также сохранится и будет доступен для возврата.</p>' : `<div class="concept-variant-grid">${variants.map((variant) => `<article data-variant-id="${esc(variant.id)}" class="concept-variant${variant.id === p.concept?.activeVariantId ? ' active' : ''}">
      ${projectPreviewSvg(createProjectPreview(variant.project))}<h3>${esc(variant.name)}</h3><p>${number(variant.area)} м² · ${variant.storeys} эт. · ${variant.rooms} помещений</p>
      <p>${variant.budget.pricedCount ? `${variant.budget.complete ? 'Бюджет' : 'Известные позиции'}: ${money(variant.budget.subtotal, variant.budget.config.currency)}` : 'Расценки пока не заданы'}</p>
      <div class="concept-actions">${action('activate', variant.id === p.concept?.activeVariantId ? 'Открыт' : 'Открыть', `data-id="${esc(variant.id)}" ${variant.id === p.concept?.activeVariantId ? 'disabled' : ''}`)}
      ${action('choose', selected === variant.id ? 'Выбран для согласования' : 'Выбрать', `data-id="${esc(variant.id)}" ${variant.id !== p.concept?.activeVariantId || selected === variant.id ? 'disabled' : ''}`)}
      ${action('rename', 'Переименовать', `data-id="${esc(variant.id)}"`)}${action('delete-variant', 'Удалить', `data-id="${esc(variant.id)}" ${variant.id === p.concept?.activeVariantId ? 'disabled' : ''}`)}</div></article>`).join('')}</div>
    <h3>Сравнение вариантов</h3><div class="concept-table-scroll"><table><thead><tr><th>Показатель</th>${variants.map((variant) => `<th>${esc(variant.name)}</th>`).join('')}</tr></thead><tbody>
    ${[['Площадь помещений, м²', (v) => number(v.area)], ['Пятно застройки, м²', (v) => number(v.footprint)], ['Комнат с окнами¹', (v) => v.roomsWithWindows], ['Окна / пол: соответствует введённому порогу¹', (v) => `${v.daylight.sufficient} из ${v.daylight.total}${v.daylight.unknown ? ` · неизвестно ${v.daylight.unknown}` : ''}`], ['Недостижимых помещений²', (v) => v.unreachable],
      ['Предварительный диапазон³', (v) => !v.budget.pricedCount ? 'Расценки не заданы' : `${money(v.budget.low, v.budget.config.currency)}–${money(v.budget.high, v.budget.config.currency)}${v.budget.complete ? '' : ' · неполный'}`]].map(([label, value]) => `<tr><th>${label}</th>${variants.map((variant) => `<td>${value(variant)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="concept-note">¹ Отношение площади остекления к полу — предварительный показатель; оно не заменяет расчёт освещённости и инсоляции. ² Граф дверей на каждом этаже; бытовые маршруты проверяются отдельно. ³ Разные валюты и даты цен напрямую не сравниваются.</p>`}`;
}

function budgetHtml(report) {
  const budget = report.budget, config = budget.config;
  return `<h2>Предварительный бюджет</h2><div class="concept-summary"><strong>${budget.complete ? 'Итого' : 'Подытог известных позиций'}: ${money(budget.subtotal, config.currency)}</strong>
    <span>Диапазон ${money(budget.low, config.currency)}–${money(budget.high, config.currency)}</span>${badge(budget.complete ? 'checked' : 'unknown')}</div>
    <p>Оценено ${budget.pricedCount} из ${budget.requiredCount} разделов.${budget.provenance.length ? ` Укажите: ${esc(budget.provenance.join(', '))}.` : ''}</p>
    <form data-concept-form="budget"><div class="concept-fields">${field('region', 'Регион цен', config.region)}${field('currency', 'Валюта (трёхбуквенный код)', config.currency, 'text', 'pattern="[A-Z]{3}" maxlength="3" required')}
      ${field('date', 'Дата цен', config.date, 'date')}${field('target', 'Бюджет заказчика', config.target, 'number', 'min="0" step="any"')}${area('source', 'Источник расценок и состав работ', config.source)}</div>
    <div class="concept-table-scroll"><table class="concept-cost-table"><thead><tr><th>Раздел</th><th>Количество</th><th>Цена за единицу</th><th>Стоимость</th></tr></thead><tbody>${budget.rows.map((row) => `<tr data-cost-row="${row.id}"><th>${esc(row.title)}<small>${row.status === 'unknown_quantity' ? 'Не определён объём: проверьте модель и отметку ±0.000' : row.status === 'not_required' ? 'В модели отсутствует' : esc(row.unit)}</small></th><td>${number(row.quantity, 3)}</td><td><input aria-label="Расценка: ${esc(row.title)}" name="rate-${row.id}" type="number" min="0" step="any" value="${row.rate ?? ''}" placeholder="Не задана"></td><td>${row.total == null ? 'Не оценено' : money(row.total, config.currency)}</td></tr>`).join('')}</tbody></table></div>
    <div class="concept-fields">${field('lowPercent', 'Нижнее отклонение, %', config.lowPercent, 'number', 'min="0" max="100"')}${field('highPercent', 'Верхнее отклонение / резерв, %', config.highPercent, 'number', 'min="0" max="200"')}${area('notes', 'Допущения и исключения', config.notes)}</div>
    <div class="concept-actions"><button type="submit">Сохранить расценки</button>${action('budget-csv', 'Скачать CSV')}</div></form>
    <p class="concept-note">${budget.limitations.map(esc).join(' ')}</p>${config.target != null ? `<p>${budget.targetStatus === 'over' ? 'Верхняя оценка превышает бюджет заказчика.' : budget.targetStatus === 'within' ? 'Верхняя оценка находится в заданном бюджете.' : 'Соответствие бюджету неизвестно, пока оценка неполная.'}</p>` : ''}`;
}

function layerHtml(layer = {}, index) {
  return `<div class="concept-layer">${field(`material-${index}`, 'Материал слоя', layer.material || '', 'text', 'maxlength="120"')}${field(`thickness-${index}`, 'Толщина, мм', layer.thickness || '', 'number', 'min="1" max="2000"')}<label class="concept-check"><input name="bearing-${index}" type="checkbox" ${layer.bearing ? 'checked' : ''}>Несущий слой</label></div>`;
}

function constructionHtml(report) {
  const config = report.construction.config;
  return `<h2>Конструкции и связи модели</h2>${badge(report.construction.status)}
    <form data-concept-form="construction"><div class="concept-fields"><label>Конструктивная система<select name="system">${Object.entries(CONSTRUCTION_SYSTEMS).map(([id, title]) => `<option value="${id}" ${config.system === id ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
    ${field('maxSpan', 'Допустимый пролёт из задания инженера, мм', config.maxSpan, 'number', 'min="1" step="1"')}${field('minHeadroom', 'Требуемый просвет над лестницей, мм', config.minHeadroom, 'number', 'min="500" max="5000"')}${field('engineer', 'Ответственный инженер', config.engineer)}${area('soil', 'Сведения о грунтах и основании', config.soil)}${area('source', 'Источник конструктивных ограничений', config.source)}</div>
    <h3>Состав наружной стены</h3><div id="conceptLayers">${(config.layers.length ? config.layers : [{}]).map(layerHtml).join('')}</div>${action('add-layer', 'Добавить слой')}
    <label class="concept-check"><input name="applyThickness" type="checkbox">Применить сумму слоёв к стандартной толщине наружных стен</label>${area('notes', 'Конструктивные решения и вопросы', config.notes)}<button type="submit">Сохранить конструктивные решения</button></form>
    <h3>Связи модели</h3>${findingsHtml(report.model.findings)}<h3>Результаты геометрической проверки</h3>${findingsHtml(report.construction.findings)}<p class="concept-note">${esc(report.construction.scope)}</p>`;
}

function rulesHtml(report) {
  const config = report.rules.config;
  return `<h2>Региональные правила</h2>${badge(report.rules.status)}<p>${esc(report.rules.scope)}</p>
    <form data-concept-form="rules"><div class="concept-fields"><label>Профиль<select name="profile">${Object.entries(REGULATION_PROFILES).map(([id, title]) => `<option value="${id}" ${id === config.profile ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
    ${field('region', 'Регион и населённый пункт', config.region)}${field('title', 'Название документа / профиля', config.title)}${field('revision', 'Редакция документа', config.revision)}${area('source', 'Источник: документ, ссылка, пункт', config.source)}${area('scope', 'Область применения', config.scope)}${field('confirmedBy', 'Кто проверил применимость', config.confirmedBy)}</div>
    <label class="concept-check"><input name="confirmed" type="checkbox" ${config.confirmedAt ? 'checked' : ''}>Применимость пользовательского профиля проверена указанным специалистом</label>
    <h3>Проверяемые пороги</h3><div class="concept-fields">${REGULATION_LIMITS.map(([id, title]) => field(id, title, config.limits[id], 'number', 'min="0.0001" step="any"')).join('')}</div><button type="submit">Сохранить профиль</button></form>
    <h3>Проверки по выбранным порогам</h3><div class="concept-table-scroll"><table><thead><tr><th>Помещение / проверка</th><th>Факт</th><th>Порог</th><th>Результат</th></tr></thead><tbody>${report.rules.checks.map((check) => `<tr><th>${esc(check.roomName)}<small>${esc(REGULATION_LIMITS.find(([id]) => id === check.key)?.[1] || check.key)}</small></th><td>${number(check.actual, 3)} ${esc(check.unit)}</td><td>${number(check.limit, 3)}</td><td>${esc(({ pass: 'Выполнено по профилю', fail: 'Не выполнено по профилю', reference_pass: 'В пределах ориентира', reference_fail: 'Вне ориентира', unknown: 'Недостаточно данных' })[check.status])}</td></tr>`).join('')}</tbody></table></div>
    <p class="concept-note">Эта таблица проверяет перечисленные параметры. Проверки инженерии, пожарной безопасности и полного нормативного соответствия требуют отдельной приёмки. Справочные предупреждения других экранов не заменяют выбранный профиль.</p>`;
}

function reviewHtml(report) {
  const snapshots = state.project.concept?.reviewSnapshots || [], decisions = state.project.concept?.decisions || [];
  return `<h2>Согласование выбранного снимка</h2>${badge(report.approval.status)}<p>${report.approval.stale ? 'После прежнего согласования модель изменилась. Создайте и согласуйте новый снимок.' : 'Снимок фиксирует дом, бюджет и профиль проверок. Ответы сохраняются с его контрольной суммой.'}</p>
    <div class="concept-actions">${action('snapshot', 'Создать снимок для согласования')}${action('import-response', 'Загрузить ответ заказчика')}</div>
    <div class="concept-snapshot-list">${[...snapshots].reverse().map((snapshot) => `<article><h3>${esc(snapshot.variantName)}</h3><p>${esc(date(snapshot.createdAt))}</p><p class="concept-note">${snapshotDifference(snapshot)}</p><code>${esc(snapshot.digest.slice(0,16))}…</code><div class="concept-actions">
    ${action('review-json', 'Скачать снимок JSON', `data-id="${esc(snapshot.id)}"`)}${action('review-html', 'Клиентский файл HTML', `data-id="${esc(snapshot.id)}"`)}${action('share', 'Создать ссылку', `data-id="${esc(snapshot.id)}"`)}</div></article>`).join('')}</div>
    ${(state.project.concept?.shares || []).length ? `<h3>Опубликованные ссылки</h3><ul class="concept-share-list">${state.project.concept.shares.map((share) => `<li>${field(`share-${share.id}`, 'Ссылка для клиента', share.url, 'text', 'readonly')}${esc(date(share.createdAt))} · ${share.revoked ? 'Отозвана' : `до ${esc(date(share.expiresAt))}`}<div class="concept-actions">${action('copy-share', 'Копировать ссылку', `data-id="${esc(share.id)}" ${share.revoked ? 'disabled' : ''}`)}${action('load-responses', 'Получить ответы', `data-id="${esc(share.id)}"`)}${action('revoke-share', 'Отозвать', `data-id="${esc(share.id)}" ${share.revoked ? 'disabled' : ''}`)}</div></li>`).join('')}</ul>` : ''}
    ${snapshots.length ? `<h3>Записать решение по снимку</h3><form data-concept-form="decision"><div class="concept-fields"><label>Снимок<select name="snapshotId">${[...snapshots].reverse().map((snapshot) => `<option value="${esc(snapshot.id)}">${esc(snapshot.variantName)} · ${esc(snapshot.digest.slice(0,10))}</option>`).join('')}</select></label>${field('author', 'Имя участника', '', 'text', 'required maxlength="120"')}<label>Решение<select name="action"><option value="comment">Замечание</option><option value="revise">Нужна доработка</option><option value="approve">Согласовано</option></select></label>${area('message', 'Комментарий')}</div><p class="concept-note">Запись от имени участника фиксирует введённое решение; она не является электронной подписью.</p><button type="submit">Записать решение</button></form>` : ''}
    <h3>Журнал решений и замечаний</h3>${decisions.length ? `<ul class="concept-findings">${[...decisions].reverse().map((entry) => `<li><div><strong>${esc(entry.author)} · ${esc(({ approve: 'Согласовано', revise: 'Доработать', comment: 'Замечание' })[entry.action] || entry.action)}</strong><small>${esc(date(entry.createdAt))} · ${esc(entry.digest?.slice(0,10) || '')} · ${entry.identity === 'authenticated' ? 'Автор вошёл в аккаунт' : 'Имя указано участником'}</small><p>${esc(entry.message)}</p>${entry.point ? `<small>Место в модели: ${number(entry.point.x,0)}, ${number(entry.point.y,0)}, ${number(entry.point.z,0)} мм</small>` : ''}${entry.target?.id ? action('focus', 'Показать элемент замечания', `data-target="${esc(JSON.stringify(entry.target))}" data-level="${esc(entry.target.levelId || '')}"`) : ''}</div></li>`).join('')}</ul>` : '<p>Решений пока нет.</p>'}`;
}

function handoffHtml(report) {
  const verifications = state.project.concept?.integrationVerifications || [], current = verifications.find((entry) => entry.digest === report.digest);
  return `<h2>Передача в проектирование</h2>${badge(report.preflight.status === 'blocked' ? 'blocked' : 'checked')}<p>Комплект содержит исходный проект, IFC, JSON для Revit, DXF, экспликацию, бюджет и манифест с контрольными суммами файлов.</p>
    ${findingsHtml(report.preflight.model.findings)}<ul>${report.preflight.warnings.map((warning) => `<li>${esc(warning.message)}</li>`).join('')}</ul>
    <div class="concept-actions">${action('handoff', 'Скачать комплект передачи ZIP', report.preflight.status === 'blocked' ? 'disabled' : '')}${action('route', 'Открыть листы и выдачу', 'data-route="deliverables"')}${action('import-revit-report', 'Загрузить отчёт Revit')}</div>
    <h3>Внешняя приёмка Revit</h3>${current ? `<p>Загружен отчёт Revit ${esc(current.revitVersion)} от ${esc(date(current.createdAt))}. Замечаний: ${current.warnings?.length || 0}. Отчёт относится к этому снимку.</p>` : '<p class="concept-note">Отчёт запуска Revit для текущего снимка отсутствует. Проверка браузера и наличие JSON не подменяют запуск импортёра в Revit.</p>'}
    <p>После импорта проверьте уровни, размеры, открывание окон и дверей, лестницы, кровлю и координаты. Сохраните отчёт импорта и загрузите его сюда.</p><code class="concept-digest">SHA-256 ${esc(report.digest)}</code>`;
}

async function render() {
  if (!dialog?.open || !state.project) return;
  const current = ++token, project = state.project, revision = state.drawingRevision;
  dialog.querySelector('#conceptProjectName').textContent = project.name;
  for (const button of dialog.querySelectorAll('[data-concept-tab]')) {
    const selected = button.dataset.conceptTab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  }
  content.setAttribute('aria-labelledby', `concept-tab-${tab}`); content.setAttribute('aria-busy', 'true');
  content.innerHTML = '<p role="status">Проверяем текущую модель…</p>';
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const report = await analyzeConceptReadiness(project);
    if (current !== token || !dialog.open || project !== state.project || revision !== state.drawingRevision) return;
    lastReport = report;
    const renderer = { overview: overviewHtml, variants: variantsHtml, budget: budgetHtml, construction: constructionHtml, rules: rulesHtml, review: reviewHtml, handoff: handoffHtml }[tab];
    content.innerHTML = renderer(report); content.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (current !== token || !dialog.open) return;
    content.innerHTML = `<p role="alert">Не удалось проверить модель: ${esc(error.message)}</p>`; content.setAttribute('aria-busy', 'false');
  }
}

async function loadJsonFile(accept = '.json') {
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
  return new Promise((resolve, reject) => {
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) { resolve(null); return; }
      if (file.size > 50*1024*1024) { reject(new Error('Файл превышает 50 МиБ')); return; }
      try { resolve(JSON.parse(await file.text())); } catch { reject(new Error('Не удалось прочитать JSON-файл')); }
    }, { once: true }); input.click();
  });
}

async function handleAction(button) {
  const command = button.dataset.conceptAction, p = state.project, id = button.dataset.id;
  const snapshot = p.concept?.reviewSnapshots?.find((entry) => entry.id === id);
  try {
    if (command === 'tab') { tab = button.dataset.tab; render(); }
    else if (command === 'route') { dialog.close(); openHomeMission(button.dataset.route, null, document.getElementById('conceptBtn')); }
    else if (command === 'undo') { undo(); await render(); }
    else if (command === 'redo') { redo(); await render(); }
    else if (command === 'activate') { cancelTool(); state.selection = null; change(() => activateDesignVariant(p, id)); fitView(); }
    else if (command === 'choose') change(() => { ensureConcept(p).selectedVariantId = id; });
    else if (command === 'rename') {
      const old = designVariants(p).find((variant) => variant.id === id);
      const name = window.prompt('Название варианта', old?.name || ''); if (name != null) change(() => renameDesignVariant(p, id, name));
    } else if (command === 'delete-variant') {
      if (window.confirm('Удалить этот вариант дома? Действие можно отменить.')) change(() => deleteDesignVariant(p, id));
    } else if (command === 'add-layer') {
      const layers = content.querySelector('#conceptLayers'), index = layers.children.length;
      if (index < 20) layers.insertAdjacentHTML('beforeend', layerHtml({}, index));
    } else if (command === 'focus') {
      const target = JSON.parse(button.dataset.target); dialog.close(); if (button.dataset.level) switchLevel(button.dataset.level, { planView: false }); selectObject(target);
    } else if (command === 'budget-csv') await saveFile('budget.csv', budgetCsv(lastReport.budget), 'text/csv;charset=utf-8');
    else if (command === 'snapshot') {
      button.disabled = true; const value = await createReviewSnapshot(p);
      if (state.project === p) change(() => rememberReviewSnapshot(p, value));
    } else if (command === 'review-json' && snapshot) await saveFile(`${snapshot.id}.review.json`, JSON.stringify(snapshot, null, 2), 'application/json');
    else if (command === 'review-html' && snapshot) {
      button.disabled = true; const { buildReviewDocument } = await import('./review-document.js');
      await saveFile(`${snapshot.id}.html`, await buildReviewDocument(snapshot), 'text/html');
    } else if (command === 'share' && snapshot) {
      button.disabled = true; const { publishReview } = await import('./review-cloud.js');
      const share = await publishReview(snapshot, await getBackend());
      if (state.project === p) change(() => { ensureConcept(p).shares.push(share); });
    } else if (command === 'copy-share') {
      const share = p.concept.shares.find((entry) => entry.id === id);
      await navigator.clipboard.writeText(share.url); toast('Ссылка скопирована');
    } else if (command === 'load-responses' || command === 'revoke-share') {
      button.disabled = true; const cloud = await import('./review-cloud.js'), backend = await getBackend();
      const share = p.concept.shares.find((entry) => entry.id === id);
      if (command === 'revoke-share') { await cloud.revokeReview(share, backend); if (state.project === p) change(() => { share.revoked = true; }); }
      else { const replies = await cloud.loadReviewResponses(share, backend); if (state.project === p) change(() => { for (const reply of replies) importReviewResponse(p, reply.response, { authenticatedUid: reply.authorUid || null }); }); toast(`Получено ответов: ${replies.length}`); }
    } else if (command === 'import-response') {
      const response = await loadJsonFile(); if (response && state.project === p) change(() => importReviewResponse(p, response));
    } else if (command === 'handoff') {
      button.disabled = true; const { files } = await buildConceptHandoff(p); await saveZip('kepler-handoff.zip', files);
    } else if (command === 'import-revit-report') {
      const data = await loadJsonFile(); if (data && state.project === p) {
        if (data.schema !== 'kepler-revit-report/1' || data.digest !== lastReport.digest || typeof data.revitVersion !== 'string' || !Array.isArray(data.warnings)) throw new Error('Отчёт Revit должен относиться к текущему снимку');
        change(() => { const c = ensureConcept(p); c.integrationVerifications = [...(c.integrationVerifications || []).filter((entry) => entry.digest !== data.digest), data].slice(-20); });
      }
    }
  } catch (error) { toast(error.message, true); }
  finally { if (button.isConnected) button.disabled = false; }
}

function submit(form) {
  const data = new FormData(form), p = state.project, values = Object.fromEntries(data);
  if (form.dataset.conceptForm === 'variant') {
    if (designVariants(p).length >= 20) { toast('В одном проекте поддерживается до 20 вариантов', true); return; }
    change(() => createDesignVariant(p, values.name));
  } else if (form.dataset.conceptForm === 'budget') change(() => {
    ensureConcept(p).budget = normalizeBudget({ ...values, rates: Object.fromEntries(COST_CATEGORIES.map(([id]) => [id, values[`rate-${id}`]])) });
  });
  else if (form.dataset.conceptForm === 'construction') change(() => {
    const count = form.querySelector('#conceptLayers').children.length;
    const layers = Array.from({ length: count }, (_, index) => ({ material: values[`material-${index}`], thickness: values[`thickness-${index}`], bearing: data.has(`bearing-${index}`) }));
    const config = normalizeConstruction({ ...values, layers });
    const total = config.layers.reduce((sum, layer) => sum+layer.thickness, 0);
    if (data.has('applyThickness') && (total < WALL_T_MIN || total > WALL_T_MAX)) throw new Error(`Для применения к геометрии сумма слоёв должна быть ${WALL_T_MIN}–${WALL_T_MAX} мм`);
    ensureConcept(p).construction = config;
    if (data.has('applyThickness')) p.settings.exterior = total;
  });
  else if (form.dataset.conceptForm === 'rules') change(() => {
    ensureConcept(p).regulations = normalizeRegulations({ ...values, confirmedAt: data.has('confirmed') ? new Date().toISOString() : '', limits: Object.fromEntries(REGULATION_LIMITS.map(([id]) => [id, values[id]])) });
  });
  else if (form.dataset.conceptForm === 'decision') change(() => {
    const snapshot = p.concept.reviewSnapshots.find((entry) => entry.id === values.snapshotId);
    importReviewResponse(p, makeReviewResponse(snapshot, { ...values, target: state.selection }));
  });
}

export function openConceptWorkspace(nextTab = 'overview') {
  if (!state.project.concept?.projectId) change(() => ensureConcept(state.project));
  tab = CONCEPT_STAGES.some(([id]) => id === nextTab) ? nextTab : 'overview';
  if (!dialog.open) dialog.showModal(); render();
}

export function bindConceptWorkspace() {
  if (dialog) return;
  dialog = document.createElement('dialog'); dialog.id = 'conceptDialog'; dialog.className = 'concept-dialog'; dialog.setAttribute('aria-labelledby', 'conceptTitle');
  dialog.innerHTML = `<header><div><span class="concept-eyebrow" id="conceptProjectName"></span><h1 id="conceptTitle">Концепция дома</h1></div><div class="concept-actions">${action('undo', '↶', 'aria-label="Отменить изменение"')}${action('redo', '↷', 'aria-label="Повторить изменение"')}<button type="button" id="conceptClose" aria-label="Закрыть концепцию">×</button></div></header><div class="concept-layout"><nav role="tablist" aria-label="Разделы концепции">${CONCEPT_STAGES.map(([id, title]) => `<button type="button" role="tab" id="concept-tab-${id}" aria-controls="conceptContent" data-concept-tab="${id}">${title}</button>`).join('')}</nav><section id="conceptContent" role="tabpanel" tabindex="0"></section></div>`;
  document.body.append(dialog); content = dialog.querySelector('#conceptContent');
  document.getElementById('conceptBtn')?.addEventListener('click', () => openConceptWorkspace());
  dialog.querySelector('#conceptClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { ++token; document.getElementById('conceptBtn')?.focus({ preventScroll: true }); });
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    const current = event.target.closest('[data-concept-tab]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...dialog.querySelectorAll('[data-concept-tab]')], index = buttons.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1)+buttons.length)%buttons.length;
    tab = buttons[next].dataset.conceptTab; buttons[next].focus(); render();
  });
  dialog.addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.conceptTab) { tab = button.dataset.conceptTab; render(); }
    else if (button.dataset.conceptAction) handleAction(button);
  });
  dialog.addEventListener('submit', (event) => { event.preventDefault(); if (event.target.matches('[data-concept-form]')) submit(event.target); });
  document.addEventListener(PROJECT_CHANGE_EVENT, () => { if (dialog.open) render(); });
}
