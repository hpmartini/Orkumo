/**
 * Shared helper for node-pty's native binaries.
 *
 * node-pty spawns `spawn-helper` via posix_spawnp for every PTY it creates.
 * The prebuilt helper can arrive from `bun install` without its executable bit
 * (observed with node-pty 1.1.0 on darwin-arm64). Without it every spawn fails
 * with a bare "posix_spawnp failed." - which surfaces in the UI as
 * "Failed to start shell". Restoring the mode is all that is needed.
 */

const fs = require('fs');
const path = require('path');

/** Files that must be executable for node-pty to work. */
function isNativeBinary(name) {
  return name.endsWith('.node') || name === 'spawn-helper';
}

/**
 * Recursively chmod node-pty's native binaries to 0755.
 * @param {string} dir - Directory to walk; missing directories are ignored.
 * @returns {string[]} Paths that were made executable.
 */
function makeExecutable(dir) {
  if (!fs.existsSync(dir)) return [];

  const fixed = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      fixed.push(...makeExecutable(fullPath));
    } else if (isNativeBinary(entry.name)) {
      const mode = fs.statSync(fullPath).mode & 0o777;
      if (mode !== 0o755) {
        fs.chmodSync(fullPath, 0o755);
        fixed.push(fullPath);
      }
    }
  }
  return fixed;
}

module.exports = { makeExecutable };
