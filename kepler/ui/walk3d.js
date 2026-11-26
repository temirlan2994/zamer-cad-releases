import { smoothWalkHeight, stepWalk, walkCamera, walkDirection, WALK_HEIGHT } from '../core/walk3d.js';

const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

// Управление камерой отдельно от инструментов редактирования модели.
export function createWalkController({ canvas, cam, repaint, exit }) {
  let active = false, world, player, lastFrame = null, drag = null, paused = false;
  let hadLock = false;
  const keys = new Set(), touchKeys = new Map(), inertBefore = new Map();
  const hint = document.getElementById('v3WalkHelp');
  const settings = document.getElementById('v3WalkSettings');
  const sensitivityInput = document.getElementById('v3WalkSensitivity');
  const sensitivityOutput = document.getElementById('v3WalkSensitivityValue');
  const controlsKey = 'kepler-walk-controls';
  let sensitivity = 1;
  try {
    const saved = JSON.parse(localStorage.getItem(controlsKey));
    if (Number.isFinite(saved?.sensitivity)) sensitivity = Math.max(0.25, Math.min(3, saved.sensitivity));
  } catch { /* Управление доступно и без хранилища. */ }
  const syncSensitivity = () => {
    sensitivityInput.value = String(sensitivity);
    sensitivityOutput.value = `${sensitivity.toFixed(2).replace('.', ',')}×`;
  };
  syncSensitivity();
  sensitivityInput.addEventListener('input', () => {
    sensitivity = Math.max(0.25, Math.min(3, Number(sensitivityInput.value) || 1));
    syncSensitivity();
    try { localStorage.setItem(controlsKey, JSON.stringify({ sensitivity })); } catch { /* Без хранилища — до перезагрузки. */ }
  });
  const locked = () => document.pointerLockElement === canvas;
  const updateHelp = () => {
    hint.textContent = matchMedia('(pointer: coarse)').matches
      ? 'Рост 1,70 м · Кнопки — идти · Проведите по сцене — осмотреться'
      : `Рост 1,70 м · WASD — идти · Shift — быстрее · ${locked() ? 'Мышь — взгляд' : 'Клик по сцене — обзор мышью'} · O — настройки · Esc — выход`;
  };
  const clear = () => { keys.clear(); touchKeys.clear(); drag = null; lastFrame = null; };
  const look = (dx, dy) => {
    cam.yaw -= dx * 0.0025 * sensitivity;
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.0025 * sensitivity));
    walkCamera(cam, player);
    repaint();
  };
  const lock = () => {
    try { canvas.requestPointerLock?.()?.catch(() => {}); } catch { /* Перетаскивание работает и без Pointer Lock. */ }
  };
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Escape' && settings.open) {
      e.preventDefault(); e.stopImmediatePropagation(); settings.open = false; canvas.focus({ preventScroll: true }); return;
    }
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); exit(); return; }
    if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopImmediatePropagation(); clear(); settings.open = !settings.open;
      if (settings.open) sensitivityInput.focus(); else canvas.focus({ preventScroll: true });
      return;
    }
    if (settings.open || e.target.closest?.('#v3WalkSettings')) { e.stopImmediatePropagation(); return; }
    // Tab и активация кнопки выхода остаются доступными с клавиатуры.
    if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space') { e.stopImmediatePropagation(); return; }
    if (MOVE.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopImmediatePropagation(); keys.add(e.code); paused = false; repaint(); return;
    }
    // Включая Undo/Delete и команды размещения под окном 3D.
    e.stopImmediatePropagation();
    if (!e.ctrlKey && !e.metaKey || ['KeyZ', 'KeyY', 'KeyD', 'KeyS'].includes(e.code)) e.preventDefault();
  }, true);
  settings.addEventListener('toggle', () => {
    if (!active || !settings.open) return;
    clear();
    if (locked()) { hadLock = false; document.exitPointerLock(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (active && settings.open && !settings.contains(e.target)) settings.open = false;
  });
  window.addEventListener('keyup', (e) => {
    if (!active) return;
    keys.delete(e.code);
    if (MOVE.has(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => { if (active) { clear(); paused = true; } });
  window.addEventListener('focus', () => { if (active) { paused = false; lastFrame = null; repaint(); } });
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    clear(); paused = document.hidden; if (!paused) repaint();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!active) return;
    if (locked()) { hadLock = true; drag = null; }
    else if (hadLock && !settings.open) { exit(); return; }
    updateHelp();
  });
  document.addEventListener('mousemove', (e) => { if (active && locked()) look(e.movementX, e.movementY); });
  canvas.addEventListener('pointerdown', (e) => {
    if (!active || e.button !== 0) return;
    e.preventDefault(); paused = false;
    canvas.focus({ preventScroll: true });
    if (!locked()) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'mouse') lock();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || locked() || drag?.id !== e.pointerId) return;
    look(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = (e) => { if (drag?.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  for (const button of document.querySelectorAll('[data-walk-key]')) {
    button.addEventListener('pointerdown', (e) => {
      if (!active) return;
      e.preventDefault(); button.setPointerCapture(e.pointerId);
      touchKeys.set(e.pointerId, button.dataset.walkKey); paused = false; repaint();
    });
    const release = (e) => touchKeys.delete(e.pointerId);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }
  return {
    get active() { return active; },
    start(scene, start) {
      world = scene; player = start; active = true; hadLock = false; paused = false; clear();
      settings.open = false;
      cam.pitch = 0; cam.yaw = start.yaw ?? cam.yaw;
      walkCamera(cam, player);
      document.body.classList.add('v3-walking');
      for (const element of document.querySelectorAll('#toolStrip, .library, #propsPanel, #projectRoute, .level-dock, #selectionToolbar, #mobileCat, .topbar')) {
        inertBefore.set(element, element.inert); element.inert = true;
      }
      document.getElementById('v3WalkHud').hidden = false;
      const button = document.getElementById('v3Walk');
      button.textContent = 'Выйти из прогулки'; button.setAttribute('aria-pressed', 'true');
      updateHelp(); canvas.focus({ preventScroll: true }); repaint();
    },
    stop() {
      if (!active) return;
      active = false; clear();
      settings.open = false;
      if (locked()) document.exitPointerLock();
      document.body.classList.remove('v3-walking');
      for (const [element, inert] of inertBefore) element.inert = inert;
      inertBefore.clear();
      document.getElementById('v3WalkHud').hidden = true;
      const button = document.getElementById('v3Walk');
      button.textContent = 'Прогулка'; button.setAttribute('aria-pressed', 'false');
    },
    scene(scene) { world = scene; },
    frame(now) {
      if (!active || paused) return;
      const dt = Math.max(0, Math.min(0.05, lastFrame == null ? 0 : (now - lastFrame) / 1000));
      lastFrame = now;
      const held = new Set([...keys, ...touchKeys.values()]);
      const forward = Number(held.has('KeyW') || held.has('ArrowUp')) - Number(held.has('KeyS') || held.has('ArrowDown'));
      const right = Number(held.has('KeyD') || held.has('ArrowRight')) - Number(held.has('KeyA') || held.has('ArrowLeft'));
      const direction = walkDirection(cam.yaw, forward, right);
      const speed = held.has('ShiftLeft') || held.has('ShiftRight') ? 2800 : 1400;
      const falling = stepWalk(world, player, direction.x * speed * dt, direction.y * speed * dt, dt);
      const smoothing = smoothWalkHeight(player, dt);
      walkCamera(cam, player);
      if (forward || right || falling || smoothing) repaint();
      else lastFrame = null;
    },
    debug() { return active ? { ...player, height: WALK_HEIGHT, eyeHeight: 1600, sensitivity, locked: locked(), paused } : null; },
  };
}
