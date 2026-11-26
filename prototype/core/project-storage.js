import { driveProjectStamp } from "./google-drive-projects.js";

export function projectStorageInfo(project, { owner, state, archived = false } = {}) {
  const googleAccount = /^google-\d{1,40}$/.test(owner || "");
  const stamp = project?.updatedAt && Number(project.revision) >= 1 ? driveProjectStamp(project) : null;
  const confirmed = !archived && googleAccount && state?.owner === owner && state?.id === project?.id &&
    typeof state.fileId === "string" && state.fileId.length > 0 && stamp && state.stamp === stamp && !state.pending;
  if (confirmed) return {
    kind: "drive", label: "Google Диск",
    description: "Сохранено в Google Диске. Копия также есть на телефоне.",
  };
  return {
    kind: "phone", label: "На телефоне",
    description: archived ? "В корзине на телефоне." : googleAccount
      ? "На телефоне. Сохранение текущей версии в Google Диске ещё не подтверждено."
      : "Сохранено на телефоне.",
  };
}
