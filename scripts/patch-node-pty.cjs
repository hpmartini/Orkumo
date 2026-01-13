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
 */

const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'node_modules', 'node-pty', 'lib', 'unixTerminal.js');

if (!fs.existsSync(targetFile)) {
  console.log('[patch-node-pty] node-pty not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(targetFile, 'utf8');

// Check if already patched
if (content.includes('/\\/app\\.asar\\//')) {
  console.log('[patch-node-pty] Already patched, skipping');
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
  process.exit(0);
}

content = content.replace(oldCode, newCode);
fs.writeFileSync(targetFile, content);

console.log('[patch-node-pty] Successfully patched node-pty unixTerminal.js');
