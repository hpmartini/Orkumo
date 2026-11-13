/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_PORT?: string;
  readonly VITE_CODE_SERVER_URL?: string;
  readonly VITE_CODE_SERVER_TIMEOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json version at build time (vite.config.ts `define`) */
declare const __APP_VERSION__: string;
