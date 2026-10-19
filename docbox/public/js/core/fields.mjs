import { esc } from './dom.mjs';

function optionHtml(options, value) {
  return (options || []).map((opt) => {
    const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
    return '<option value="' + esc(val) + '"' + (String(val) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
}

/**
 * 通用字段渲染：text / number / range / select / checkbox / color / textarea / date / time
 */
export function renderFields(container, fields, values = {}) {
  container.innerHTML = fields.map((f) => {
    const value = values[f.name] !== undefined ? values[f.name] : (f.value ?? '');
    const id = 'fld-' + f.name;
    if (f.type === 'checkbox') {
      const checked = values[f.name] !== undefined ? Boolean(values[f.name]) : f.checked !== false;
      return `<label class="field field-check"><input type="checkbox" id="${id}" data-field="${f.name}" ${checked ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
    }
    if (f.type === 'select') {
      return `<label class="field"><span>${esc(f.label)}</span><select id="${id}" data-field="${f.name}">${optionHtml(f.options, value)}</select></label>`;
    }
    if (f.type === 'range') {
      return `<label class="field"><span>${esc(f.label)}<b data-range-label="${f.name}">${esc(value)}${esc(f.suffix || '')}</b></span>
        <input type="range" id="${id}" data-field="${f.name}" min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}" value="${esc(value)}"></label>`;
    }
    if (f.type === 'textarea') {
      return `<label class="field"><span>${esc(f.label)}</span><textarea id="${id}" data-field="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea></label>`;
    }
    if (f.type === 'color') {
      return `<label class="field"><span>${esc(f.label)}</span><input type="color" id="${id}" data-field="${f.name}" value="${esc(value || '#ffffff')}"></label>`;
    }
    const type = ['number', 'date', 'time'].includes(f.type) ? f.type : 'text';
    return `<label class="field"><span>${esc(f.label)}</span><input type="${type}" id="${id}" data-field="${f.name}" value="${esc(value)}" placeholder="${esc(f.placeholder || '')}" ${f.min !== undefined ? 'min="' + f.min + '"' : ''} ${f.max !== undefined ? 'max="' + f.max + '"' : ''}></label>`;
  }).join('');

  container.querySelectorAll('input[type=range]').forEach((input) => {
    input.addEventListener('input', () => {
      const label = container.querySelector('[data-range-label="' + input.dataset.field + '"]');
      const suffix = fields.find((f) => f.name === input.dataset.field)?.suffix || '';
      if (label) label.textContent = input.value + suffix;
    });
  });
}

export function readFields(container, fields) {
  const values = {};
  for (const f of fields) {
    const input = container.querySelector('[data-field="' + f.name + '"]');
    if (!input) continue;
    if (f.type === 'checkbox') values[f.name] = input.checked ? 'true' : '';
    else values[f.name] = input.value;
  }
  return values;
}
