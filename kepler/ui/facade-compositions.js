import { compositionWall, FACADE_COMPOSITIONS, layoutComposition, prepareComposition } from '../core/facade-compositions.js';
import { massBox } from '../core/masses.js';
import { boxFaces } from '../core/mesh3d.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject } from './tools.js';

export const composingFacade = () => state.tool?.kind === 'place-facade-composition';
export const compositionMenu = () => Object.entries(FACADE_COMPOSITIONS).map(([id, def]) =>
  '<button type="button" data-facade-composition="' + id + '">' + def.title + '</button>').join('');

export function facadeComposer({ pick, ray, hint, repaint, switchFloor }) {
  let session = null;
  let preview = [];
  const whole = document.createElement('button');
  whole.type = 'button';
  whole.textContent = 'Во всю стену';
  whole.className = 'v3-composition-fit';

  const current = () => composingFacade() && session?.tool === state.tool && session.project === state.project ? session : null;
  const title = () => FACADE_COMPOSITIONS[state.tool.compositionKind].title;
  const prompt = () => current() ? 'Укажите второй край' : title() + ' · Укажите первый край на наружной стене';
  function reset() { session = null; preview = []; }
  function wallAlong(event, host) {
    const r = ray(event);
    const axis = host.horizontal ? 'y' : 'x';
    if (Math.abs(r.d[axis]) < 0.000001) return null;
    const t = (host.across - r.o[axis]) / r.d[axis];
    if (t < 0) return null;
    const along = host.horizontal ? 'x' : 'y';
    return Math.max(host.from, Math.min(host.to, Math.round(r.o[along] + t * r.d[along])));
  }
  function move(event) {
    const s = current();
    if (!s) return;
    const along = wallAlong(event, s.host);
    const draft = layoutComposition(s.tool.compositionKind, s.host, s.first, along);
    preview = draft.error ? [] : draft.parts.concat(draft.glass || []);
    if (draft.width) hint('Ширина ' + draft.width + ' мм · Укажите второй край');
    else hint(draft.error);
    repaint();
  }
  function finish(first, last) {
    const s = current();
    if (!s) return;
    // Повторяем проверку стены в момент подтверждения: отмена или облачная
    // правка могли изменить помещение между касаниями.
    const host = compositionWall(state.project, s.host.level.id, s.host.room.id, s.host.side, (first + last) / 2);
    if (!host || Math.min(first, last) < host.from - 1 || Math.max(first, last) > host.to + 1) {
      reset(); hint('Стена изменилась. Выберите её ещё раз'); repaint(); return;
    }
    const result = prepareComposition(state.project, s.tool.compositionKind, host, first, last);
    if (result.error) { hint(result.error); return; }
    if (state.editLocked) return;
    if (result.levelId !== state.project.activeLevel) switchFloor(result.levelId);
    const applied = mutate(() => {
      if (result.opening) host.level.openings.push(result.opening);
      state.project.masses = [...(state.project.masses || []), ...result.masses];
    });
    if (!applied) return;
    reset();
    cancelTool();
    selectObject(result.opening ? { type: 'opening', id: result.opening.id } : { type: 'mass', id: result.masses[0].id });
    hint('Готово · Нажмите на деталь, чтобы изменить её');
    repaint();
  }
  whole.addEventListener('click', () => {
    const s = current();
    if (s) finish(s.host.from, s.host.to);
  });
  function click(event) {
    const s = current();
    if (s) {
      const along = wallAlong(event, s.host);
      if (along != null) finish(s.first, along);
      return;
    }
    reset();
    const hit = pick(event);
    if (!hit) { hint('Нажмите на наружную поверхность стены'); return; }
    const { box, along } = hit;
    const host = compositionWall(state.project, box.levelId, box.facadeRoom, box.facadeSide, along);
    if (!host) { hint('Выберите край на наружной стене помещения'); return; }
    if (host.to - host.from < FACADE_COMPOSITIONS[state.tool.compositionKind].minWidth) {
      hint('Этот участок слишком узкий. Выберите более длинную стену'); return;
    }
    session = { project: state.project, tool: state.tool, host, first: Math.max(host.from, Math.min(host.to, along)) };
    hint(prompt()); repaint();
  }
  function overlay() {
    const s = current();
    if (!s) return [];
    const { host, first } = s;
    const marker = { x: host.horizontal ? first : host.across, y: host.horizontal ? host.across : first,
      w: 36, d: 36, rotation: 0, z0: host.low, h: host.high - host.low };
    return [marker, ...preview].flatMap((m) => {
      const b = massBox(m);
      return boxFaces(b.x0, b.y0, b.x1, b.y1, b.z0, b.z1, '#69bd91', 'overlay')
        .map((f) => ({ ...f, alpha: 0.30, twoSided: true }));
    });
  }
  return { started: () => Boolean(current()), click, move, overlay, reset, prompt, showFit: (hintNode) => { if (current()) hintNode.append(whole); } };
}
