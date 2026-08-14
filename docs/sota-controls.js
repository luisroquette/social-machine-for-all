const switchboard = document.querySelector('[data-switchboard]');
const stageTabs = [...document.querySelectorAll('[data-stage]')];
const stages = {
  safe: { label: 'SAFE START', enabled: ['discovery', 'review'], note: 'Start with source intake and human decisions. No provider or channel is enabled.' },
  draft: { label: 'DRAFTING READY', enabled: ['discovery', 'review', 'ai'], note: 'A reviewed AI provider can draft. Publishing and schedules remain off.' },
  live: { label: 'PUBLISHING APPROVED', enabled: ['discovery', 'review', 'ai', 'publishing', 'schedule'], note: 'Channels and schedules appear only after credentials, review flow and policy are approved.' },
};

const setStage = (name, focus = false) => {
  const stage = stages[name];
  if (!switchboard || !stage) return;
  switchboard.querySelector('[data-stage-label]').textContent = stage.label;
  switchboard.querySelector('[data-stage-note]').textContent = stage.note;
  switchboard.querySelectorAll('[data-feature]').forEach((toggle) => {
    const enabled = stage.enabled.includes(toggle.dataset.feature);
    toggle.classList.toggle('on', enabled);
    const status = switchboard.querySelector(`[data-feature-status="${toggle.dataset.feature}"]`);
    status.textContent = enabled ? 'ON' : 'OFF';
    status.classList.toggle('enabled', enabled);
  });
  stageTabs.forEach((tab) => {
    const active = tab.dataset.stage === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) {
      switchboard.querySelector('#stage-panel')?.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
    }
  });
};

stageTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setStage(tab.dataset.stage));
  tab.addEventListener('keydown', (event) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % stageTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + stageTabs.length) % stageTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stageTabs.length - 1;
    else return;
    event.preventDefault();
    setStage(stageTabs[next].dataset.stage, true);
  });
});

setStage('safe');
