// Итоговая проверка проекта: объединяет уже существующие анализы, но не
// превращает их в один непрозрачный «балл качества». Проверенные проблемы,
// неизвестные исходные данные, подтверждённые факты и скрытые пользователем
// замечания остаются разными списками.

import { analyzeHomeCirculation } from './home-circulation.js';
import { analyzeHomeClimateOverview } from './home-climate.js';
import { analyzeHomeEngineering } from './home-engineering.js';
import { analyzeHomeFlows } from './home-flows.js';
import { analyzeHomeProgram } from './home-program.js';
import { collectIssues } from './issues.js';
import { layoutBriefReadiness } from './layout-brief.js';
import { sitePlanningRoute } from './site-planning.js';

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const STAGE_TITLES = Object.freeze({
  site: 'Участок и исходные данные',
  program: 'Программа дома',
  flows: 'Зоны и маршруты',
  engineering: 'Инженерные связи',
  circulation: 'Движение и проходы',
  climate: 'Свет и солнце',
});

const READINESS_STAGE = Object.freeze({
  solar: 'climate',
  actors: 'program',
  accessibility: 'circulation',
  capacity: 'program',
  scenarios: 'flows',
  engineering: 'engineering',
  storage: 'program',
  manuals: 'circulation',
  uncertainty: 'program',
});

const ISSUE_STAGE = Object.freeze({
  access: 'flows',
  light: 'climate',
  insolation: 'climate',
  furniture: 'circulation',
  ergo: 'circulation',
  geometry: 'circulation',
  norms: 'program',
});

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function solarContextVerified(project) {
  const site = project?.site || {};
  const location = site.location || {};
  return site.solarVerified === true
    && [location.lat, location.lon, location.tz, site.north].every(finite);
}

function issueEntry(issue, { hidden = false } = {}) {
  return {
    id: `${hidden ? 'hidden' : 'issue'}:${issue.id}`,
    sourceId: issue.id,
    source: 'issues',
    stageId: ISSUE_STAGE[issue.group] || null,
    severity: hidden ? 'hidden' : 'warning',
    title: issue.title || 'Замечание проекта',
    text: hidden
      ? `${issue.text || 'Замечание скрыто.'} Скрытие не означает, что оно исправлено.`
      : issue.text || 'Требуется проверка.',
    group: issue.group || null,
    levelId: issue.levelId || null,
    target: issue.target || null,
    focus: issue.focus || null,
    issue,
  };
}

function stageRecord(id, status, summary) {
  return {
    id,
    title: STAGE_TITLES[id],
    status,
    summary,
    problemCount: 0,
    unknownCount: 0,
    factCount: 0,
  };
}

function siteStage(result) {
  if (result?.status === 'error') {
    return stageRecord('site', 'blocked', 'В исходных данных участка есть геометрическая ошибка.');
  }
  if (result?.status === 'done') {
    return stageRecord('site', 'checked', 'Обязательные исходные данные маршрута участка собраны.');
  }
  const done = Number(result?.completed || 0);
  const total = Number(result?.total || 0);
  return stageRecord('site', 'unknown', total
    ? `Собрано обязательных исходных данных: ${done} из ${total}.`
    : 'Исходные данные участка ещё не собраны.');
}

function programStage(result) {
  if (result?.status === 'ready') {
    return stageRecord('program', 'checked', result.summary?.text || 'Подтверждённая программа сопоставлена с планом.');
  }
  if (result?.status === 'incomplete') {
    const missing = Number(result.summary?.missingRooms || 0);
    const connections = Number(result.summary?.connectionIssues || 0);
    return stageRecord('program', missing || connections ? 'blocked' : 'attention', result.summary?.text || 'Подтверждённая программа не завершена.');
  }
  return stageRecord('program', 'unknown', result?.summary?.text || 'Программа дома не подтверждена.');
}

function flowsStage(result) {
  if (result?.status === 'ready') {
    return stageRecord('flows', 'checked', 'Все заданные сценарии имеют известные связи и частоту.');
  }
  if (result?.status === 'incomplete') {
    return stageRecord('flows', 'blocked', 'Есть обязательный маршрут без доказанного перехода.');
  }
  if (result?.status === 'draft') {
    return stageRecord('flows', 'unknown', 'Часть маршрутов, обязательности или частот ещё не определена.');
  }
  return stageRecord('flows', 'unknown', 'Бытовые сценарии ещё не заданы.');
}

