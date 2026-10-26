// Empty placeholder module: registers only itself.
export default {
  id: 'premium-placeholder',
  name: 'Premium Placeholder',
  register({ router }) {
    router.get('/', (_req, res) => res.json({ id: 'premium-placeholder' }));
  },
};
