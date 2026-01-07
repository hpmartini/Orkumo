/**
 * Logger Injection Service
 *
 * Handles injecting and removing the DevOrbit logger script
 * into various framework entry files.
 *
 * SAFETY FEATURES:
 * - Creates backup before modifying files
 * - Uses unique markers for easy removal
 * - Framework-specific injection patterns
 * - Production-safe: script only runs in iframe on localhost
 */

import fs from 'fs';
import path from 'path';
import { detectFramework, hasLoggerInjected } from './frameworkDetection.js';

// Markers to identify injected code
const START_MARKER = '<!-- DEVORBIT_LOGGER_START -->';
const END_MARKER = '<!-- DEVORBIT_LOGGER_END -->';
const JS_START_MARKER = '/* DEVORBIT_LOGGER_START */';
const JS_END_MARKER = '/* DEVORBIT_LOGGER_END */';

/**
 * The inline logger script that gets injected
 * This is a minified version that only runs in iframe on localhost
 */
const INLINE_LOGGER_SCRIPT = `
(function(){
  'use strict';
  if(window.__DEVORBIT_LOGGER__)return;
  if(window.self===window.top)return;
  var h=window.location.hostname;
  if(h!=='localhost'&&h!=='127.0.0.1')return;
  window.__DEVORBIT_LOGGER__=true;
  var o='*',c={log:console.log,warn:console.warn,error:console.error,info:console.info,debug:console.debug};
  function s(a){return Array.prototype.map.call(a,function(v){try{if(v instanceof Error)return{type:'error',message:v.message,stack:v.stack};if(v===undefined)return'undefined';if(v===null)return'null';if(typeof v==='function')return'[Function]';if(typeof v==='object')try{return JSON.stringify(v,null,2)}catch(e){return'[Object]'}return String(v)}catch(e){return'[Error]'}})}
  function p(d){try{window.parent.postMessage(d,o)}catch(e){}}
  ['log','warn','error','info','debug'].forEach(function(m){console[m]=function(){p({type:'devorbit-console',method:m,args:s(arguments),timestamp:Date.now(),url:window.location.href});return c[m].apply(console,arguments)}});
  window.addEventListener('error',function(e){p({type:'devorbit-console',method:'error',args:s([e.error||e.message]),timestamp:Date.now(),url:window.location.href,uncaught:true})});
  window.addEventListener('unhandledrejection',function(e){p({type:'devorbit-console',method:'error',args:s(['Unhandled Promise Rejection:',e.reason]),timestamp:Date.now(),url:window.location.href,uncaught:true})});
  var f=window.fetch;if(f)window.fetch=function(i,n){var t=Date.now(),m=(n&&n.method)||'GET',u=typeof i==='string'?i:i.url||String(i);return f.apply(this,arguments).then(function(r){p({type:'devorbit-network',method:m,url:u,status:r.status,duration:Date.now()-t,timestamp:t});return r}).catch(function(e){p({type:'devorbit-network',method:m,url:u,error:e.message,timestamp:t});throw e})};
  var xo=XMLHttpRequest.prototype.open,xs=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this._dv={method:m,url:u};return xo.apply(this,arguments)};
  XMLHttpRequest.prototype.send=function(){var x=this;if(x._dv)x._dv.t=Date.now();var h=function(){if(x._dv)p({type:'devorbit-network',method:x._dv.method,url:x._dv.url,status:x.status||0,duration:Date.now()-x._dv.t,timestamp:x._dv.t,error:x.status===0?'Network Error':undefined})};x.addEventListener('load',h);x.addEventListener('error',h);return xs.apply(this,arguments)};
  console.log('[DevOrbit] Logger active');
})();
`.trim();

/**
 * Generate the HTML script tag for injection
 */
function getHtmlScriptTag() {
  return `${START_MARKER}
<script>
${INLINE_LOGGER_SCRIPT}
</script>
${END_MARKER}`;
}

/**
 * Generate the Next.js App Router injection (for layout.tsx)
 */
function getNextjsAppRouterScript() {
  return `${JS_START_MARKER}
const DevOrbitScript = () => (
  <script
    dangerouslySetInnerHTML={{
      __html: \`${INLINE_LOGGER_SCRIPT}\`
    }}
  />
);
${JS_END_MARKER}`;
}

/**
 * Injection strategies for different file types/frameworks
 */