function engineeringStage(result) {
  if (result?.status === 'conflict' || array(result?.conflicts).length) {
    return stageRecord('engineering', 'blocked', 'В исходных инженерных точках найдены конфликты.');
  }
  // candidate — лишь геометрический кандидат/частичное покрытие, а не
  // спроектированная система. Поэтому он никогда не становится зелёным.
  if (result?.status === 'candidate') {
    return stageRecord('engineering', 'unknown', 'Есть потребности или кандидаты, но система и трассы не подтверждены.');
  }
  if (result?.status === 'fact') {
    return stageRecord('engineering', 'checked', 'Зафиксированы явные исходные инженерные точки.');
  }
  return stageRecord('engineering', 'unknown', 'Инженерные исходные данные не обследованы.');
}

function circulationStage(result) {
  if (result?.status === 'blocked') {
    return stageRecord('circulation', 'blocked', 'Есть рассчитанный маршрут, который не проходит выбранным профилем.');
  }
  if (result?.status === 'narrow') {
    return stageRecord('circulation', 'attention', 'Есть узкие места — их размеры известны и требуют решения.');
  }
  if (result?.status === 'clear') {
    return stageRecord('circulation', 'checked', 'Все рассчитанные маршруты проходят выбранным профилем.');
  }
  return stageRecord('circulation', 'unknown', 'Часть маршрутов приблизительна, не привязана или не рассчитана.');
}

function climateStage(result) {
  if (result?.status === 'conflict') {
    return stageRecord('climate', 'blocked', 'В исходных данных света или вентиляции найден конфликт.');
  }
  const rooms = Number(result?.summary?.roomCount || array(result?.rooms).length || 0);
  const solar = result?.sources?.solar?.status;
  const climate = result?.sources?.climate?.status;
  const envelope = result?.sources?.envelope?.status;
  if (!rooms) return stageRecord('climate', 'unknown', 'Сначала нужны помещения и окна для световой оценки.');
  if (solar !== 'verified') {
    return stageRecord('climate', 'unknown', solar === 'estimated'
      ? 'Координаты или север не подтверждены; солнечный результат ориентировочный.'
      : 'Не хватает координат, часового пояса или направления севера.');
  }
  if (climate === 'missing' || envelope === 'missing') {
    return stageRecord('climate', 'unknown', 'Свет можно оценить, но для микроклимата нет климатического файла и параметров оболочки.');
  }
  return stageRecord('climate', 'attention', 'Свет рассчитан предварительно; вывод не является нормативным заключением.');
}

function flattenIssueItems(report) {
  return array(report?.groups).flatMap((group) => array(group?.items));
}

