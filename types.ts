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
  goToDashboard: KeyboardShortcut;
  goToDashboardAlt: KeyboardShortcut;
  openSettings: KeyboardShortcut;
  openSettingsAlt: KeyboardShortcut;
  toggleDetailsCoding: KeyboardShortcut;
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
  goToDashboard: { key: 'h', description: 'Go to dashboard' },
  goToDashboardAlt: { key: 'd', description: 'Go to dashboard' },
  openSettings: { key: 's', description: 'Open settings' },
  openSettingsAlt: { key: ',', modifiers: { meta: true }, description: 'Open settings (Cmd+,)' },
  toggleDetailsCoding: { key: 'c', description: 'Toggle Details/Coding view' },
  openAgents: { key: 'a', description: 'Open Claude agents view' },
  goToTab1: { key: '1', modifiers: { meta: true }, description: 'Go to context 1' },
  goToTab2: { key: '2', modifiers: { meta: true }, description: 'Go to context 2' },
  goToTab3: { key: '3', modifiers: { meta: true }, description: 'Go to context 3' },
  goToTab4: { key: '4', modifiers: { meta: true }, description: 'Go to context 4' },
  goToTab5: { key: '5', modifiers: { meta: true }, description: 'Go to context 5' },
  goToTab6: { key: '6', modifiers: { meta: true }, description: 'Go to context 6' },
  goToTab7: { key: '7', modifiers: { meta: true }, description: 'Go to context 7' },
  goToTab8: { key: '8', modifiers: { meta: true }, description: 'Go to context 8' },
  goToTab9: { key: '9', modifiers: { meta: true }, description: 'Go to context 9' },
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

export interface AgentPullRequest {
  number: number;
  title: string;
  url: string;
  author: string | null;
  isDraft: boolean;
  headRef: string;
  baseRef: string;
  updatedAt: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  ci: 'success' | 'failure' | 'pending' | 'none';
  ciPassed: number;
  ciFailed: number;
  ciPending: number;
  mergeReady: boolean;
  repoSlug: string;
}

/** Real listening TCP port whose process cwd is inside the session's directory */
export interface AgentListeningServer {
  port: number;
  pid: number;
  command: string;
  url: string;
}

/** Live resource use of a listening server process (GET /api/agents/servers/stats) */
export interface AgentServerStats {
  pid: number;
  /** CPU percent of one core, as reported by ps */
  cpu: number;
  memMb: number;
}

export interface AgentCacheInfo {
  /** Epoch ms of the latest assistant turn: the cache TTL counts from here */
  lastActivityAt: number;
  ttlMs: number;
  /** Prompt tokens of the latest turn (cached + written + uncached) */
  cachedTokens: number;
  contextWindow: number;
  /** Turns that read from the cache, out of all turns */
  hits: number;
  turns: number;
  /** Cache-read share of all input tokens, 0..1 */
  hitRatio: number;
}

export interface AgentContext {
  /** slug = "owner/repo" from the origin remote (github) */
  repo: {
    name: string;
    /** Main checkout path; the same for every subfolder and worktree of the repo */
    root: string;
    slug: string | null;
    branch: string | null;
    dirty: boolean;
    ahead: number;
    behind: number;
    /** true when the session runs in a linked git worktree (not the main checkout) */
    isWorktree: boolean;
    /** Folder name of the linked worktree; null for the main checkout */
    worktreeName: string | null;
    /** Absolute path of the linked worktree; null for the main checkout */
    worktreePath: string | null;
  } | null;
  /** Model of the session's latest assistant turn (e.g. "claude-opus-5-5"); null when unknown */
  model: string | null;
  /** Prompt-cache stats from the session transcript; null when there is no local transcript */
  cache?: AgentCacheInfo | null;
  /** null when gh is unavailable/unauthenticated or not a github repo */
  issues: { open: number; url: string | null } | null;
  pulls: { open: number; url: string | null; items: AgentPullRequest[] } | null;
  servers: AgentListeningServer[];
  subagents: { running: number; total: number; names: string[] };
}

