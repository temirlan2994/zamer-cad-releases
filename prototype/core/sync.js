export function projectRevision(project) {
  const value = Number(project?.revision);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function projectSavedTime(project) {
  return Date.parse(project?.serverSavedAt || project?.savedAt || project?.localSavedAt || "") || 0;
}

export function chooseProjectSource(localProject, serverProject) {
  if (!localProject && !serverProject) return { project: null, source: "none", shouldPush: false };
  if (!localProject) return { project: serverProject, source: "server", shouldPush: false };
  if (!serverProject) {
    return { project: localProject, source: "local", shouldPush: Boolean(localProject.syncPending) };
  }

  if (localProject.syncPending) {
    return { project: localProject, source: "local-pending", shouldPush: true };
  }

  const localRevision = projectRevision(localProject);
  const serverRevision = projectRevision(serverProject);
  if (serverRevision > localRevision) return { project: serverProject, source: "server", shouldPush: false };
  if (localRevision > serverRevision) return { project: localProject, source: "local", shouldPush: true };

  if (projectSavedTime(localProject) > projectSavedTime(serverProject)) {
    return { project: localProject, source: "local", shouldPush: true };
  }
  return { project: serverProject, source: "server", shouldPush: false };
}
