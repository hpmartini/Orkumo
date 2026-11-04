// Module with its own work mode at /with-mode (docs/MODULES.md, "Modes").
export default {
  id: 'with-mode',
  name: 'With Mode',
  ui: './ui.js',
  mode: { label: 'Fixture Mode', icon: 'Boxes', keywords: 'fixture demo', scoped: true },
  register({ router }) {
    router.get('/', (_req, res) => res.json({ id: 'with-mode' }));
  },
};
