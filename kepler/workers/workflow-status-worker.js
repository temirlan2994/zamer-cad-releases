import { attachLevelAccessors } from '../core/model.js';
import { analyzeWorkflowStatus } from '../core/workflow-status.js';

globalThis.addEventListener('message', ({ data }) => {
  globalThis.postMessage(analyzeWorkflowStatus(attachLevelAccessors(data.project), data.options));
});
