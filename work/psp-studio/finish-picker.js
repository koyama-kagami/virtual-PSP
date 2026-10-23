import { getFinishes, getFinish } from './finishes.js';

export function mountFinishPicker() {
  const host = document.querySelector('.finishes');
  const trigger = document.querySelector('#finish-toggle');
  const panel = document.querySelector('#finish-panel');
  const groups = document.querySelector('#finish-groups');
  let modelId = '3000';
  let radios = [];
  function setOpen(open, focus = false) {
    panel.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      const help = document.querySelector('#help-panel');
      help.hidden = true; document.querySelector('#help').setAttribute('aria-expanded', 'false');
      if (focus) radios.find(button => button.getAttribute('aria-checked') === 'true')?.focus();
    } else if (focus) trigger.focus();
  }

  function update(finish, announce = true) {
    document.querySelector('#finish-current-chip').style.background = finish.swatch;
    document.querySelector('#finish-current-name').textContent = finish.name;
    trigger.setAttribute('aria-label', `机身配色：${finish.name}`);
    trigger.title = finish.english;
    for (const button of radios) {
      const selected = button.dataset.finish === finish.id;
      button.tabIndex = selected ? 0 : -1;
      button.setAttribute('aria-checked', String(selected));
      button.classList.toggle('selected', selected);
    }
    if (announce) document.querySelector('#finish-announcement').textContent = `PSP-${modelId}，已选择${finish.name}`;
  }

  function setModel(nextModelId, finishId = 'black') {
    const next = String(nextModelId);
    if (next !== modelId) setOpen(false);
    modelId = next;
    groups.replaceChildren();
    groups.setAttribute('aria-label', `PSP-${modelId} 配色`);
    const finishes = getFinishes(modelId);
    for (const groupName of [...new Set(finishes.map(finish => finish.group))]) {
      const section = document.createElement('div');
      section.className = 'finish-group';
      const heading = document.createElement('div');
      heading.className = 'finish-group-name'; heading.textContent = groupName;
      const grid = document.createElement('div'); grid.className = 'finish-grid';
      for (const finish of finishes.filter(finish => finish.group === groupName)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'finish-option';
        button.dataset.finish = finish.id; button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', finish.name); button.title = finish.english;
        const chip = document.createElement('span'); chip.className = 'finish-chip';
        chip.style.background = finish.swatch; chip.setAttribute('aria-hidden', 'true');
        const caption = document.createElement('span'); caption.className = 'finish-caption';
        caption.textContent = finish.name;
        button.append(chip, caption); grid.append(button);
      }
      section.append(heading, grid); groups.append(section);
    }
    radios = [...groups.querySelectorAll('[data-finish]')];
    update(getFinish(finishId, modelId), false);
  }

  trigger.addEventListener('click', () => setOpen(panel.hidden, true));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault(); event.stopPropagation(); setOpen(false, true); return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); setOpen(true, true);
    }
  });
  document.querySelector('#close-finishes').addEventListener('click', () => setOpen(false, true));
  groups.addEventListener('click', event => {
    const button = event.target.closest('[data-finish]');
    if (button && groups.contains(button)) {
      document.dispatchEvent(new CustomEvent('psp-finish-select', { detail: { id: button.dataset.finish } }));
    }
  });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false, true); return; }
    const current = radios.indexOf(document.activeElement);
    if (current < 0) return;
    const offsets = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
    let next;
    if (event.key in offsets) next = (current + offsets[event.key] + radios.length) % radios.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    if (next !== undefined) {
      event.preventDefault(); radios[next].focus(); radios[next].click();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!host.contains(event.target)) setOpen(false);
  });
  host.addEventListener('focusout', event => {
    if (event.relatedTarget && !host.contains(event.relatedTarget)) setOpen(false);
  });
  document.addEventListener('psp-finish-change', event => {
    const nextModel = String(event.detail.modelId || modelId);
    if (nextModel !== modelId) setModel(nextModel, event.detail.id);
    update(getFinish(event.detail.id, modelId));
  });
  setModel(modelId);
  return { setModel };
}
