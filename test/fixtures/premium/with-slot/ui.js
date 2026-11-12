// One control high, inline: names the instance the AgentsView talks to (docs/MODULES.md, "Agent target").
export function mount(el, host) {
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;opacity:.7;white-space:nowrap';
  el.append(label);
  const render = (h) => (label.textContent = h.agentTarget || 'this machine');
  render(host);
  return { update: render, unmount: () => label.remove() };
}
