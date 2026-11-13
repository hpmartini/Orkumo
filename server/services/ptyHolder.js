#!/usr/bin/env node
/**
 * Holds one agent PTY outside the Orkumo server, like dtach: the server connects over a Unix
 * socket, detaches and reattaches, also after it restarted or Electron quit. The agent ends only
 * when it exits or a client sends `kill`; then this process removes its socket and exits.
 * Started detached by `heldPty.js` (`spawnHeldPty`), one per agent.
 *
 * Spec: env ORKUMO_PTY_HOLDER, JSON { socketPath, logPath, id, file, args, cwd, cols, rows, env }.
 * Protocol, one JSON object per line:
 *   holder → client  { t: 'hello', v, id, pid, file, args, cwd, cols, rows, createdAt, backlog }
 *                    { t: 'out', d }   { t: 'exit', exitCode, signal }
 *   client → holder  { t: 'in', d }    { t: 'resize', cols, rows }   { t: 'kill' }
 */
import fs from 'fs';
import net from 'net';
import * as pty from 'node-pty';

/** Output replayed to a client that (re)attaches */
const BACKLOG_CHARS = 512 * 1024;

const spec = JSON.parse(process.env.ORKUMO_PTY_HOLDER || 'null');
delete process.env.ORKUMO_PTY_HOLDER;
if (!spec) {
  console.error('ORKUMO_PTY_HOLDER is not set');
  process.exit(2);
}

// Detached from the server's session: a hangup there must not end the agent
process.on('SIGHUP', () => {});

let { cols, rows } = spec;
let backlog = '';
const createdAt = Date.now();
const clients = new Set();
const send = (socket, msg) => {
  if (!socket.destroyed) socket.write(`${JSON.stringify(msg)}\n`);
};

let term;
try {
  term = pty.spawn(spec.file, spec.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: spec.cwd,
    env: spec.env,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

term.onData((d) => {
  backlog += d;
  if (backlog.length > BACKLOG_CHARS) backlog = backlog.slice(-BACKLOG_CHARS);
  for (const socket of clients) send(socket, { t: 'out', d });
});

const server = net.createServer((socket) => {
  clients.add(socket);
  socket.setEncoding('utf8');
  send(socket, {
    t: 'hello',
    v: 1,
    id: spec.id,
    pid: term.pid,
    file: spec.file,
    args: spec.args,
    cwd: spec.cwd,
    cols,
    rows,
    createdAt,
    backlog,
  });
  let buffer = '';
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
      if (msg.t === 'in' && typeof msg.d === 'string') term.write(msg.d);
      else if (msg.t === 'resize' && msg.cols > 0 && msg.rows > 0) {
        ({ cols, rows } = msg);
        term.resize(cols, rows);
      } else if (msg.t === 'kill') term.kill();
    }
  });
  const drop = () => clients.delete(socket);
  socket.on('close', drop);
  socket.on('error', drop);
});

term.onExit(({ exitCode, signal }) => {
  server.close();
  fs.rmSync(spec.socketPath, { force: true });
  fs.rmSync(spec.logPath, { force: true });
  for (const socket of clients) {
    send(socket, { t: 'exit', exitCode, signal });
    socket.end();
  }
  // let the exit message flush; nothing else keeps this process alive
  setTimeout(() => process.exit(0), 500);
});

fs.rmSync(spec.socketPath, { force: true });
server.listen(spec.socketPath, () => fs.chmodSync(spec.socketPath, 0o600));