function addAnalysisEntries({ project, siteRoute, program, flows, engineering, circulation, climate }, buckets) {
  const { provenProblems, unknowns, checkedFacts } = buckets;

  for (const stage of array(siteRoute?.stages)) {
    for (const task of array(stage?.tasks)) {
      const entry = {
        id: `site:${task.id}`,
        stageId: 'site',
        title: task.label || stage.title || 'Исходные данные участка',
        text: task.reason || 'Статус исходных данных участка требует проверки.',
      };
      if (task.status === 'error') {
        provenProblems.push({ ...entry, severity: 'error' });
      } else if (task.status === 'done') {
        checkedFacts.push(entry);
      } else if (task.required !== false) {
        unknowns.push(entry);
      }
    }
  }

  for (const target of array(program?.targets)) {
    if (target?.source === 'confirmed' && Number(target.missingCount || 0) > 0) {
      provenProblems.push({
        id: `program:missing:${target.id}`, stageId: 'program', severity: 'warning',
        title: target.title || 'Помещение по программе',
        text: `По подтверждённой программе не хватает: ${Number(target.missingCount)}.`,
      });
    }
  }
  for (const field of array(program?.unresolvedFields)) {
    unknowns.push({
      id: `program:field:${field}`, stageId: 'program', title: 'Не решено поле программы',
      text: String(field),
    });
  }
  if (program?.status === 'ready') {
    checkedFacts.push({
      id: 'program:ready', stageId: 'program', title: 'Программа сопоставлена с планом',
      text: program.summary?.text || 'Подтверждённые помещения и связи найдены.',
    });
  }

  for (const scenario of array(flows?.scenarios)) {
    for (const route of array(scenario?.routes)) {
      const id = route.id || `${scenario.scenarioId || 'scenario'}:route`;
      if (route.status === 'missing' && scenario.mandatory === true) {
        provenProblems.push({
          id: `flows:missing:${id}`, stageId: 'flows', severity: 'error',
          title: scenario.title || 'Обязательный маршрут', text: route.reason || 'Переход не найден.',
          levelId: route.levelId || null,
        });
      } else if (!['co_located', 'direct', 'reachable'].includes(route.status)
        || !scenario?.frequency?.known || scenario.mandatory == null) {
        unknowns.push({
          id: `flows:unknown:${id}`, stageId: 'flows', title: scenario.title || 'Маршрут сценария',
          text: route.reason || 'Нужно уточнить привязку, обязательность или частоту.',
        });
      }
    }
  }
  if (flows?.status === 'ready') {
    checkedFacts.push({
      id: 'flows:ready', stageId: 'flows', title: 'Сценарии связаны',
      text: `Проверено маршрутов: ${Number(flows.summary?.resolvedRouteCount || 0)}.`,
    });
  }

  for (const conflict of array(engineering?.conflicts)) {
    provenProblems.push({
      id: `engineering:conflict:${conflict.pointId || conflict.code || provenProblems.length + 1}`,
      stageId: 'engineering', severity: 'error', title: 'Конфликт инженерной точки',
      text: conflict.text || conflict.reason || 'Точка противоречит известным исходным данным.',
    });
  }
  const verifiedPoints = Number(engineering?.summary?.verifiedPointCount || 0);
  if (verifiedPoints > 0) {
    checkedFacts.push({
      id: 'engineering:fixed-points', stageId: 'engineering', title: 'Исходные точки зафиксированы',
      text: `Подтверждено точек: ${verifiedPoints}. Это не означает, что трассы рассчитаны.`,
    });
  }
  if (engineering?.status === 'candidate') {
    unknowns.push({
      id: 'engineering:candidate', stageId: 'engineering', title: 'Инженерная схема не подтверждена',
      text: 'Кандидаты и покрытие потребностей не являются расчётом трасс, расходов воздуха или гидравлики.',
    });
  }

  for (const route of array(circulation?.routes)) {
    const id = route.id || `route-${unknowns.length + provenProblems.length + 1}`;
    if (route.status === 'blocked') {
      provenProblems.push({
        id: `circulation:blocked:${id}`, stageId: 'circulation', severity: 'error',
        title: route.title || 'Маршрут заблокирован', text: route.reason || 'Выбранный профиль не проходит.',
        levelId: route.levelId || null,
      });
    } else if (route.status === 'narrow') {
      provenProblems.push({
        id: `circulation:narrow:${id}`, stageId: 'circulation', severity: 'warning',
        title: route.title || 'Узкое место', text: route.reason || 'Ширина меньше комфортного ориентира.',
        levelId: route.levelId || null,
      });
    } else if (route.status === 'unknown' || route.status === 'approximate') {
      unknowns.push({
        id: `circulation:unknown:${id}`, stageId: 'circulation', title: route.title || 'Маршрут не подтверждён',
        text: route.reason || 'Не хватает привязки или безопасный бюджет расчёта исчерпан.',
      });
    }
  }
  const clearRoutes = Number(circulation?.summary?.clear || 0);
  if (clearRoutes > 0) {
    checkedFacts.push({
      id: 'circulation:clear', stageId: 'circulation', title: 'Рассчитанные маршруты проходят',
      text: `Геометрически проходят выбранным профилем: ${clearRoutes}.`,
    });
  }

  if (array(climate?.rooms).length) {
    checkedFacts.push({
      id: 'climate:window-inventory', stageId: 'climate', title: 'Окна помещений учтены',
      text: `Помещений: ${array(climate.rooms).length}; без окон: ${Number(climate.summary?.windowlessRoomCount || 0)}.`,
    });
  }
  if (climate?.sources?.solar?.status === 'verified') {
    checkedFacts.push({
      id: 'climate:solar-source', stageId: 'climate', title: 'Солнечные исходные данные подтверждены',
      text: 'Координаты, часовой пояс и направление севера заданы и подтверждены пользователем.',
    });
  } else {
    unknowns.push({
      id: 'climate:solar-source', stageId: 'climate', title: 'Солнечные исходные данные не подтверждены',
      text: climate?.sources?.solar?.reason || 'Нужно подтвердить координаты, часовой пояс и направление севера.',
    });
  }
  if (climate?.sources?.climate?.status === 'missing') {
    unknowns.push({
      id: 'climate:weather-file', stageId: 'climate', title: 'Нет климатического файла',
      text: 'Температуру, перегрев и тепловой комфорт без погодного файла не рассчитываем.',
    });
  }
  if (climate?.sources?.envelope?.status === 'missing') {
    unknowns.push({
      id: 'climate:envelope', stageId: 'climate', title: 'Не заданы параметры оболочки',
      text: 'Нет подтверждённых теплотехнических свойств стен, окон и кровли.',
    });
  }

  // Явный страхующий unknown нужен даже если сторонний climate-адаптер
  // случайно назвал источник verified без полного набора полей.
  if (!solarContextVerified(project)) {
    unknowns.push({
      id: 'climate:solar-strong-gate', stageId: 'climate', title: 'Солнце остаётся ориентировочным',
      text: 'Для подтверждения нужны конечные lat/lon/tz/north и явное подтверждение пользователя.',
    });
  }
}

