import { auditModelLinks } from './model-audit.js';
import { analyzeConstructability } from './concept-construction.js';
import { analyzeRegulations } from './concept-regulations.js';
import { estimateConceptBudget } from './concept-budget.js';
import { designDigest, reviewApproval } from './concept-review.js';
import { exportPreflight } from './concept-handoff.js';
import { sitePlanningRoute } from './site-planning.js';
import { analyzeHomeProgram } from './home-program.js';
import { analyzeHomeDeliverables } from './home-deliverables.js';
import { designVariants, projectForVariant } from './design-variants.js';
import { tepReport } from './tep.js';
import { windowsOf } from './insolation.js';
import { analyzeConnectivity } from './rooms.js';
import { levelProject } from './model.js';
import { deriveWalls } from './walls.js';

export async function analyzeConceptReadiness(project) {
  const model = auditModelLinks(project), budget = estimateConceptBudget(project), construction = analyzeConstructability(project);
  const rules = analyzeRegulations(project), site = sitePlanningRoute(project), program = analyzeHomeProgram(project);
  const deliverables = analyzeHomeDeliverables(project), preflight = exportPreflight(project), digest = await designDigest(project);
  const approval = reviewApproval(project, digest);
  const stages = [
    { id: 'model', title: 'Связи модели', status: model.status, detail: model.findings.length ? `${model.findings.length} замечаний` : 'Разорванных ссылок не найдено', tab: 'construction' },
    { id: 'site', title: 'Участок и исходные данные', status: site.status === 'done' ? 'checked' : 'unknown', detail: `${site.completed} из ${site.total} задач`, route: 'stage' },
    { id: 'program', title: 'Программа семьи', status: program.status === 'ready' ? 'checked' : 'unknown', detail: program.status === 'ready' ? 'Состав и связи подтверждены' : 'Уточните задание и сравните его с планом', route: 'program' },
    { id: 'variants', title: 'Выбор варианта', status: project.concept?.selectedVariantId && project.concept.selectedVariantId === project.concept.activeVariantId ? 'checked' : 'unknown', detail: `${designVariants(project).length} сохранённых вариантов`, tab: 'variants' },
    { id: 'construction', title: 'Конструктивная проверка', status: construction.status, detail: `${construction.findings.length} пунктов для проверки`, tab: 'construction' },
    { id: 'rules', title: 'Применимые правила', status: rules.status, detail: rules.scope, tab: 'rules' },
    { id: 'budget', title: 'Предварительный бюджет', status: budget.targetStatus === 'over' ? 'attention' : budget.complete ? 'checked' : 'unknown', detail: `${budget.pricedCount} из ${budget.requiredCount} разделов оценено`, tab: 'budget' },
    { id: 'approval', title: 'Согласование снимка', status: approval.status === 'approved' ? 'checked' : approval.status === 'revision' ? 'attention' : 'unknown', detail: approval.stale ? 'Есть решение по прежнему снимку' : 'Решение относится к контрольной сумме модели', tab: 'review' },
    { id: 'deliverables', title: 'Листы и выдача', status: deliverables.status === 'ready' ? 'checked' : 'attention', detail: `${deliverables.summary?.ready || 0} из ${deliverables.summary?.total || 6} видов/комплектов`, route: 'deliverables' },
  ];
  return { model, budget, construction, rules, site, program, deliverables, preflight, digest, approval, stages,
    checked: stages.filter((stage) => stage.status === 'checked').length,
    next: stages.find((stage) => ['blocked', 'error'].includes(stage.status)) || stages.find((stage) => stage.status !== 'checked') || null };
}

export function compareDesignVariants(project) {
  return designVariants(project).map((variant) => {
    const p = projectForVariant(project, variant.id), tep = tepReport(p), budget = estimateConceptBudget(p);
    const daylight = analyzeRegulations(p).checks.filter((check) => check.key === 'daylightRatio');
    const windows = new Set(windowsOf(p).map((window) => `${window.levelId}/${window.roomId}`));
    let unreachable = 0;
    for (const level of p.levels) {
      const lp = levelProject(p, level.id), graph = analyzeConnectivity(lp, deriveWalls(lp));
      unreachable += graph.unreachable?.length || graph.unreachableRoomIds?.length || 0;
    }
    return { id: variant.id, name: variant.name, project: p, area: tep.total, footprint: tep.footprint, storeys: tep.storeys,
      rooms: p.levels.reduce((sum, level) => sum+level.rooms.length, 0), roomsWithWindows: windows.size, daylight: { total: daylight.length, sufficient: daylight.filter((check) => check.actual != null && check.limit != null && check.actual >= check.limit).length, unknown: daylight.filter((check) => check.actual == null || check.limit == null).length }, unreachable, budget };
  });
}
