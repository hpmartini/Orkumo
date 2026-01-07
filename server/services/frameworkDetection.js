/**
 * Framework Detection Service
 *
 * Detects the framework used by a project and determines:
 * - Which file to inject the logger script into
 * - The correct injection template for that framework
 * - Whether the project is compatible with DevOrbit logger
 */

import fs from 'fs';
import path from 'path';

/**
 * Framework definitions with detection patterns and injection info
 */
const FRAMEWORKS = {
  nextjs: {
    name: 'Next.js',
    detect: (pkg) => pkg.dependencies?.next || pkg.devDependencies?.next,
    // Next.js has two possible router types
    getInjectionFile: async (projectPath) => {
      // App Router (Next.js 13+)
      const appLayoutPath = path.join(projectPath, 'app', 'layout.tsx');
      const appLayoutJsPath = path.join(projectPath, 'app', 'layout.js');
      const srcAppLayoutPath = path.join(projectPath, 'src', 'app', 'layout.tsx');
      const srcAppLayoutJsPath = path.join(projectPath, 'src', 'app', 'layout.js');

      // Pages Router
      const pagesDocumentPath = path.join(projectPath, 'pages', '_document.tsx');
      const pagesDocumentJsPath = path.join(projectPath, 'pages', '_document.js');
      const srcPagesDocumentPath = path.join(projectPath, 'src', 'pages', '_document.tsx');
      const srcPagesDocumentJsPath = path.join(projectPath, 'src', 'pages', '_document.js');

      // Check App Router first (preferred)
      if (fs.existsSync(appLayoutPath)) return { file: appLayoutPath, router: 'app', ext: 'tsx' };
      if (fs.existsSync(appLayoutJsPath)) return { file: appLayoutJsPath, router: 'app', ext: 'js' };
      if (fs.existsSync(srcAppLayoutPath)) return { file: srcAppLayoutPath, router: 'app', ext: 'tsx' };
      if (fs.existsSync(srcAppLayoutJsPath)) return { file: srcAppLayoutJsPath, router: 'app', ext: 'js' };

      // Check Pages Router
      if (fs.existsSync(pagesDocumentPath)) return { file: pagesDocumentPath, router: 'pages', ext: 'tsx' };
      if (fs.existsSync(pagesDocumentJsPath)) return { file: pagesDocumentJsPath, router: 'pages', ext: 'js' };
      if (fs.existsSync(srcPagesDocumentPath)) return { file: srcPagesDocumentPath, router: 'pages', ext: 'tsx' };
      if (fs.existsSync(srcPagesDocumentJsPath)) return { file: srcPagesDocumentJsPath, router: 'pages', ext: 'js' };

      // Fallback: Check for index.html (rare but possible)
      const publicIndexPath = path.join(projectPath, 'public', 'index.html');
      if (fs.existsSync(publicIndexPath)) return { file: publicIndexPath, router: 'static', ext: 'html' };

      return null;
    },
    injectionType: 'nextjs',
  },

  vite: {
    name: 'Vite',
    detect: (pkg) => pkg.devDependencies?.vite || pkg.dependencies?.vite,
    getInjectionFile: async (projectPath) => {
      const indexPath = path.join(projectPath, 'index.html');
      if (fs.existsSync(indexPath)) return { file: indexPath, ext: 'html' };
      return null;
    },
    injectionType: 'html',
  },

  angular: {
    name: 'Angular',
    detect: (pkg) => pkg.dependencies?.['@angular/core'],
    getInjectionFile: async (projectPath) => {
      const srcIndexPath = path.join(projectPath, 'src', 'index.html');
      if (fs.existsSync(srcIndexPath)) return { file: srcIndexPath, ext: 'html' };
      return null;
    },
    injectionType: 'html',
  },

  sveltekit: {
    name: 'SvelteKit',
    detect: (pkg) => pkg.devDependencies?.['@sveltejs/kit'] || pkg.dependencies?.['@sveltejs/kit'],
    getInjectionFile: async (projectPath) => {
      const appHtmlPath = path.join(projectPath, 'src', 'app.html');
      if (fs.existsSync(appHtmlPath)) return { file: appHtmlPath, ext: 'html' };
      return null;
    },
    injectionType: 'sveltekit',
  },

  svelte: {
    name: 'Svelte',
    detect: (pkg) => pkg.devDependencies?.svelte || pkg.dependencies?.svelte,
    getInjectionFile: async (projectPath) => {
      // Svelte with Vite uses index.html
      const indexPath = path.join(projectPath, 'index.html');
      if (fs.existsSync(indexPath)) return { file: indexPath, ext: 'html' };
      // Svelte with Rollup uses public/index.html
      const publicIndexPath = path.join(projectPath, 'public', 'index.html');
      if (fs.existsSync(publicIndexPath)) return { file: publicIndexPath, ext: 'html' };
      return null;
    },
    injectionType: 'html',
  },

  vue: {
    name: 'Vue',
    detect: (pkg) => pkg.dependencies?.vue,
    getInjectionFile: async (projectPath) => {
      // Vue CLI uses public/index.html
      const publicIndexPath = path.join(projectPath, 'public', 'index.html');
      if (fs.existsSync(publicIndexPath)) return { file: publicIndexPath, ext: 'html' };
      // Vite-based Vue uses index.html in root
      const indexPath = path.join(projectPath, 'index.html');
      if (fs.existsSync(indexPath)) return { file: indexPath, ext: 'html' };
      return null;
    },
    injectionType: 'html',
  },

  nuxt: {
    name: 'Nuxt',
    detect: (pkg) => pkg.dependencies?.nuxt || pkg.devDependencies?.nuxt,
    getInjectionFile: async (projectPath) => {
      // Nuxt 3 uses app.vue or a plugin
      const appVuePath = path.join(projectPath, 'app.vue');
      if (fs.existsSync(appVuePath)) return { file: appVuePath, ext: 'vue', usePlugin: true };
      return null;
    },
    injectionType: 'nuxt',
  },

  cra: {
    name: 'Create React App',
    detect: (pkg) => pkg.dependencies?.['react-scripts'],
    getInjectionFile: async (projectPath) => {
      const publicIndexPath = path.join(projectPath, 'public', 'index.html');
      if (fs.existsSync(publicIndexPath)) return { file: publicIndexPath, ext: 'html' };
      return null;
    },
    injectionType: 'html',
  },

  // Generic fallback for any project with index.html
  generic: {
    name: 'Generic',
    detect: () => true, // Always matches as fallback
    getInjectionFile: async (projectPath) => {
      const paths = [
        path.join(projectPath, 'index.html'),
        path.join(projectPath, 'public', 'index.html'),
        path.join(projectPath, 'src', 'index.html'),
      ];
      for (const p of paths) {
        if (fs.existsSync(p)) return { file: p, ext: 'html' };
      }
      return null;
    },
    injectionType: 'html',
  },
};

