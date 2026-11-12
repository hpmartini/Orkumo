// Module with a UI in the agents header (docs/MODULES.md, "Slots").
export default {
  id: 'with-slot',
  name: 'With Slot',
  ui: './ui.js',
  slot: 'agents-rail',
  register({ router }) {
    router.get('/', (_req, res) => res.json({ id: 'with-slot' }));
  },
};
