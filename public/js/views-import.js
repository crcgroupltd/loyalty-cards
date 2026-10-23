// Bulk import: screenshots (e.g. from Klarna) or a Catima export. Both
// produce rows the user reviews before anything is saved.
import { FORMATS, validate } from '../formats.js';
import { h, clear, toast } from './dom.js';
import { decodeImage } from './scan.js';
import { api, navigate, refreshCards, state } from './state.js';
import { offlineBanner, topBar, typeSelect } from './views-cards.js';

export function importView() {
  if (state.offline) return h('section', null, topBar('Import', { back: '#/' }), offlineBanner());
  const body = h('div', { class: 'stack' });

  const shots = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    const files = [...shots.files];
    shots.value = '';
    if (files.length) await readScreenshots(files, body);
  } });
  const catima = h('input', { type: 'file', accept: '.zip,.csv,application/zip,text/csv', hidden: true, onchange: async () => {
    const file = catima.files[0];
    catima.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { cards } = await api('POST', '/api/import/catima', fd);
      review(body, cards.map((c) => ({ ...c, include: !c.error || Boolean(c.barcode_type) })));
    } catch (e) {
      toast(e.message, 'error');
    }
  } });

  clear(body).append(
    h('div', { class: 'panel stack' },
      h('h2', null, 'Screenshots'),
      h('p', { class: 'muted' }, 'In Klarna, open each card and take a screenshot. Then pick them all here. Each barcode is read on this phone.'),
      h('button', { class: 'btn btn-primary', onclick: () => shots.click() }, 'Choose screenshots'), shots),
    h('div', { class: 'panel stack' },
      h('h2', null, 'Catima export'),
      h('p', { class: 'muted' }, 'In Catima: Settings → Export. Leave the password empty. Pick the .zip here.'),
      h('button', { class: 'btn', onclick: () => catima.click() }, 'Choose Catima export'), catima),
  );
  return h('section', null, topBar('Import cards', { back: '#/' }), body);
}

async function readScreenshots(files, body) {
  const progress = h('p', { class: 'muted center' });
  clear(body).append(progress);
  const rows = [];
  for (const [i, file] of files.entries()) {
    progress.textContent = `Reading ${i + 1} of ${files.length}…`;
    const found = await decodeImage(file).catch(() => null);
    rows.push({
      thumb: URL.createObjectURL(file),
      name: '',
      card_number: '',
      barcode_type: found?.type ?? '',
      barcode_value: found?.value ?? '',
      notes: '',
      include: Boolean(found),
      error: found ? undefined : 'No barcode found. Enter it by hand or untick.',
    });
  }
  review(body, rows);
}

function review(body, rows) {
  const list = h('div', { class: 'review' });
  const autoLogos = state.status?.logos ? h('input', { type: 'checkbox', checked: true }) : null;
  const save = h('button', { class: 'btn btn-primary' });
  const status = h('p', { class: 'form-error', role: 'alert' });

  const problems = (r) => {
    if (!r.name.trim()) return 'Needs a name';
    return validate(r.barcode_type, r.barcode_value);
  };
  const refresh = () => {
    const included = rows.filter((r) => r.include);
    const bad = included.filter(problems).length;
    save.textContent = `Add ${included.length} card${included.length === 1 ? '' : 's'}`;
    save.disabled = included.length === 0 || bad > 0;
    status.textContent = bad ? `${bad} card${bad === 1 ? ' needs' : 's need'} fixing (or untick them)` : '';
  };

  for (const r of rows) {
    const msg = h('small', { class: 'review-msg' });
    const check = () => {
      const p = r.include ? problems(r) : null;
      const valid = r.barcode_type && !validate(r.barcode_type, r.barcode_value);
      msg.textContent = p ?? (valid ? `${FORMATS[r.barcode_type].label} ✓` : r.error ?? '');
      msg.classList.toggle('is-error', Boolean(p || (!valid && r.error)));
      refresh();
    };
    const row = h('div', { class: 'review-row' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.include, onchange: (e) => { r.include = e.target.checked; row.classList.toggle('is-off', !r.include); check(); } })),
      r.thumb && h('img', { src: r.thumb, alt: '', class: 'review-thumb' }),
      h('div', { class: 'stack-tight grow' },
        h('input', { placeholder: 'Store name', value: r.name, maxlength: '60', 'aria-label': 'Store name', oninput: (e) => { r.name = e.target.value; check(); } }),
        typeSelect(r.barcode_type, (e) => { r.barcode_type = e.target.value; check(); }),
        h('input', { placeholder: 'Barcode value', value: r.barcode_value, 'aria-label': 'Barcode value', autocapitalize: 'none', spellcheck: 'false', oninput: (e) => { r.barcode_value = e.target.value; check(); } }),
        msg),
    );
    row.classList.toggle('is-off', !r.include);
    list.append(row);
    check();
  }

  save.onclick = async () => {
    const included = rows.filter((r) => r.include);
    save.disabled = true;
    try {
      const { ids } = await api('POST', '/api/cards/batch', {
        cards: included.map(({ name, card_number, barcode_type, barcode_value, color, notes }) => ({ name, card_number, barcode_type, barcode_value, color, notes })),
      });
      if (autoLogos?.checked) {
        for (const [i, id] of ids.entries()) {
          status.textContent = `Finding logos ${i + 1} of ${ids.length}…`;
          try {
            const { results } = await api('GET', `/api/logos/search?q=${encodeURIComponent(included[i].name)}`);
            if (results[0]) await api('PUT', `/api/cards/${id}/logo`, { file: results[0].file, domain: results[0].domain });
          } catch {}
        }
      }
      rows.forEach((r) => r.thumb && URL.revokeObjectURL(r.thumb));
      await refreshCards();
      toast(`Added ${ids.length} cards`);
      navigate('#/');
    } catch (e) {
      status.textContent = e.body?.errors ? e.body.errors.map((x) => x.error).join('; ') : e.message;
      save.disabled = false;
    }
  };

  clear(body).append(
    h('p', { class: 'muted' }, 'Check each card, give it a name, then add them.'),
    list,
    autoLogos && h('label', { class: 'check' }, autoLogos, 'Find logos automatically (best match)'),
    status,
    save,
  );
  refresh();
}
