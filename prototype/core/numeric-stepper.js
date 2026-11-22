import { parseLineDecimal } from "./line-input.js";

export const NUMERIC_STEPS = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100];

export function normalizeNumericStep(value) {
  return NUMERIC_STEPS.includes(value) ? value : 1;
}

export function steppedNumber(base, steps, step, { min = -Infinity, max = Infinity } = {}) {
  return Math.min(max, Math.max(min, Number((base + steps * step).toFixed(9))));
}

export function numericDragDelta(pixels, elapsedMs) {
  const speed = Math.abs(pixels) / Math.max(8, elapsedMs);
  const gain = Math.min(4.8, 0.75 + speed * 2);
  return pixels * gain / 10;
}

export function addNumericStepper(input, { getStep, limits = () => ({}), beforeChange, onHold } = {}) {
  const control = document.createElement("div");
  control.className = "numeric-stepper";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", "Изменить число");
  input.parentElement.append(control);
  let press = null;
  const dragThreshold = 8;

  const setValue = (value) => {
    if (input.value === value) return;
    beforeChange?.();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const read = () => {
    const { min, max, initial = 0 } = limits();
    return {
      base: parseLineDecimal(input.value) ?? parseLineDecimal(input.placeholder) ?? initial,
      min: min ?? parseLineDecimal(input.min) ?? -Infinity,
      max: max ?? parseLineDecimal(input.max) ?? Infinity,
      step: getStep(),
    };
  };
  const apply = (origin, steps) => setValue(String(steppedNumber(origin.base, steps, origin.step, origin)));
  const move = (event) => {
    const pixels = press.y - event.clientY;
    if (!press.dragged && Math.abs(pixels) < dragThreshold) return;
    press.dragged = true;
    const delta = numericDragDelta(pixels, event.timeStamp - press.time);
    press.y = event.clientY;
    press.time = event.timeStamp;
    press.total = Math.max(press.minSteps, Math.min(press.maxSteps, press.total + delta));
    const steps = Math.trunc(press.total);
    if (steps === press.steps) return;
    press.steps = steps;
    if (steps) apply(press, steps);
    else setValue(press.original);
  };
  const release = () => {
    press = null;
    onHold?.(false);
  };
  const cancel = (event) => {
    if (press?.id !== event.pointerId) return;
    const { dragged, original } = press;
    release();
    if (dragged) setValue(original);
  };

  for (const [direction, label] of [[1, "Увеличить"], [-1, "Уменьшить"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stepDirection = String(direction);
    button.setAttribute("aria-label", label);
    if (input.id) button.setAttribute("aria-controls", input.id);
    control.append(button);
    button.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || input.disabled || press) return;
      event.preventDefault();
      event.stopPropagation();
      const origin = read();
      press = {
        ...origin, id: event.pointerId, y: event.clientY, time: event.timeStamp, original: input.value, dragged: false,
        total: 0, steps: 0,
        minSteps: Math.min(0, Math.floor((origin.min - origin.base) / origin.step)),
        maxSteps: Math.max(0, Math.ceil((origin.max - origin.base) / origin.step)),
      };
      button.setPointerCapture(event.pointerId);
      onHold?.(true);
    });
    button.addEventListener("pointermove", (event) => {
      if (press?.id === event.pointerId) move(event);
    });
    button.addEventListener("pointerup", (event) => {
      if (press?.id !== event.pointerId) return;
      move(event);
      const bounds = button.getBoundingClientRect();
      if (!press.dragged && event.clientX >= bounds.left && event.clientX <= bounds.right &&
          event.clientY >= bounds.top && event.clientY <= bounds.bottom) apply(press, direction);
      release();
    });
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", cancel);
    button.addEventListener("click", (event) => {
      if (event.detail === 0 && !input.disabled) apply(read(), direction);
    });
  }
}
