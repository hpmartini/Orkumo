#!/usr/bin/env node
/**
 * Patches node-pty to fix the spawn-helper path resolution bug in Electron.
 *
 * The bug: node-pty's unixTerminal.js does helperPath.replace('app.asar', 'app.asar.unpacked')
 * which incorrectly matches 'app.asar' within 'app.asar.unpacked' and creates
 * 'app.asar.unpacked.unpacked' - a path that doesn't exist.
 *
 * The fix: Use a regex that only matches '/app.asar/' (with slashes) so it won't
 * match '/app.asar.unpacked/'.
 *
 * Also restores the executable bit on the spawn-helper binary that ships inside
 * the prebuilt tarball - npm/macOS occasionally extracts prebuilds without the
 * +x bit, which makes `pty.spawn()` fail with a generic "posix_spawnp failed."
 * error that is otherwise very hard to diagnose.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

// Walk every node-pty install under the project (including pty-host/) and
// make sure the spawn-helper binary is executable.
function fixSpawnHelperPermissions(rootDir) {
  const candidates = [
    path.join(rootDir, 'node_modules', 'node-pty'),
    path.join(rootDir, 'pty-host', 'node_modules', 'node-pty'),
  ];
  let fixed = 0;
  for (const ptyDir of candidates) {
    if (!fs.existsSync(ptyDir)) continue;
    const prebuilds = path.join(ptyDir, 'prebuilds');
    if (!fs.existsSync(prebuilds)) continue;
    const archDirs = fs.readdirSync(prebuilds);
    for (const arch of archDirs) {
      const helper = path.join(prebuilds, arch, 'spawn-helper');
      if (!fs.existsSync(helper)) continue;
      try {
        fs.chmodSync(helper, 0o755);
        console.log(`[patch-node-pty] chmod +x ${path.relative(projectRoot, helper)}`);
        fixed++;
      } catch (err) {
        console.warn(
          `[patch-node-pty] could not chmod ${helper}: ${err.message}`
        );
      }
    }
  }
  return fixed;
}

const targetFile = path.join(projectRoot, 'node_modules', 'node-pty', 'lib', 'unixTerminal.js');

if (!fs.existsSync(targetFile)) {
  console.log('[patch-node-pty] node-pty not found, skipping unixTerminal patch');
  fixSpawnHelperPermissions(projectRoot);
  process.exit(0);
}

let content = fs.readFileSync(targetFile, 'utf8');

// Check if already patched
if (content.includes('/\\/app\\.asar\\//')) {
  console.log('[patch-node-pty] Already patched, skipping unixTerminal patch');
  fixSpawnHelperPermissions(projectRoot);
  process.exit(0);
}

// Apply the patch
const oldCode = `helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');`;

const newCode = `// Only replace if not already unpacked (avoid app.asar.unpacked -> app.asar.unpacked.unpacked)
helperPath = helperPath.replace(/\\/app\\.asar\\//, '/app.asar.unpacked/');
helperPath = helperPath.replace(/\\/node_modules\\.asar\\//, '/node_modules.asar.unpacked/');`;

if (!content.includes(oldCode)) {
  console.log('[patch-node-pty] Original code not found, may be a different version');
  fixSpawnHelperPermissions(projectRoot);
  process.exit(0);
}

content = content.replace(oldCode, newCode);
fs.writeFileSync(targetFile, content);

console.log('[patch-node-pty] Successfully patched node-pty unixTerminal.js');
fixSpawnHelperPermissions(projectRoot);
