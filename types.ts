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
  detectedFramework?: string;
  isFavorite?: boolean;
  // Docker Compose specific fields
  dockerComposeFile?: string; // Path to compose file (docker-compose.yml, compose.yaml, etc.)
  dockerServices?: DockerService[]; // List of services defined in compose file
  /** Main checkouts this project covers: its own path plus those of projects merged into it */
  paths?: string[];
  /** Linked git worktrees of those checkouts: they belong to the project, never form their own */
  worktrees?: string[];
  /** Those of `worktrees` whose folder is gone (git lists them until pruned) */
  missingWorktrees?: string[];
  /** Ids of projects merged into this one; a context naming one of them means this project */
  mergedIds?: string[];
  /** The user chose the name (rename or own project): it wins over the GitHub repo title */
  userNamed?: boolean;
  source?: ProjectSource;
}

/** detected = a git main checkout the scan found, custom = added by the user */
export type ProjectSource = 'detected' | 'custom';
export type ProjectState = 'active' | 'disabled' | 'merged';

/** A project in the project settings (GET /api/projects), disabled and merged ones included */
export interface ProjectEntry {
  id: string;
  name: string;
  /** Name before a rename */
  detectedName: string;
  path: string;
  paths: string[];
  worktrees: string[];
  source: ProjectSource;
  state: ProjectState;
  /** Final target of a merge */
  mergedInto: string | null;
  userNamed: boolean;
  detectedFramework?: string;
  /** Agent sessions running in it, from the server's last agent contexts; null when unknown */
  sessionCount: number | null;
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
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  goToDashboard: { key: 'h', description: 'Go to dashboard' },
  goToDashboardAlt: { key: 'd', description: 'Go to dashboard' },
  openSettings: { key: 's', description: 'Open settings' },
  openSettingsAlt: { key: ',', modifiers: { meta: true }, description: 'Open settings (Cmd+,)' },
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
};

// ---------------------------------------------------------------------------
// Agent Task Board (/board, #44). Source of truth: GitHub Project (GraphQL via gh).
// ---------------------------------------------------------------------------

export interface BoardSource {
  owner: string;
  /** Project number, e.g. 4 for users/hpmartini/projects/4 (MACC) */
  number: number;
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

/** Workflow state of an issue, as the workflow provider's `annotate` returns it (docs/WORKFLOW_PROVIDER.md) */
export interface BoardWorkflow {
  state: {
    stage: string;
    waitingOn: 'owner' | 'agent' | 'poll' | null;
    reason: string;
    since: string | null;
    /** GO the owner can give now; `panel`: also offered in the issue panel */
    go: { kind: string; text: string; panel?: boolean } | null;
    error: { label: string; note: string; at: string | null } | null;
    [extra: string]: unknown;
  };
  /** Agent session UUIDs working on the issue */
  sessionIds: string[];
}

export interface WorkflowControlButton {
  label: string;
  text: string;
  hint: string;
}

export interface WorkflowControls {
  toggles?: WorkflowControlButton[];
  start?: WorkflowControlButton;
  feedback?: WorkflowControlButton[];
  modes?: { options: { text: string; label: string | null }[]; drop?: string[] };
  waiting?: { label: string; text: string };
}

/** `GET /api/workflow` -> `provider` */
export interface WorkflowProviderInfo {
  name: string;
  apiVersion: number;
  stages: { id: string; label: string; hint?: string }[];
  controls: WorkflowControls | null;
  /** Regex source for agent session names (groups: repo, number, title) */
  sessionName: string | null;
}

/** What starting an issue did */
export interface StartResult {
  action: 'start' | 'resume' | 'queued' | 'none';
  reason: string;
  full?: boolean;
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
  /** Workflow state from the provider; null without provider or outside the workflow */
  workflow: BoardWorkflow | null;
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

export type RepoIssueState = 'open' | 'closed';

/** An issue of a context repo, on the board or not (Issues mode, GET /api/issues) */
export interface RepoIssue {
  id: string;
  /** "owner/name" */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: RepoIssueState;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: string | null;
  labels: BoardLabel[];
  assignees: string[];
  milestone: string | null;
  comments: number;
  /** Item of the configured board project (settings board source) */
  onBoard: boolean;
}

export interface IssueListResponse {
  /** Repos of the context that were queried */
  repos: string[];
  issues: RepoIssue[];
  /** Repos whose listing failed; the others are still listed */
  errors: { repo: string; message: string }[];
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

/** Persisted board preferences. Slice keys are `${kind}:${value}`, e.g. "repo:hpmartini/Orkumo". */
export interface BoardSettings {
  source: BoardSource;
  favorites: string[];
  order: string[];
  hidden: string[];
}
