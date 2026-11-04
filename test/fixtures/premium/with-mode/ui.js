// Writes whether the mode is visible into its element, so a test can follow host updates.
export function mount(el, host) {
  const render = (h) => (el.textContent = `active=${h.active}`);
  render(host);
  return {
    update: render,
    unmount() {
      el.textContent = '';
    },
  };
}
