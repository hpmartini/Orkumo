/**
 * electron-builder afterPack hook to fix node-pty binaries.
 *
 * electron-rebuild compiles node-pty for Electron's Node ABI, but our server
 * runs in a separate Node.js process using the system Node. This causes
 * the native module to hang or crash when loaded.
 *
 * This script copies the pre-built node-pty binaries (compiled for system Node)
 * to replace the electron-rebuilt ones in the packaged app.
 */

const fs = require('fs');
const path = require('path');

async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const resourcesPath = path.join(appOutDir, 'DevOrbitDashboard.app', 'Contents', 'Resources', 'app.asar.unpacked');
  const nodePtyPath = path.join(resourcesPath, 'node_modules', 'node-pty');

  // Source: pre-built binaries from the project's node_modules
  const sourceNodePty = path.join(__dirname, '..', 'node_modules', 'node-pty');

  console.log('[fix-node-pty-binaries] Replacing electron-rebuilt node-pty with system Node binaries...');

  // Check if the source exists
  if (!fs.existsSync(sourceNodePty)) {
    console.log('[fix-node-pty-binaries] Source node-pty not found, skipping');
    return;
  }

  // Check if the target exists
  if (!fs.existsSync(nodePtyPath)) {
    console.log('[fix-node-pty-binaries] Target node-pty path not found in packaged app, skipping');
    return;
  }

  // Replace build directory
  const targetBuild = path.join(nodePtyPath, 'build');
  const sourceBuild = path.join(sourceNodePty, 'build');

  if (fs.existsSync(sourceBuild)) {
    console.log('[fix-node-pty-binaries] Copying build directory...');
    fs.rmSync(targetBuild, { recursive: true, force: true });
    copyDir(sourceBuild, targetBuild);
  }

  // Replace prebuilds directory
  const targetPrebuilds = path.join(nodePtyPath, 'prebuilds');
  const sourcePrebuilds = path.join(sourceNodePty, 'prebuilds');

  if (fs.existsSync(sourcePrebuilds)) {
    console.log('[fix-node-pty-binaries] Copying prebuilds directory...');
    fs.rmSync(targetPrebuilds, { recursive: true, force: true });
    copyDir(sourcePrebuilds, targetPrebuilds);
  }

  // Make binaries executable
  makeExecutable(path.join(targetBuild, 'Release'));
  makeExecutable(targetPrebuilds);

  console.log('[fix-node-pty-binaries] Done!');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function makeExecutable(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      makeExecutable(fullPath);
    } else if (entry.name.endsWith('.node') || entry.name === 'spawn-helper') {
      fs.chmodSync(fullPath, 0o755);
    }
  }
}

module.exports = afterPack;
