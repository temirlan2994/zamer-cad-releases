const revision = document.documentElement.dataset.keplerPreview;

async function checkForChanges() {
  try {
    const response = await fetch('./__kepler_revision', { cache: 'no-store' });
    if (response.ok && !response.redirected && response.headers.get('content-type')?.startsWith('text/plain')
        && (await response.text()) !== revision) {
      location.reload();
      return;
    }
  } catch {
    // Сервер может быть недоступен, пока рабочая среда перезапускается.
  }
  setTimeout(checkForChanges, 1200);
}

setTimeout(checkForChanges, 1200);
