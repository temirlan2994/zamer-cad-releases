import { buildStructuredExport, buildProjectDxf, buildSitePlanDxf } from './export.js';
import { buildIfc } from './ifc.js';
import { deserializeProject, serializeProject } from './model.js';
import { buildRoomScheduleCsv } from './schedule.js';
import { auditModelLinks } from './model-audit.js';
import { analyzeConstructability } from './concept-construction.js';
import { analyzeRegulations } from './concept-regulations.js';
import { estimateConceptBudget, budgetCsv } from './concept-budget.js';
import { designDigest, reviewApproval, sha256 } from './concept-review.js';
import { conceptBimGeometry } from './concept-bim-geometry.js';

export function exportPreflight(project) {
  const model = auditModelLinks(project);
  const warnings = [];
  const add = (code, message) => warnings.push({ code, message });
  if (!(project.levels || []).some((level) => level.rooms.length || level.walls?.length)) add('empty', 'В модели нет помещений или стен');
  for (const level of project.levels || []) {
    if (level.items.some((item) => item.kind === 'stairs')) add(`stairs:${level.id}`, `${level.name}: лестницы передаются геометрией IFC; импортёр Revit требует отдельной проверки лестниц`);
    if (level.openings.some((opening) => opening.span)) add(`span:${level.id}`, `${level.name}: межэтажные витражи требуют проверки семейств и верхних вырезов в Revit`);
  }
  if ((project.roofs?.length || 0) || project.envelope?.roofMode === 'linked') add('roof', 'Кровля и перекрытия доступны в IFC; покрытие импорта JSON в Revit проверяется отдельно');
  add('families', 'Для JSON-импорта Revit нужны загруженные семейства нужного размера; отчёт импортёра показывает замены и пропуски');
  return { status: model.status === 'blocked' || warnings.some((entry) => entry.code === 'empty') ? 'blocked' : 'ready_with_notes', model, warnings };
}

export async function buildConceptJson(project) {
  project = deserializeProject(serializeProject(project));
  if (exportPreflight(project).status === 'blocked') throw new Error('Перед передачей исправьте ошибки связей модели и проверьте наличие геометрии');
  const digest = await designDigest(project), json = buildStructuredExport(project);
  json.concept = { project_id: project.concept?.projectId || '', digest, variant_id: project.concept?.activeVariantId || null,
    geometry_complete: true, budget: estimateConceptBudget(project), construction: analyzeConstructability(project), regulations: analyzeRegulations(project), approval: reviewApproval(project, digest) };
  json.concept_geometry = conceptBimGeometry(project);
  return json;
}

export async function buildConceptHandoff(project, { now = new Date().toISOString() } = {}) {
  project = deserializeProject(serializeProject(project)); // Асинхронная сборка работает с одним неизменяемым состоянием.
  const digest = await designDigest(project), preflight = exportPreflight(project);
  if (preflight.status === 'blocked') throw new Error('Перед передачей исправьте ошибки связей модели и проверьте наличие геометрии');
  const budget = estimateConceptBudget(project), construction = analyzeConstructability(project), rules = analyzeRegulations(project);
  const json = await buildConceptJson(project);
  const files = [
    { name: 'project.kepler.json', data: serializeProject(project) },
    { name: 'model.export.json', data: JSON.stringify(json, null, 2) },
    { name: 'model.ifc', data: buildIfc(project).text },
    { name: 'plans.dxf', data: buildProjectDxf(project) },
    { name: 'revit.dxf', data: buildProjectDxf(project, { profile: 'revit' }) },
    { name: 'rooms.csv', data: buildRoomScheduleCsv(project) },
    { name: 'budget.csv', data: budgetCsv(budget) },
  ];
  if (project.site?.boundary?.length >= 3) files.push({ name: 'site.dxf', data: buildSitePlanDxf(project) });
  const manifest = { schema: 'kepler-handoff/1', digest, createdAt: now, project: project.name,
    variantId: project.concept?.activeVariantId || null, preflight, approval: reviewApproval(project, digest),
    checks: { budgetComplete: budget.complete, construction: construction.status, regulations: rules.status,
      revitRuntime: 'external_verification_required' }, files: [],
    scope: 'Архитектурная концепция. Наличие файлов не является приёмкой конструкций, нормативов или импорта в Revit.' };
  for (const file of files) manifest.files.push({ name: file.name, bytes: new TextEncoder().encode(file.data).length, sha256: await sha256(file.data) });
  files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  files.push({ name: 'README.txt', data: `Kepler — ${project.name}\nСнимок SHA-256: ${digest}\n\nОткройте manifest.json: состав, контрольные суммы, ограничения и решение по снимку.\nДля Revit: model.export.json через надстройку либо model.ifc.\nПосле импорта проверьте уровни, размеры и открывание проёмов, лестницы, кровлю и координаты. Сохраните отчёт импорта.\nИсходный редактируемый проект: project.kepler.json.\nБюджет: budget.csv; отсутствие цены не означает ноль.\n${manifest.scope}\n` });
  return { files, manifest };
}
