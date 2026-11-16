// Renders the real ChatPane with the server and terminal swapped for mocks (see main.tsx)
import { fileURLToPath } from 'url';
const mock = (name) => fileURLToPath(new URL(`./mocks/${name}`, import.meta.url));
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^.*\/services\/agentsApi$/, replacement: mock('agentsApi.ts') },
      { find: /^.*\/AgentTerminal$/, replacement: mock('AgentTerminal.ts') },
    ],
  },
};
