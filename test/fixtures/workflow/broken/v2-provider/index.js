/** Speaks a contract version the host does not know: conformance and loader must refuse it */
export default {
  id: 'v2-provider',
  name: 'V2',
  workflow: { apiVersion: 2, name: 'V2', stages: [{ id: 'a', label: 'A' }], annotate: () => null },
  register() {},
};
