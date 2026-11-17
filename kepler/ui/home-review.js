// Этап 7 «Проверка проекта».
//
// Панель не выдаёт общий балл и не подменяет экспертизу. Она раскладывает
// результаты уже существующих проверок на доказанные проблемы, неизвестные
// данные и проверенные факты. Скрытое пользователем замечание остаётся
// отдельной записью и никогда не считается исправленным.

import { analyzeHomeReview } from '../core/home-review.js';
import { escapeHtml } from './dom.js';
import { ergoAnalysis } from './render-ergonomics.js';

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' ? value : {});

const VIEW_LABELS = Object.freeze({
  site: 'Участок и исходные данные',
  program: 'Программа дома',
  flows: 'Зоны и маршруты',
  engineering: 'Инженерные связи',
  circulation: 'Движение и проходы',
  climate: 'Свет и солнце',
});

const STATUS_LABELS = Object.freeze({
  checked: 'Проверено',
  attention: 'Требует внимания',
  blocked: 'Есть препятствие',
  unknown: 'Недостаточно данных',
});

let lastReview = null;

function normalizedStatus(value) {
  const status = String(value || 'unknown').toLocaleLowerCase('ru-RU');
  if (['blocked', 'conflict', 'error', 'fail', 'invalid'].includes(status)) return 'blocked';
  if (['attention', 'warning', 'warn', 'narrow'].includes(status)) return 'attention';
  if (['checked', 'ready', 'proven', 'fact', 'verified', 'ok', 'pass', 'done'].includes(status)) return 'checked';
  // candidate, partial и approximate означают недостаток доказательств, а
  // не мягкую зелёную проверку.
  return 'unknown';
}

function safeReview(project, state = {}) {
  try {
    // Итоговая проверка должна видеть все группы замечаний. Экранный
    // state.issues может быть отфильтрован пользователем в правой панели.
    const ergo = Array.isArray(state?.walls)
      ? array(ergoAnalysis(project, state.walls)?.findings) : [];
    return analyzeHomeReview(project, {
      issueOptions: {
        norms: state?.norms,
        walls: state?.walls,
        gaps: state?.gaps,
        ergo,
      },
    }) || {};
  } catch (error) {
    console.error('Итоговая проверка проекта не рассчиталась:', error);
    return {
      status: 'unknown', stages: [], provenProblems: [], checkedFacts: [], hidden: [],
      unknowns: [{ id: 'review-error', title: 'Проверка недоступна', text: 'Не удалось собрать сводку. Исходные данные проекта не изменены.' }],
    };
  }
}

function itemText(item, fallback = 'Подробности не указаны.') {
  if (typeof item === 'string') return item;
  return item?.text || item?.summary || item?.reason || item?.message || item?.description || fallback;
}

function itemTitle(item, fallback) {
  if (typeof item === 'string') return fallback;
  return item?.title || item?.label || item?.name || fallback;
}

function itemId(item, kind, index) {
  if (item && typeof item === 'object' && item.id != null) return String(item.id);
  return `${kind}-${index + 1}`;
}

function stageView(stage) {
  const candidate = stage?.view || stage?.viewId || stage?.stageId || stage?.id;
  return Object.hasOwn(VIEW_LABELS, candidate) ? candidate : null;
}