/**
 * Detection order matters - more specific frameworks first
 */
const DETECTION_ORDER = [
  'nextjs',
  'nuxt',
  'sveltekit',
  'angular',
  'cra',
  'vite',
  'vue',
  'svelte',
  'generic',
];

/**
 * Detect the framework used by a project
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<{framework: string, name: string, injectionFile: object|null, injectionType: string}|null>}
 */
export async function detectFramework(projectPath) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      console.log(`[FrameworkDetection] No package.json found in ${projectPath}`);
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    for (const frameworkKey of DETECTION_ORDER) {
      const framework = FRAMEWORKS[frameworkKey];

      if (framework.detect(packageJson)) {
        const injectionFile = await framework.getInjectionFile(projectPath);

        if (injectionFile) {
          console.log(`[FrameworkDetection] Detected ${framework.name} in ${projectPath}`);
          return {
            framework: frameworkKey,
            name: framework.name,
            injectionFile,
            injectionType: framework.injectionType,
          };
        }
      }
    }

    console.log(`[FrameworkDetection] No compatible framework detected in ${projectPath}`);
    return null;
  } catch (error) {
    console.error(`[FrameworkDetection] Error detecting framework:`, error);
    return null;
  }
}

/**
 * Check if a project already has the DevOrbit logger injected
 * @param {string} filePath - Path to the file to check
 * @returns {boolean}
 */
export function hasLoggerInjected(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes('DEVORBIT_LOGGER') || content.includes('devorbit-console');
  } catch (error) {
    console.error(`[FrameworkDetection] Error checking for logger:`, error);
    return false;
  }
}

export { FRAMEWORKS };