export interface AgentSession {
  /** Short id (`claude attach <id>`), or `interactive-<pid>` for foreground sessions */
  id: string;
  /** Full session UUID (usable with `claude --resume`) */
  sessionId: string | null;
  kind: 'background' | 'interactive';
  /** Client-side cloud/remote session: PTY args instead of `attach <id>` */
  ptyArgs?: string[];
  /** PTY command for ptyArgs (default `claude`; `ssh` for remote attach) */
  ptyCommand?: 'claude' | 'ssh';
  /** Tailscale device the session runs on (remote sessions only) */
  host?: string;
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

export type RemoteDeviceState = 'ok' | 'offline' | 'ssh-denied' | 'claude-missing' | 'error';

export interface RemoteDevice {
  host: string;
  name: string;
  os: 'macOS' | 'linux';
  state: RemoteDeviceState;
  reason?: string;
  sessions: AgentSession[];
}

export interface RemoteAgentsResponse {
  /** false: neither `tailscale` in PATH nor the macOS app binary */
  tailscale: boolean;
  error?: string;
  devices: RemoteDevice[];
}

export interface AgentCapabilities {
  /** Unsafe dispatch flags need DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true on the server */
  unsafeFlagsAllowed: boolean;
  /** Configured project directories - the only valid session working directories */
  allowedDirs: string[];
}

export type AgentGrouping = 'state' | 'directory' | 'project' | 'none';
export type AgentLayout = 'tabs' | 'columns' | 'rows' | 'grid';
/** When a session card shows its details (issues, PRs, servers, sub-agents) */
export type AgentCardDetails = 'hover' | 'click' | 'always';
export type AgentCardDensity = 'comfortable' | 'compact';
/** Detail elements of an agent card (#159); each sits in one AgentCardSlot */
export type AgentCardElement =
  | 'issue'
  | 'pr'
  | 'project'
  | 'branch'
  | 'git'
  | 'metrics'
  | 'status'
  | 'links'
  | 'servers'
  | 'subagents';
/** left = column under the status glyph, title = after the name, row2-4 = lines below it */
export type AgentCardSlot = 'left' | 'title' | 'row2' | 'row3' | 'row4' | 'details' | 'hidden';
export type AgentCardFields = Record<AgentCardElement, AgentCardSlot>;

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
  cardDetails: AgentCardDetails;
  cardDensity: AgentCardDensity;
  cardFields: AgentCardFields;
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
  /** Start without a prompt ("New agent"); the session waits for input */
  idle?: boolean;
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

export const DEFAULT_AGENT_CARD_FIELDS: AgentCardFields = {
  issue: 'left',
  pr: 'left',
  project: 'row2',
  branch: 'row2',
  git: 'row2',
  metrics: 'row3',
  status: 'row4',
  links: 'details',
  servers: 'details',
  subagents: 'details',
};

export const DEFAULT_AGENT_VIEW_SETTINGS: AgentViewSettings = {
  grouping: 'project',
  layout: 'tabs',
  scopeCwd: null,
  collapsedGroups: [],
  notifications: true,
  desktopNotifications: false,
  cardDetails: 'hover',
  cardDensity: 'comfortable',
  cardFields: DEFAULT_AGENT_CARD_FIELDS,
  disabled: false,
  dispatch: DEFAULT_AGENT_DISPATCH_DEFAULTS,
  version: 1,
};

// ---------------------------------------------------------------------------
// Agent Task Board (/board, #44). Source of truth: GitHub Project (GraphQL via gh).
// ---------------------------------------------------------------------------

export interface BoardSource {
  owner: string;
  /** Project number, e.g. 4 for users/hpmartini/projects/4 (MACC) */
  number: number;
}

// Workflows (#87): mw runs and card details; the stage rule lives in utils/workflowStage.js
export interface WorkflowRunPhase {
  phase: string;
  result: string;
  /** ISO time of the trace line */
  at: string;
  role?: string;
  model?: string;
}

export interface WorkflowRunInfo {
  runId: string;
  repoPath: string;
  mode: 'orchestrate' | 'pipeline';
  phases: WorkflowRunPhase[];
  pendingApproval: { stage: string; sha: string } | null;
  runDir: string;
}

export interface WorkflowDetails {
  docs: { name: string; path: string }[];
  /** image URLs from issue and PR comments (review screenshots) */
  screenshots: string[];
  phases: WorkflowRunPhase[];
}

export interface BoardStatusOption {
  id: string;
  name: string;
  /** GitHub ProjectV2 color name: GRAY | BLUE | GREEN | YELLOW | ORANGE | RED | PINK | PURPLE */
  color: string;
}

export interface BoardLabel {
  name: string;
  /** hex without '#' */
  color: string;
}

export type BoardCheckState = 'success' | 'failure' | 'pending' | null;

export interface BoardPullRequest {
  /** "owner/name" */
  repo: string;
  number: number;
  url: string;
  title: string | null;
  /** OPEN | CLOSED | MERGED */
  state: string;
  checks: BoardCheckState;
}

export interface BoardIssueRef {
  /** Issue node id (I_…); set for parents read from GitHub */
  id?: string;
  repo: string;
  number: number;
  title: string;
}

/** One mw-board marker comment (start, ask, briefed, goal, review, …) */
export interface MwMarker {
  kind: string;
  attrs: Record<string, string>;
  /** comment createdAt (ISO) */
  at: string;
}

export interface BoardItem {
  /** ProjectV2 item node id (PVTI_…), used to write the status */
  itemId: string;
  type: 'Issue' | 'PullRequest' | 'DraftIssue';
  /** Issue node id (I_…) for edits; null for PRs and drafts */
  issueId: string | null;
  /** null for draft issues */
  number: number | null;
  title: string;
  url: string | null;
  /** "owner/name"; null for draft issues */
  repo: string | null;
  /** OPEN | CLOSED | MERGED */
  state: string;
  /** COMPLETED | NOT_PLANNED | DUPLICATE | REOPENED | null */
  stateReason: string | null;
  statusOptionId: string | null;
  labels: BoardLabel[];
  milestone: string | null;
  assignees: string[];
  parent: BoardIssueRef | null;
  subIssues: { total: number; completed: number };
  /** Linked PRs (closing references for issues; the PR itself for PR items) */
  pullRequests: BoardPullRequest[];
  /** Full session UUIDs from `<!-- mw-board:start session=<uuid> -->` comments */
  mwBoardSessions: string[];
  /** All `<!-- mw-board:<kind> k=v -->` markers of the last 20 comments, in comment order */
  mwMarkers: MwMarker[];
  updatedAt: string;
  closedAt: string | null;
}

export interface BoardData {
  source: BoardSource;
  projectId: string;
  title: string;
  statusField: { id: string; options: BoardStatusOption[] };
  items: BoardItem[];
  /** epoch ms of the GitHub fetch behind this response */
  fetchedAt: number;
}

/** Pickable values of a repo (GET /api/board/repo-options) */
export interface BoardRepoOptions {
  repositoryId: string;
  labels: (BoardLabel & { id: string })[];
  assignees: { id: string; login: string }[];
  milestones: { id: string; title: string }[];
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

/** Issue that is not on the board, as the issue modal shows it (GET /api/board/issue) */
export interface IssueSummary {
  issueId: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  labels: BoardLabel[];
}

/** Lazily loaded issue parts (GET /api/board/issues/:issueId) */
export interface BoardIssueDetails {
  body: string;
  subIssues: (BoardIssueRef & { id: string; state: string })[];
}

/** Editable issue fields by name; labels/assignees replace the whole set */
export interface BoardIssueFields {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
}

export interface BoardIssueCreate extends BoardIssueFields {
  repo: string;
  title: string;
  /** Default: "Backlog" */
  statusOptionId?: string;
  /** Resume: the issue exists already (failed project step), only put it on the board */
  issueId?: string;
}

export interface BoardIssuePatch extends BoardIssueFields {
  state?: 'OPEN' | 'CLOSED';
  stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE';
  parent?: { repo: string; number: number } | null;
  addSubIssue?: { repo: string; number: number };
  /** Issue node id of the sub-issue to detach */
  removeSubIssue?: string;
}

export type BoardSliceKind = 'repo' | 'label' | 'milestone' | 'assignee';

/** Project context (#97): a title bar tab with its own favorites, board slices and agent tabs */
export interface ProjectContext {
  id: string;
  name: string;
  /** Member projects (app ids); null = every project */
  appIds: string[] | null;
  /** Board slice keys ("label:epic-x"); empty = whole board */
  boardFilter: string[];
}
export type BoardSwimlaneMode = 'parent' | 'repo' | 'none';

/** Persisted board preferences. Slice keys are `${kind}:${value}`, e.g. "repo:hpmartini/DevHub". */
export interface BoardSettings {
  source: BoardSource;
  favorites: string[];
  order: string[];
  hidden: string[];
}
