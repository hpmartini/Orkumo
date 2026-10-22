import express from 'express';
import { execFile } from 'child_process';
import * as agentService from './agentService.js';
import rateLimit from 'express-rate-limit';
import { getGhosttyConfig } from './ghosttyConfigService.js';

const router = express.Router();

const openLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many Ghostty launches, please slow down' },
});

// Only plain attach/continue invocations; nothing that widens permissions or injects a prompt.
function isAllowedClaudeArgs(args) {
  if (args.length === 0) return true;
  if (args.length === 1) return args[0] === '-c';
  return (
    args.length === 2 &&
    (args[0] === 'attach' || args[0] === '--resume') &&
    agentService.SHORT_ID_RE.test(args[1])
  );
}

// Browsers send Origin on cross-site POSTs; cors() is open, so refuse non-loopback origins here.
function isLoopbackOrigin(origin) {
  if (!origin) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

router.get('/', (req, res) => {
  try {
    res.json(getGhosttyConfig());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/terminal/ghostty/open - launch Ghostty (macOS) in an allowed directory.
 * Only `claude` may be run; args go through execFile, never a shell.
 */
router.post('/open', openLimiter, (req, res) => {
  if (!isLoopbackOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  }
  const { cwd, command, args } = req.body || {};
  if (process.platform !== 'darwin') {
    return res.status(501).json({ error: 'Opening Ghostty is only supported on macOS' });
  }
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 500) {
    return res.status(400).json({ error: 'cwd is required' });
  }
  if (command != null && command !== 'claude') {
    return res.status(400).json({ error: "Only the 'claude' command is allowed" });
  }
  if (
    args != null &&
    (!Array.isArray(args) ||
      args.length > 20 ||
      args.some((a) => typeof a !== 'string' || a.length > 200))
  ) {
    return res.status(400).json({ error: 'args must be an array of short strings' });
  }
  if (!isAllowedClaudeArgs(args || [])) {
    return res.status(400).json({ error: 'Only attach <id>, --resume <id> or -c are allowed' });
  }
  try {
    const dir = agentService.assertAllowedPath(
      cwd.trim(),
      agentService.getAllowedDirectories(),
      'cwd'
    );
    const launch = ['-na', 'Ghostty', '--args', `--working-directory=${dir}`];
    if (command) launch.push('-e', command, ...(args || []));
    execFile('open', launch, (error) => {
      if (error)
        return res.status(500).json({ error: `Failed to launch Ghostty: ${error.message}` });
      // Only the window launch is confirmed, not that claude started inside it.
      res.json({ success: true, launched: 'window' });
    });
  } catch (error) {
    res.status(error?.status || 500).json({ error: error?.message || 'Failed to launch Ghostty' });
  }
});

export default router;
