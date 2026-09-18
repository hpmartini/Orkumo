export enum AppStatus {
  STOPPED = 'STOPPED',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  STARTING = 'STARTING',
  ANALYZING = 'ANALYZING',
  CANCELLED = 'CANCELLED',
  WAITING = 'WAITING',
  RESTARTING = 'RESTARTING',
}

export type AppType =
  | 'vite'
  | 'next'
  | 'cra'
  | 'vue'
  | 'nuxt'
  | 'node'
  | 'static'
  | 'docker-compose'
  | 'unknown';

export interface DockerService {
  name: string;
  containerId?: string;
  status: 'running' | 'exited' | 'paused' | 'created' | 'unknown';
  ports?: string[];
  image?: string;
}

export interface AppConfig {
  id: string;
  name: string;
  path: string;
  type: AppType;
  port?: number;
  addresses?: string[];
  startCommand?: string;
  detectedFramework?: string;
  status: AppStatus;
  uptime: number; // seconds
  logs: string[];
  stats: {
    cpu: number[]; // history
    memory: number[]; // history (MB)
  };
  aiAnalysis?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  // Docker Compose specific fields
  dockerComposeFile?: string; // Path to compose file (docker-compose.yml, compose.yaml, etc.)
  dockerServices?: DockerService[]; // List of services defined in compose file
}

export interface SystemStats {
  totalApps: number;
  runningApps: number;
  totalCpuUsage: number;
  totalMemoryUsage: number;
}

export interface IDE {
  id: string;
  name: string;
  path: string;
}

export interface ConsoleLog {
  id: string;
  method: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
  timestamp: number;
  url: string;
  uncaught?: boolean;
}

export interface NetworkLog {
  id: string;
  method: string;
  url: string;
  status?: number;
  error?: string;
  duration?: number;
  timestamp: number;
}

export interface ClaudeTerminalOptions {
  continueSession: boolean;
  skipPermissions: boolean;
}

export interface ClaudeCLIInfo {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export type TerminalType = 'shell' | 'claude';

// Keyboard shortcuts configuration
export interface KeyboardShortcut {
  key: string; // The key to press (e.g., 'b', 'h', '1')
  modifiers?: {
    // Optional modifier keys
    ctrl?: boolean;
    meta?: boolean; // Cmd on Mac
    alt?: boolean;
    shift?: boolean;
  };
  description: string; // Human-readable description
}

export interface KeyboardShortcuts {
  toggleSidebar: KeyboardShortcut;
  goToDashboard: KeyboardShortcut;
  goToDashboardAlt: KeyboardShortcut;
  openSettings: KeyboardShortcut;
  openSettingsAlt: KeyboardShortcut;
  toggleDetailsCoding: KeyboardShortcut;
  openFavorites: KeyboardShortcut;
  openProjects: KeyboardShortcut;
  openAgents: KeyboardShortcut;
  goToTab1: KeyboardShortcut;
  goToTab2: KeyboardShortcut;
  goToTab3: KeyboardShortcut;
  goToTab4: KeyboardShortcut;
  goToTab5: KeyboardShortcut;
  goToTab6: KeyboardShortcut;
  goToTab7: KeyboardShortcut;
  goToTab8: KeyboardShortcut;
  goToTab9: KeyboardShortcut;
  // App control shortcuts
  startApp: KeyboardShortcut;
  stopApp: KeyboardShortcut;
  restartApp: KeyboardShortcut;
}

// Per-app view state - stored separately for each app tab
export type EditorType = 'monaco' | 'code-server';
export type DevToolsTab = 'console' | 'network';
export type ConsoleFilter = 'all' | 'log' | 'warn' | 'error';

export interface PerAppViewState {
  // Terminal state (tabs array is not stored here due to XTerm instances)
  activeTerminalTabId: string | null;
  showLogsTab: boolean;

  // Editor state
  editorType: EditorType;

  // DevTools state
  showDevTools: boolean;
  devToolsTab: DevToolsTab;
  consoleFilter: ConsoleFilter;

