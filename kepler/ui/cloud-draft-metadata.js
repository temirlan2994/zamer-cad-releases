// Метаданные облачного черновика ленивые: локальный autosave должен только
// сохранить JSON, а не строить тяжёлую canvas-миниатюру. Перед настоящей
// облачной отправкой снимок материализуется из того же JSON и остаётся в
// объекте draft для повторной попытки после таймаута/офлайна.

export function lazyCloudDraft(text, order) {
  return { text, order, metadataReady: false };
}

export function projectStatsOf(project) {
  const levels = project?.levels || [];
  return {
    rooms: levels.reduce((sum, level) => sum + (level.rooms?.length || 0), 0),
    levels: levels.length,
  };
}

export function materializeCloudDraft(draft, { parse, thumbnail }) {
  if (!draft || draft.metadataReady) return draft;
  let project = null;
  try { project = parse(draft.text); } catch { /* валидность JSON проверит storage */ }
  let preview = null;
  try { if (project) preview = thumbnail(project); } catch { /* SVG fallback останется у storage */ }
  // Мутируем именно запись очереди: при повторной отправке после сетевой
  // ошибки canvas и разбор JSON больше не выполняются.
  draft.preview = preview;
  draft.stats = projectStatsOf(project);
  draft.metadataReady = true;
  return draft;
}
