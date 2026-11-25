import { glazedAssemblySpec, glazedOpeningParts, setGlazedPartSize, setGlazedWindow } from '../core/glazed-openings.js';

export function glazedOpeningFields(opening, prefix) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return '';
  return `<div class="prop-grid"><label class="prop-field"><span>Ширина двери, мм</span>
      <input id="${prefix}DoorWidth" type="number" min="300" step="50" value="${Math.round(spec.doorWidth)}"></label>
      <label class="prop-field"><span>Высота двери, мм</span>
      <input id="${prefix}DoorHeight" type="number" min="300" step="50" value="${Math.round(spec.doorHeight)}"></label></div>
    ${['left', 'right'].map((side) => {
      const label = side === 'left' ? 'слева' : 'справа';
      const suffix = side === 'left' ? 'Left' : 'Right';
      return `<label class="check-row"><input id="${prefix}Window${suffix}" type="checkbox" ${spec[`${side}Window`] ? 'checked' : ''}>
        <span>Окно ${label}</span></label>
        ${spec[`${side}Window`] ? `<div class="prop-grid"><label class="prop-field"><span>Ширина окна ${label}, мм</span>
          <input id="${prefix}WindowWidth${suffix}" type="number" min="300" step="50" value="${Math.round(spec[`${side}Width`])}"></label>
          <label class="prop-field"><span>Высота окна ${label}, мм</span>
          <input id="${prefix}WindowHeight${suffix}" type="number" min="300" step="50" value="${Math.round(spec[`${side}Height`])}"></label></div>` : ''}`;
    }).join('')}
    ${spec.balcony ? `<label class="prop-field"><span>Подоконник оконной части, мм</span>
      <input id="${prefix}WindowSill" type="number" min="0" step="50" value="${Math.round(spec.windowSill)}"></label>` : ''}`;
}

export function bindGlazedOpeningFields(panel, opening, prefix, save) {
  for (const side of ['left', 'right']) {
    const suffix = side === 'left' ? 'Left' : 'Right';
    panel.querySelector(`#${prefix}Window${suffix}`)?.addEventListener('change', (event) => {
      save(setGlazedWindow(opening, side, event.target.checked));
    });
    for (const dimension of ['Width', 'Height']) panel.querySelector(`#${prefix}Window${dimension}${suffix}`)?.addEventListener('change', (event) => {
      const next = setGlazedPartSize(opening, side, dimension.toLowerCase(), event.target.value);
      if (next) save(next);
    });
  }
  for (const suffix of ['DoorWidth', 'DoorHeight', 'WindowSill']) {
    panel.querySelector(`#${prefix}${suffix}`)?.addEventListener('change', (event) => {
      const value = Number(event.target.value);
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      const next = suffix === 'WindowSill' ? setGlazedPartSize(opening, 'windows', 'sill', value)
        : setGlazedPartSize(opening, 'door', suffix === 'DoorWidth' ? 'width' : 'height', value);
      if (next) save(next);
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
