// One control high, inline: names the instance the AgentsView talks to (docs/MODULES.md, "Agent target").
export function mount(el, host) {
  const render = (h) => (el.textContent = h.agentTarget || 'this machine');
  render(host);
  return {
    update: render,
    unmount() {
      el.textContent = '';
    },
  };
}