/**
 * Собрать итоговую, эскизную проверку без общего балла и без нормативного
 * заключения. Готовые результаты можно передать в options — это позволяет UI
 * переиспользовать кеш и не запускать сеточные анализы при каждом рендере.
 */
export function analyzeHomeReview(project = {}, options = {}) {
  const siteRoute = options.siteRoute ?? sitePlanningRoute(project);
  const program = options.program ?? analyzeHomeProgram(project);
  const flows = options.flows ?? analyzeHomeFlows(project);
  const engineering = options.engineering ?? analyzeHomeEngineering(project);
  const circulation = options.circulation ?? analyzeHomeCirculation(project, { flows });
  const climate = options.climate ?? analyzeHomeClimateOverview(project);
  const readiness = options.readiness ?? layoutBriefReadiness(project);
  const issueReport = options.issues ?? collectIssues(project, options.issueOptions || {});

  const stages = [
    siteStage(siteRoute),
    programStage(program),
    flowsStage(flows),
    engineeringStage(engineering),
    circulationStage(circulation),
    climateStage(climate),
  ];
  const provenProblems = [];
  const unknowns = [];
  const checkedFacts = [];
  const hidden = array(issueReport?.hidden).map((issue) => issueEntry(issue, { hidden: true }));

  const strongSolar = solarContextVerified(project);
  for (const issue of flattenIssueItems(issueReport)) {
    if (issue?.severity === 'warn') {
      // Инсоляционный отчёт сам по себе не доказывает применимую норму.
      // Даже при подтверждённой географии это лишь ориентир проекта.
      if (issue.group === 'insolation') {
        unknowns.push({
          id: `insolation:reference:${issue.id}`, sourceId: issue.id, stageId: 'climate',
          title: issue.title || 'Инсоляционный ориентир',
          text: strongSolar
            ? `${issue.text} Требуется проверить применимость выбранного ориентира.`
            : 'Инсоляционный ориентир нельзя оценить без подтверждённых координат, часового пояса и севера.',
          levelId: issue.levelId || null, target: issue.target || null, focus: issue.focus || null,
        });
      } else provenProblems.push(issueEntry(issue));
    } else if (issue?.severity === 'ok' && issue.group !== 'insolation') {
      checkedFacts.push({
        id: `issue:checked:${issue.id}`, sourceId: issue.id,
        stageId: ISSUE_STAGE[issue.group] || null,
        title: issue.title || 'Проверено', text: issue.text || 'Проверка выполнена.',
        levelId: issue.levelId || null, target: issue.target || null, focus: issue.focus || null,
      });
    }
  }

  for (const section of array(readiness?.sections)) {
    if (section.status === 'ready' && section.required !== false) {
      checkedFacts.push({
        id: `readiness:ready:${section.id}`, stageId: READINESS_STAGE[section.id] || null,
        title: section.label, text: section.summary || 'Исходные данные заполнены.',
      });
    } else if (['missing', 'partial'].includes(section.status)) {
      unknowns.push({
        id: `readiness:${section.id}`, stageId: READINESS_STAGE[section.id] || null,
        title: section.label,
        text: [section.summary, ...array(section.missing)].filter(Boolean).join(' · '),
      });
    }
  }

  addAnalysisEntries({ project, siteRoute, program, flows, engineering, circulation, climate }, {
    provenProblems, unknowns, checkedFacts,
  });

  const result = {
    schema: 'kepler-home-review/1',
    preliminary: true,
    normative: false,
    stages,
    provenProblems: uniqueById(provenProblems),
    unknowns: uniqueById(unknowns),
    checkedFacts: uniqueById(checkedFacts),
    hidden: uniqueById(hidden),
  };

  for (const stage of result.stages) {
    stage.problemCount = result.provenProblems.filter((item) => item.stageId === stage.id).length;
    stage.unknownCount = result.unknowns.filter((item) => item.stageId === stage.id).length;
    stage.factCount = result.checkedFacts.filter((item) => item.stageId === stage.id).length;
  }
  result.counts = {
    provenProblems: result.provenProblems.length,
    unknowns: result.unknowns.length,
    checkedFacts: result.checkedFacts.length,
    hidden: result.hidden.length,
  };
  result.status = result.stages.some((stage) => stage.status === 'blocked')
    || result.provenProblems.some((item) => item.severity === 'error') ? 'blocked'
      : result.unknowns.length || result.stages.some((stage) => stage.status === 'unknown') ? 'unknown'
        : result.provenProblems.length || result.stages.some((stage) => stage.status === 'attention') ? 'attention'
          : 'checked';
  return result;
}
