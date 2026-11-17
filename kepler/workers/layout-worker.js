// Отдельный поток тяжёлого поиска вариантов. Отмена долгого синхронного
// поиска выполняется terminate() на стороне клиента; cancel-сообщение нужно
// для задач, которые ещё не начали вычисление.

import { createLayoutWorkerHandler } from '../core/layout-worker-handler.js';

const handle = createLayoutWorkerHandler({
  postMessage: (message) => globalThis.postMessage(message),
});

globalThis.addEventListener('message', (event) => {
  void handle(event);
});
