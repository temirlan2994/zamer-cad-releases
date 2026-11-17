// Чистые правила выбора проекта при запуске. Вынесены отдельно, чтобы
// сценарий «Новый проект без PID» никогда не превратился в перезапись
// последнего облачного проекта.

export function shouldOpenRecentCloudProject(pid, localProject) {
  return !pid && !localProject;
}

export function shouldUseRemoteProject(localProject, localSavedAt, remoteAt) {
  if (!localProject) return true;
  // Копию без даты нельзя безопасно сравнить: вызывающий код сохраняет её
  // как новый проект, не рискуя затереть ни локальную, ни облачную версию.
  if (!localSavedAt) return false;
  return Boolean(remoteAt && String(remoteAt) > String(localSavedAt));
}
