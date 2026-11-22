// Разрывает цикл между projects.js и большим input.js. Редактор проектов
// может попросить отменить текущий жест, не импортируя весь модуль ввода.

let cancelGesture = null;

export function registerEditGestureCancel(handler) {
  cancelGesture = typeof handler === 'function' ? handler : null;
}

export function cancelEditingGesture() {
  cancelGesture?.();
}