  // Panel visibility
  isBrowserHidden: boolean;
  isTerminalHidden: boolean;
}

export const DEFAULT_PER_APP_STATE: PerAppViewState = {
  activeTerminalTabId: null,
  showLogsTab: true,
  editorType: 'code-server',
  showDevTools: true,
  devToolsTab: 'console',
  consoleFilter: 'all',
  isBrowserHidden: false,
  isTerminalHidden: true, // Default to hidden when first entering coding view
};

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  toggleSidebar: { key: 'b', description: 'Toggle sidebar' },
  goToDashboard: { key: 'h', description: 'Go to dashboard' },
  goToDashboardAlt: { key: 'd', description: 'Go to dashboard' },
  openSettings: { key: 's', description: 'Open settings' },
  openSettingsAlt: { key: ',', modifiers: { meta: true }, description: 'Open settings (Cmd+,)' },
  toggleDetailsCoding: { key: 'c', description: 'Toggle Details/Coding view' },
  openFavorites: { key: 'f', description: 'Open favorites' },
  openProjects: { key: 'p', description: 'Open projects' },
  openAgents: { key: 'a', description: 'Open Claude agents view' },
  goToTab1: { key: '1', modifiers: { meta: true }, description: 'Go to tab 1' },
  goToTab2: { key: '2', modifiers: { meta: true }, description: 'Go to tab 2' },
  goToTab3: { key: '3', modifiers: { meta: true }, description: 'Go to tab 3' },
  goToTab4: { key: '4', modifiers: { meta: true }, description: 'Go to tab 4' },
  goToTab5: { key: '5', modifiers: { meta: true }, description: 'Go to tab 5' },
  goToTab6: { key: '6', modifiers: { meta: true }, description: 'Go to tab 6' },
  goToTab7: { key: '7', modifiers: { meta: true }, description: 'Go to tab 7' },
  goToTab8: { key: '8', modifiers: { meta: true }, description: 'Go to tab 8' },
  goToTab9: { key: '9', modifiers: { meta: true }, description: 'Go to tab 9' },
  // App control shortcuts
  startApp: { key: 'Enter', modifiers: { meta: true }, description: 'Start selected app' },
  stopApp: { key: '.', modifiers: { meta: true }, description: 'Stop selected app' },
  restartApp: {
    key: 'r',
    modifiers: { meta: true, shift: true },
    description: 'Restart selected app',
  },
};

// ============================================
// Claude Code Agent View (browser counterpart of `claude agents`)
// ============================================

/** Raw supervisor state as reported by `claude agents --json` */
export type AgentSessionState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped';

/** Process status while the worker is alive */
export type AgentProcessStatus = 'busy' | 'waiting' | 'idle';

/** Display state used for icons and grouping in the agent view */
export type AgentDisplayState =
  | 'working'
  | 'needs-input'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'loop'
  | 'interactive';

export interface AgentPrLink {
  id: string;
  href: string;
  title: string | null;
  number: number | null;
  provider: 'github' | 'gitlab';
  state: string | null;
}

export interface AgentSession {
  /** Short id (`claude attach <id>`), or `interactive-<pid>` for foreground sessions */
  id: string;
  /** Full session UUID (usable with `claude --resume`) */
  sessionId: string | null;
  kind: 'background' | 'interactive';
  cwd: string;
  startedAt: number;
  updatedAt?: number | null;
  name: string;
  nameSource?: string | null;
  state: AgentSessionState | null;
  status?: AgentProcessStatus | null;
  waitingFor?: string | null;
  pid?: number | null;
  /** One-line activity summary maintained by the CLI */
  detail?: string | null;
  tempo?: string | null;
  /** First prompt / task description */
  intent?: string | null;
  template?: string | null;
  agent?: string | null;
  result?: string | null;
  suggestedReply?: string | null;
  tokens?: number | null;
  loop?: { routine: string } | null;
  worktree?: string | null;
  transcriptPath?: string | null;
  cliVersion?: string | null;
  respawnFlags?: string[];
  pinned: boolean;
  order: number | null;
  links: AgentPrLink[];
  displayState: AgentDisplayState;
}

