/**
 * Client side of `ptyHolder.js`: agent PTYs run in a detached holder process per agent, so they
 * outlive the server (restart, Electron quit). The server spawns holders, connects to them over
 * Unix sockets in `<data>/pty/`, and reconnects to the ones still running when it starts again.
 *
 * A `HeldPty` has node-pty's shape (`pid`, `onData`, `onExit`, `write`, `resize`, `kill`), plus
 * `hello` (what the holder reported) and `disconnect` (detach, the agent keeps running).
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataPath } from './dataPath.js';

// Bundled (Electron), this module lives in dist-server/index.js next to dist-server/ptyHolder.js.
// Resolved on use: under test runners import.meta.url need not be a file URL
const holderScript = () => fileURLToPath(new URL('./ptyHolder.js', import.meta.url));
const START_TIMEOUT_MS = 10000;
const HELLO_TIMEOUT_MS = 5000;
// sockaddr_un.sun_path holds 104 bytes on macOS, 108 on Linux, including the terminating NUL
const MAX_SOCKET_PATH = 103;

function holderDir() {
  const dir = path.join(getDataPath(), 'pty');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Sockets of holders that may still run (a stale one refuses connections) */
export function heldPtySockets() {
  const dir = path.join(getDataPath(), 'pty');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sock'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Removes the socket and log a holder that is gone left behind */
export function removeStaleSocket(socketPath) {
  fs.rmSync(socketPath, { force: true });
  fs.rmSync(socketPath.replace(/\.sock$/, '.log'), { force: true });
}

class HeldPty {
  constructor(socket, hello) {
    this.socket = socket;
    this.hello = hello;
    this.pid = hello.pid;
    this.dataListeners = [];
    this.exitListeners = [];
    // messages that arrive before `start()` (listeners not wired yet) wait here
    this.queue = [];
    this.started = false;
    this.ended = false;
  }

  onData(cb) {
    this.dataListeners.push(cb);
  }

  onExit(cb) {
    this.exitListeners.push(cb);
  }

  /** Delivers queued and further output to the listeners */
  start() {
    this.started = true;
    for (const msg of this.queue.splice(0)) this.receive(msg);
  }

  receive(msg) {
    if (!this.started) {
      this.queue.push(msg);
      return;
    }
    if (msg.t === 'out') for (const cb of this.dataListeners) cb(msg.d);
    else if (msg.t === 'exit' && !this.ended) {
      this.ended = true;
      for (const cb of this.exitListeners)
        cb({ exitCode: msg.exitCode ?? null, signal: msg.signal ?? null });
    }
  }

  send(msg) {
    if (!this.socket.destroyed) this.socket.write(`${JSON.stringify(msg)}\n`);
  }

  write(d) {
    this.send({ t: 'in', d });
  }

  resize(cols, rows) {
    this.send({ t: 'resize', cols, rows });
  }

  /** Ends the agent (the holder exits with it) */
  kill() {
    this.send({ t: 'kill' });
  }

  /** Detaches: the agent keeps running in its holder */
  disconnect() {
    this.socket.end();
  }
}

/**
 * Connects to a running holder; resolves once it said hello. A socket that closes without an
 * exit message means the holder is gone, and the agent with it.
 * @param {string} socketPath
 * @returns {Promise<HeldPty>}
 */
export function connectHeldPty(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding('utf8');
    let held = null;
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`PTY holder ${socketPath} did not answer`));
    }, HELLO_TIMEOUT_MS);
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (held) held.receive(msg);
        else if (msg.t === 'hello') {
          clearTimeout(timer);
          held = new HeldPty(socket, msg);
          resolve(held);
        }
      }
    });
    socket.on('error', (error) => {
      if (held) return;
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      if (held) held.receive({ t: 'exit', exitCode: null, signal: null });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts `file args` in a new detached holder and connects to it.
 * @param {{ id: string, file: string, args: string[], cwd: string, cols: number, rows: number, env: object }} spec
 * @returns {Promise<HeldPty>}
 */
export async function spawnHeldPty(spec) {
  const dir = holderDir();
  const name = crypto.createHash('sha256').update(spec.id).digest('hex').slice(0, 16);
  const socketPath = path.join(dir, `${name}.sock`);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH)
    throw new Error(`PTY socket path is too long for a Unix socket: ${socketPath}`);
  const logPath = path.join(dir, `${name}.log`);
  const log = fs.openSync(logPath, 'w', 0o600);
  let exitCode = null;
  try {
    // process.execPath: node, or Electron's binary run as node, whose ABI node-pty is built for
    const child = spawn(process.execPath, [holderScript()], {
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ORKUMO_PTY_HOLDER: JSON.stringify({ ...spec, socketPath, logPath }),
      },
    });
    child.once('exit', (code) => {
      exitCode = code ?? 1;
    });
    child.unref();
  } finally {
    fs.closeSync(log);
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    try {
      return await connectHeldPty(socketPath);
    } catch (error) {
      if (exitCode !== null) {
        const reason = fs.readFileSync(logPath, 'utf8').trim();
        removeStaleSocket(socketPath);
        throw new Error(reason || `PTY holder exited with code ${exitCode}`);
      }
      if (Date.now() > deadline) throw new Error(`PTY holder did not start: ${error.message}`);
    }
    await sleep(25);
  }
}
