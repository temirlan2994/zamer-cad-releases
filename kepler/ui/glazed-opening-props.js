import { glazedAssemblySpec, glazedOpeningParts } from '../core/glazed-openings.js';

export function glazedOpeningFields(opening, prefix) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return '';
  return `<label class="prop-field"><span>Ширина дверной части, мм</span>
      <input id="${prefix}DoorWidth" type="number" min="300" step="50" max="${spec.width - (spec.balcony ? 400 : 0)}" value="${Math.round(spec.doorWidth)}"></label>
    <label class="prop-field"><span>Расположение двери</span><select id="${prefix}DoorSide">
      <option value="start" ${spec.doorSide === 'start' ? 'selected' : ''}>Слева / в начале стены</option>
      <option value="end" ${spec.doorSide === 'end' ? 'selected' : ''}>Справа / в конце стены</option>
    </select></label>
    ${spec.balcony ? `<label class="prop-field"><span>Подоконник оконной части, мм</span>
      <input id="${prefix}WindowSill" type="number" min="0" step="50" max="${spec.height - 300}" value="${Math.round(spec.windowSill)}"></label>` : ''}`;
}

export function bindGlazedOpeningFields(panel, opening, prefix, save) {
  for (const [suffix, field] of [['DoorWidth', 'doorWidth'], ['DoorSide', 'doorSide'], ['WindowSill', 'windowSill']]) {
    panel.querySelector(`#${prefix}${suffix}`)?.addEventListener('change', (event) => {
      const value = field === 'doorSide' ? event.target.value : Number(event.target.value);
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      save({ assembly: { ...opening.assembly, [field]: value } });
    });
  }
}

export function glazedElevationMarkup(opening, ox, oy, sw) {
  return glazedOpeningParts({ ...opening, host: undefined, offset: 0 }).map((part) => {
    const x = ox + opening.width / 2 + part.offset - part.width / 2;
    const y = oy + opening.height - part.sill - part.height;
    const cy = y + part.height / 2;
    const mark = part.kind !== 'door' ? '' : part.type === 'sliding'
      ? `<path d="M ${x + part.width * .2} ${cy} H ${x + part.width * .8} l ${-sw * 3} ${-sw * 2} m ${sw * 3} ${sw * 2} l ${-sw * 3} ${sw * 2}" class="elev-dim" fill="none"/>`
      : `<path d="M ${x} ${y} L ${x + part.width} ${cy} L ${x} ${y + part.height}" class="elev-dim" fill="none" stroke-dasharray="${sw * 3}"/>`;
    return `<rect x="${x}" y="${y}" width="${part.width}" height="${part.height}" class="elev-glass"/>${mark}`;
  }).join('');
}