const INJECTION_STRATEGIES = {
  /**
   * Standard HTML injection - inject into <head>
   */
  html: {
    inject: (content) => {
      // Inject after opening <head> tag
      const headMatch = content.match(/<head[^>]*>/i);
      if (headMatch) {
        const insertPos = headMatch.index + headMatch[0].length;
        return (
          content.slice(0, insertPos) +
          '\n' + getHtmlScriptTag() + '\n' +
          content.slice(insertPos)
        );
      }
      // Fallback: inject at the very beginning
      return getHtmlScriptTag() + '\n' + content;
    },
    remove: (content) => {
      const regex = new RegExp(
        `\\s*${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\s*`,
        'g'
      );
      return content.replace(regex, '');
    },
  },

  /**
   * SvelteKit app.html injection - inject into %sveltekit.head%
   */
  sveltekit: {
    inject: (content) => {
      // SvelteKit uses %sveltekit.head% placeholder
      if (content.includes('%sveltekit.head%')) {
        return content.replace(
          '%sveltekit.head%',
          getHtmlScriptTag() + '\n%sveltekit.head%'
        );
      }
      // Fallback to standard HTML injection
      return INJECTION_STRATEGIES.html.inject(content);
    },
    remove: (content) => {
      return INJECTION_STRATEGIES.html.remove(content);
    },
  },

  /**
   * Next.js App Router (layout.tsx) - needs special handling
   */
  nextjs: {
    inject: (content, injectionFile) => {
      if (injectionFile.router === 'app') {
        // App Router - need to add Script component
        // Check if Script is already imported
        const hasScriptImport = content.includes("from 'next/script'") ||
                               content.includes('from "next/script"');

        let modifiedContent = content;

        // Add import if needed
        if (!hasScriptImport) {
          // Find the last import statement
          const importMatches = [...content.matchAll(/^import .+ from .+;?\s*$/gm)];
          if (importMatches.length > 0) {
            const lastImport = importMatches[importMatches.length - 1];
            const insertPos = lastImport.index + lastImport[0].length;
            modifiedContent =
              modifiedContent.slice(0, insertPos) +
              "\nimport Script from 'next/script';" +
              modifiedContent.slice(insertPos);
          }
        }

        // Find the <head> or <body> tag and insert Script
        // For App Router, we add inside the body as a Script component
        const bodyOpenMatch = modifiedContent.match(/<body[^>]*>/);
        if (bodyOpenMatch) {
          const insertPos = bodyOpenMatch.index + bodyOpenMatch[0].length;
          const scriptComponent = `
${JS_START_MARKER}
        <Script id="devorbit-logger" strategy="afterInteractive">
          {\`${INLINE_LOGGER_SCRIPT}\`}
        </Script>
${JS_END_MARKER}`;
          modifiedContent =
            modifiedContent.slice(0, insertPos) +
            scriptComponent +
            modifiedContent.slice(insertPos);
        }

        return modifiedContent;
      }

      // Pages Router (_document.tsx) - similar approach
      // For pages router, we can use a standard script in Head
      const headCloseMatch = content.match(/<\/Head>/i);
      if (headCloseMatch) {
        const insertPos = headCloseMatch.index;
        const scriptComponent = `
${JS_START_MARKER}
          <script dangerouslySetInnerHTML={{ __html: \`${INLINE_LOGGER_SCRIPT}\` }} />
${JS_END_MARKER}`;
        return (
          content.slice(0, insertPos) +
          scriptComponent +
          content.slice(insertPos)
        );
      }

      return content;
    },
    remove: (content) => {
      // Remove the injected Script component
      const regex = new RegExp(
        `\\s*${escapeRegex(JS_START_MARKER)}[\\s\\S]*?${escapeRegex(JS_END_MARKER)}\\s*`,
        'g'
      );
      let modified = content.replace(regex, '');

      // Optionally remove the Script import if no other Scripts are used
      // (keeping it simple - leave the import, it doesn't hurt)

      return modified;
    },
  },

  /**
   * Nuxt - uses plugins for proper injection
   */
  nuxt: {
    inject: (content, injectionFile) => {
      // For Nuxt, we create a plugin file instead of modifying app.vue
      // This is handled separately - return content unchanged
      // The API will create the plugin file
      return content;
    },
    remove: (content) => {
      return content;
    },
    // Special flag indicating we need to create a plugin file
    usesPlugin: true,
  },
};

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a backup of a file before modifying it
 */
function createBackup(filePath) {
  const backupPath = filePath + '.devorbit-backup';
  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (error) {
    console.error(`[LoggerInjection] Failed to create backup:`, error);
    return null;
  }
}

/**
 * Restore a file from backup
 */
function restoreBackup(filePath) {
  const backupPath = filePath + '.devorbit-backup';
  try {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
      fs.unlinkSync(backupPath);
      return true;
    }
  } catch (error) {
    console.error(`[LoggerInjection] Failed to restore backup:`, error);
  }
  return false;
}

/**
 * Inject the DevOrbit logger into a project
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<{success: boolean, message: string, file?: string}>}
 */
