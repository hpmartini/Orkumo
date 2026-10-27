// Valid shape, but register() throws after touching the router.
export default {
  id: 'broken-register',
  name: 'Broken Register',
  register({ router }) {
    router.get('/', (_req, res) => res.json({ ok: true }));
    throw new Error('broken-register fixture');
  },
};
