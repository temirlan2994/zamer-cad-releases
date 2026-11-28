import { validateReviewSnapshot } from '../core/concept-review.js';

const safeJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

// Однофайловый клиентский просмотр: тот же проверенный viewer и зависимости
// упаковываются как локальные ES-модули. Данные снимка не исполняются как код.
export async function buildReviewDocument(snapshot, { baseUrl = new URL('../', import.meta.url).href, fetcher = fetch } = {}) {
  await validateReviewSnapshot(snapshot);
  const files = new Map(), pending = new Set();
  const moduleId = (url) => `@kepler/${new URL(url).pathname}`;
  const visit = (url) => {
    if (files.has(url)) return;
    files.set(url, '');
    const job = (async () => {
      const response = await fetcher(url); if (!response.ok) throw new Error('Не удалось загрузить модуль клиентского просмотра');
      const source = await response.text();
      const imports = /\b(from\s*|import\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/g;
      files.set(url, source.replace(imports, (_match, prefix, quote, relative) => {
        const dependency = new URL(relative, url).href; visit(dependency);
        return `${prefix}${quote}${moduleId(dependency)}${quote}`;
      }));
    })();
    pending.add(job); job.finally(() => pending.delete(job)).catch(() => {});
  };
  const entry = new URL('ui/review-client.js', baseUrl).href; visit(entry);
  while (pending.size) await Promise.all([...pending]);
  const [htmlResponse, cssResponse, reviewCssResponse] = await Promise.all(['review.html','styles.css','review.css'].map((path) => fetcher(new URL(path, baseUrl).href)));
  if (![htmlResponse,cssResponse,reviewCssResponse].every((response) => response.ok)) throw new Error('Не удалось подготовить клиентский файл');
  let html = await htmlResponse.text();
  const css = `${await cssResponse.text()}\n${await reviewCssResponse.text()}`.replaceAll('</style', '<\\/style');
  html = html.replace(/<link rel="stylesheet"[^>]+>/g, '');
  html = html.replace('</head>', `<style>${css}</style></head>`);
  const scripts = `<script id="reviewSnapshot" type="application/json">${safeJson(snapshot)}</script><script>
  const sources=${safeJson(Object.fromEntries([...files].map(([url,source])=>[moduleId(url),source])))};
  const imports={};for(const [id,source] of Object.entries(sources))imports[id]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
  const boot=document.createElement('script');boot.type='module';boot.textContent=${safeJson(`import ${JSON.stringify(moduleId(entry))};`)};document.body.append(boot);
  </script>`;
  return html.replace(/<script type="module" src="\.\/ui\/review-client\.js"><\/script>/, scripts);
}