export async function injectLogger(projectPath) {
  try {
    // Detect framework
    const frameworkInfo = await detectFramework(projectPath);

    if (!frameworkInfo) {
      return {
        success: false,
        message: 'Could not detect framework or find injection target file',
      };
    }

    const { injectionFile, injectionType, name } = frameworkInfo;
    const filePath = injectionFile.file;

    // Check if already injected
    if (hasLoggerInjected(filePath)) {
      return {
        success: false,
        message: 'DevOrbit logger is already injected in this project',
        file: filePath,
      };
    }

    // Handle Nuxt specially - create plugin file
    if (injectionType === 'nuxt' && INJECTION_STRATEGIES.nuxt.usesPlugin) {
      const pluginPath = path.join(projectPath, 'plugins', 'devorbit-logger.client.ts');
      const pluginsDir = path.join(projectPath, 'plugins');

      // Ensure plugins directory exists
      if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
      }

      const pluginContent = `// ${START_MARKER}
// DevOrbit Logger Plugin - Auto-injected
// Safe: Only runs in iframe on localhost
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;
  ${INLINE_LOGGER_SCRIPT}
});
// ${END_MARKER}
`;

      fs.writeFileSync(pluginPath, pluginContent);

      return {
        success: true,
        message: `DevOrbit logger injected as Nuxt plugin`,
        file: pluginPath,
        framework: name,
      };
    }

    // Get the injection strategy
    const strategy = INJECTION_STRATEGIES[injectionType];
    if (!strategy) {
      return {
        success: false,
        message: `No injection strategy for framework type: ${injectionType}`,
      };
    }

    // Read the file
    const content = fs.readFileSync(filePath, 'utf-8');

    // Create backup
    const backupPath = createBackup(filePath);
    if (!backupPath) {
      return {
        success: false,
        message: 'Failed to create backup file',
      };
    }

    // Inject the logger
    const modifiedContent = strategy.inject(content, injectionFile);

    if (modifiedContent === content) {
      return {
        success: false,
        message: 'Could not find injection point in file',
        file: filePath,
      };
    }

    // Write the modified file
    fs.writeFileSync(filePath, modifiedContent);

    // Clean up backup on success
    try {
      fs.unlinkSync(backupPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    console.log(`[LoggerInjection] Successfully injected logger into ${filePath}`);

    return {
      success: true,
      message: `DevOrbit logger injected into ${name} project`,
      file: filePath,
      framework: name,
    };
  } catch (error) {
    console.error(`[LoggerInjection] Error injecting logger:`, error);
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Remove the DevOrbit logger from a project
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function removeLogger(projectPath) {
  try {
    // Detect framework
    const frameworkInfo = await detectFramework(projectPath);

    if (!frameworkInfo) {
      return {
        success: false,
        message: 'Could not detect framework',
      };
    }

    const { injectionFile, injectionType, name } = frameworkInfo;
    const filePath = injectionFile.file;

    // Handle Nuxt plugin removal
    if (injectionType === 'nuxt' && INJECTION_STRATEGIES.nuxt.usesPlugin) {
      const pluginPath = path.join(projectPath, 'plugins', 'devorbit-logger.client.ts');
      const pluginPathJs = path.join(projectPath, 'plugins', 'devorbit-logger.client.js');

      let removed = false;
      for (const p of [pluginPath, pluginPathJs]) {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
          removed = true;
          break;
        }
      }

      if (removed) {
        return {
          success: true,
          message: 'DevOrbit logger plugin removed',
        };
      }
      return {
        success: false,
        message: 'DevOrbit logger plugin not found',
      };
    }

    // Check if logger is present
    if (!hasLoggerInjected(filePath)) {
      return {
        success: false,
        message: 'DevOrbit logger is not present in this project',
        file: filePath,
      };
    }

    // Get the injection strategy
    const strategy = INJECTION_STRATEGIES[injectionType];
    if (!strategy) {
      return {
        success: false,
        message: `No removal strategy for framework type: ${injectionType}`,
      };
    }

    // Read the file
    const content = fs.readFileSync(filePath, 'utf-8');

    // Create backup
    createBackup(filePath);

    // Remove the logger
    const modifiedContent = strategy.remove(content);

    // Write the modified file
    fs.writeFileSync(filePath, modifiedContent);

    console.log(`[LoggerInjection] Successfully removed logger from ${filePath}`);

    return {
      success: true,
      message: `DevOrbit logger removed from ${name} project`,
      file: filePath,
      framework: name,
    };
  } catch (error) {
    console.error(`[LoggerInjection] Error removing logger:`, error);
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Check the status of the DevOrbit logger in a project
 * @param {string} projectPath - Absolute path to the project
 * @returns {Promise<{detected: boolean, framework?: string, injected: boolean, file?: string}>}
 */
export async function checkLoggerStatus(projectPath) {
  try {
    const frameworkInfo = await detectFramework(projectPath);

    if (!frameworkInfo) {
      return {
        detected: false,
        injected: false,
      };
    }

    const { injectionFile, injectionType, name } = frameworkInfo;

    // Check for Nuxt plugin
    if (injectionType === 'nuxt') {
      const pluginPath = path.join(projectPath, 'plugins', 'devorbit-logger.client.ts');
      const pluginPathJs = path.join(projectPath, 'plugins', 'devorbit-logger.client.js');

      return {
        detected: true,
        framework: name,
        injected: fs.existsSync(pluginPath) || fs.existsSync(pluginPathJs),
        file: pluginPath,
      };
    }

    const filePath = injectionFile.file;

    return {
      detected: true,
      framework: name,
      injected: hasLoggerInjected(filePath),
      file: filePath,
    };
  } catch (error) {
    console.error(`[LoggerInjection] Error checking status:`, error);
    return {
      detected: false,
      injected: false,
    };
  }
}
