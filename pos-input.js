(() => {
  const shortcuts = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.'];
  const attached = new WeakMap();

  // All sense forms can attach this same component to a free-text input.
  function attach(input) {
    if (attached.has(input)) return attached.get(input);
    let selectedByShortcut = null;
    const group = document.createElement('div');
    group.className = 'pos-shortcuts';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '常用词性快捷输入');
    const buttons = shortcuts.map(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = value;
      button.setAttribute('aria-controls', input.id);
      button.addEventListener('click', () => {
        // Only toggle off an unchanged value inserted by this component.
        const toggleOff = selectedByShortcut === value && input.value === value;
        input.value = toggleOff ? '' : value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        selectedByShortcut = toggleOff ? null : value;
        sync();
      });
      group.append(button);
      return button;
    });
    function sync() {
      buttons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(input.value === shortcuts[index]));
      });
    }
    input.addEventListener('input', () => { selectedByShortcut = null; sync(); });
    input.addEventListener('change', () => { selectedByShortcut = null; sync(); });
    input.form?.addEventListener('reset', () => {
      selectedByShortcut = null;
      // The native reset updates input values after the reset event.
      queueMicrotask(sync);
    });
    input.after(group);
    sync();
    const component = { sync };
    attached.set(input, component);
    return component;
  }
  window.WordlogPosInput = { attach };
  document.querySelectorAll('[data-pos-shortcuts]').forEach(attach);
})();