function stageCards(review) {
  const stages = array(review?.stages);
  if (!stages.length) {
    return '<p class="home-review-empty">Этапы ещё не рассчитаны. Сначала создайте помещения и заполните исходные данные.</p>';
  }
  return `<div class="home-review-stages">${stages.map((stage) => {
    const view = stageView(stage);
    const status = normalizedStatus(stage?.status);
    const title = itemTitle(stage, VIEW_LABELS[view] || 'Этап проекта');
    return `<article class="home-review-stage" data-status="${escapeHtml(status)}" data-home-review-stage="${escapeHtml(view || stage?.id || '')}">
      <header><h3>${escapeHtml(title)}</h3><span>${escapeHtml(STATUS_LABELS[status])}</span></header>
      <p>${escapeHtml(itemText(stage, 'Результат этого этапа ещё не определён.'))}</p>
      ${view ? `<button type="button" data-home-review-action="open-stage" data-home-review-view="${escapeHtml(view)}">Вернуться к этапу</button>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function isActionable(item) {
  const source = item?.issue || item;
  return Boolean(source && (source.target || source.focus || source.levelId));
}

function findingRows(items, kind, emptyText, { hidden = false, checked = false } = {}) {
  const rows = array(items);
  if (!rows.length) return `<p class="home-review-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="home-review-findings">${rows.map((raw, index) => {
    const item = typeof raw === 'string' ? { text: raw } : object(raw);
    const id = itemId(item, kind, index);
    const view = stageView(item);
    const status = hidden ? 'unknown' : checked ? 'checked'
      : normalizedStatus(item.status || item.severity || (kind === 'problem' ? 'attention' : 'unknown'));
    const title = itemTitle(item, kind === 'problem' ? 'Замечание' : kind === 'unknown' ? 'Не хватает данных' : kind === 'hidden' ? 'Скрытое замечание' : 'Проверенный факт');
    const action = isActionable(item)
      ? `<button type="button" data-home-review-action="show-issue" data-home-review-kind="${escapeHtml(kind)}" data-home-review-item-id="${escapeHtml(id)}">Показать на плане</button>`
      : view && !checked
        ? `<button type="button" data-home-review-action="open-stage" data-home-review-view="${escapeHtml(view)}">Перейти к этапу</button>`
        : '';
    return `<li data-status="${escapeHtml(status)}" data-home-review-item="${escapeHtml(id)}">
      <div><strong>${escapeHtml(title)}</strong>${hidden ? '<span class="home-review-hidden-label">Скрыто пользователем, не исправлено</span>' : ''}</div>
      <p>${escapeHtml(itemText(item))}</p>
      ${action}
    </li>`;
  }).join('')}</ul>`;
}

function reviewCounts(review) {
  const problems = array(review?.provenProblems);
  const unknowns = array(review?.unknowns);
  const checked = array(review?.checkedFacts);
  const hidden = array(review?.hidden);
  return { problems: problems.length, unknowns: unknowns.length, checked: checked.length, hidden: hidden.length };
}

function overallStatus(review, counts) {
  const direct = normalizedStatus(review?.status);
  if (direct === 'blocked') return direct;
  const stages = array(review?.stages).map((stage) => normalizedStatus(stage?.status));
  const problems = array(review?.provenProblems).map((item) => normalizedStatus(item?.status || item?.severity || 'attention'));
  if (stages.includes('blocked') || problems.includes('blocked')) return 'blocked';
  if (counts.unknowns || stages.includes('unknown')) return 'unknown';
  if (counts.problems || stages.includes('attention') || direct === 'attention') return 'attention';
  return counts.checked && stages.length ? 'checked' : 'unknown';
}

export function homeReviewHtml(project, state = {}) {
  const review = safeReview(project, state);
  lastReview = review;
  const counts = reviewCounts(review);
  const status = overallStatus(review, counts);
  return `<div class="home-review" data-home-review>
    <section class="home-review-summary" data-status="${escapeHtml(status)}" aria-labelledby="homeReviewSummaryTitle">
      <div><h2 id="homeReviewSummaryTitle">Проблемы, неизвестное и проверенное</h2><p>${escapeHtml(STATUS_LABELS[status])}</p></div>
      <dl>
        <div><dt>Проблемы</dt><dd>${counts.problems}</dd></div>
        <div><dt>Не хватает данных</dt><dd>${counts.unknowns}</dd></div>
        <div><dt>Проверено</dt><dd>${counts.checked}</dd></div>
        <div><dt>Скрыто</dt><dd>${counts.hidden}</dd></div>
      </dl>
    </section>
    <p class="home-review-disclaimer"><strong>Это эскизная сводка, а не экспертиза и не разрешение на строительство.</strong> Проверено означает только результат перечисленной проверки по текущим данным. Неизвестное не считается пройденным, а скрытое замечание не считается исправленным.</p>
    <section class="home-review-section" aria-labelledby="homeReviewStagesTitle">
      <h2 id="homeReviewStagesTitle">Этапы проектирования</h2>
      ${stageCards(review)}
    </section>
    <section class="home-review-section" aria-labelledby="homeReviewProblemsTitle">
      <h2 id="homeReviewProblemsTitle">Доказанные проблемы</h2>
      ${findingRows(review?.provenProblems, 'problem', 'Доказанных проблем по выполненным проверкам не найдено. Это не означает, что неизвестные данные проверены.')}
    </section>
    <section class="home-review-section" aria-labelledby="homeReviewUnknownsTitle">
      <h2 id="homeReviewUnknownsTitle">Недостаточно данных и допущения</h2>
      ${findingRows(review?.unknowns, 'unknown', 'Для выполненных проверок неизвестные данные не зафиксированы.')}
    </section>
    <section class="home-review-section" aria-labelledby="homeReviewCheckedTitle">
      <h2 id="homeReviewCheckedTitle">Проверенные факты</h2>
      ${findingRows(review?.checkedFacts, 'checked', 'Подтверждённых фактов пока нет.', { checked: true })}
    </section>
    <section class="home-review-section home-review-hidden" aria-labelledby="homeReviewHiddenTitle">
      <h2 id="homeReviewHiddenTitle">Скрытые пользователем</h2>
      ${findingRows(review?.hidden, 'hidden', 'Скрытых замечаний нет.', { hidden: true })}
    </section>
  </div>`;
}

function findReviewItem(review, kind, id) {
  const source = kind === 'problem' ? review?.provenProblems
    : kind === 'unknown' ? review?.unknowns
      : kind === 'hidden' ? review?.hidden : review?.checkedFacts;
  return array(source).find((item, index) => itemId(typeof item === 'string' ? { text: item } : item, kind, index) === id) || null;
}

export function handleHomeReviewClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-review-action]');
  if (!button) return false;
  const action = button.dataset.homeReviewAction;
  if (action === 'open-stage') {
    const view = button.dataset.homeReviewView;
    if (!Object.hasOwn(VIEW_LABELS, view)) return false;
    if (view === 'site') deps.openSiteStage?.();
    else deps.openHomeView?.(view);
    deps.announce?.(`Открыт этап «${VIEW_LABELS[view]}»`);
    return true;
  }
  if (action !== 'show-issue') return false;
  const review = deps.review || lastReview;
  const item = findReviewItem(review, button.dataset.homeReviewKind, button.dataset.homeReviewItemId);
  if (!item) return false;
  deps.closePanel?.({ restoreFocus: false });
  const target = item?.issue || item;
  if (typeof deps.goToIssue === 'function') deps.goToIssue(target);
  else deps.focusIssue?.(target);
  deps.announce?.('Замечание показано на плане');
  return true;
}
