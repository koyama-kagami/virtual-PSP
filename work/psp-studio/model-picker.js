const MODEL_IDS = ['1000', '2000', '3000'];

export function mountModelPicker(onSelect) {
  const picker = document.querySelector('.model-picker');
  const radios = [...picker.querySelectorAll('[data-model]')];
  let current = '3000';

  function update(modelId) {
    current = MODEL_IDS.includes(String(modelId)) ? String(modelId) : '3000';
    for (const radio of radios) {
      const selected = radio.dataset.model === current;
      radio.setAttribute('aria-checked', String(selected));
      radio.classList.toggle('selected', selected);
      radio.tabIndex = selected ? 0 : -1;
    }
    document.querySelector('meta[name="description"]').content = `PSP-${current} 交互式三维模型。`;
    document.querySelector('#viewport').setAttribute('aria-label', `交互式 PSP-${current} 三维模型。拖动机身旋转，拖动摇杆搓动，点击背面 UMD 仓盖开合。滚轮缩放，P 短按开机或待机，长按关机。`);
  }

  picker.addEventListener('click', event => {
    const radio = event.target.closest('[data-model]');
    if (radio && picker.contains(radio)) onSelect(radio.dataset.model);
  });
  picker.addEventListener('keydown', event => {
    // Keep model navigation separate from the PSP screen's arrow-key controls.
    event.stopPropagation();
    const index = radios.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % radios.length;
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index - 1 + radios.length) % radios.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    if (next !== undefined) {
      event.preventDefault(); radios[next].focus(); radios[next].click();
    }
  });
  update(current);
  return { update };
}