export interface AgentDaemonStatus {
  running: boolean;
  pid: number | null;
  version: string | null;
  workers: number | null;
  versionMismatch: boolean;
  raw: string;
}

export interface ClaudeUserSettings {
  model: string | null;
  effortLevel: string | null;
  permissionMode: string | null;
  disableAgentView: boolean;
  leftArrowOpensAgents: boolean;
  prefersReducedMotion: boolean;
  bgIsolation: string;
}

export interface AgentsResponse {
  sessions: AgentSession[];
  daemon: AgentDaemonStatus | null;
  userSettings: ClaudeUserSettings | null;
  cli: { installed: boolean; path: string | null };
  capabilities?: AgentCapabilities;
}

export interface AgentCapabilities {
  /** Unsafe dispatch flags need DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true on the server */
  unsafeFlagsAllowed: boolean;
  /** Configured project directories - the only valid session working directories */
  allowedDirs: string[];
}

export type AgentGrouping = 'state' | 'directory';
export type AgentLayout = 'tabs' | 'columns' | 'rows' | 'grid';

export interface AgentDispatchDefaults {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  agent: string | null;
  fallbackModel: string | null;
  skipPermissions: boolean;
  allowSkipPermissions: boolean;
  restricted: boolean;
  settings: string | null;
  addDirs: string[];
  pluginDirs: string[];
  mcpConfigs: string[];
  strictMcpConfig: boolean;
}

export interface AgentViewSettings {
  grouping: AgentGrouping;
  layout: AgentLayout;
  scopeCwd: string | null;
  collapsedGroups: string[];
  notifications: boolean;
  desktopNotifications: boolean;
  disabled: boolean;
  dispatch: AgentDispatchDefaults;
  version: number;
}

export interface AgentDispatchRequest extends Partial<AgentDispatchDefaults> {
  prompt?: string;
  exec?: string;
  resume?: string;
  name?: string | null;
  cwd: string;
}

export interface AgentDispatchResult {
  id: string;
  name: string | null;
  alreadyRunning: boolean;
  output: string;
}

export interface AgentLogEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

export interface AgentLogs {
  source: 'logs' | 'transcript';
  text: string;
  entries: AgentLogEntry[];
  note?: string | null;
}

export interface AgentSubagent {
  name: string;
  description: string;
  model: string | null;
  source: 'project' | 'user';
}

export interface AgentRepo {
  name: string;
  path: string;
  source: 'repo' | 'worktree' | 'session' | 'configured';
}

export interface AgentSlashCommand {
  name: string;
  description: string;
  source: 'builtin' | 'project' | 'user';
}

export interface AgentPastSession {
  sessionId: string;
  id: string | null;
  name: string;
  firstPrompt: string | null;
  cwd: string | null;
  projectSlug: string;
  lastActivity: number;
  size: number;
  state: AgentSessionState | null;
}

export interface AgentRemoveResult {
  removed: boolean;
  message: string;
  hints?: { discardUnpushed: string | null; forceRemoveWorktree: string | null };
}

export interface AgentNotification {
  type: 'agent_needs_input' | 'agent_completed' | 'agent_failed';
  session: AgentSession;
}

export const DEFAULT_AGENT_DISPATCH_DEFAULTS: AgentDispatchDefaults = {
  model: null,
  effort: null,
  permissionMode: null,
  agent: null,
  fallbackModel: null,
  skipPermissions: false,
  allowSkipPermissions: false,
  restricted: false,
  settings: null,
  addDirs: [],
  pluginDirs: [],
  mcpConfigs: [],
  strictMcpConfig: false,
};

export const DEFAULT_AGENT_VIEW_SETTINGS: AgentViewSettings = {
  grouping: 'state',
  layout: 'tabs',
  scopeCwd: null,
  collapsedGroups: [],
  notifications: true,
  desktopNotifications: false,
  disabled: false,
  dispatch: DEFAULT_AGENT_DISPATCH_DEFAULTS,
  version: 1,
};
