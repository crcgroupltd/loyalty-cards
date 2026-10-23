// Tiny DOM builder. Text is always set as text, never parsed as HTML.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // setProperty also handles CSS custom properties like --card-color.
      for (const [prop, val] of Object.entries(v)) el.style.setProperty(prop, val);
    }
    else if (typeof v === 'boolean') {
      if (k in el) el[k] = v;
      else el.setAttribute(k, '');
    }
    else el.setAttribute(k, v);
  }
  append(el, children);
  // Set after children so a <select> already has its options.
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Shows a short message at the bottom of the screen.
export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('toast-hide'), 2600);
  setTimeout(() => el.remove(), 3200);
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('small', { class: 'hint' }, hint));
}

export function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}
