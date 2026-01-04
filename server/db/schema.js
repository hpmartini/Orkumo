import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, decimal, serial, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Applications table - stores discovered app information
 */
export const applications = pgTable('applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  path: text('path').notNull().unique(),
  type: varchar('type', { length: 50 }), // 'node', 'python', 'docker', 'static', etc.
  framework: varchar('framework', { length: 100 }), // 'nextjs', 'vite', 'flask', 'django', etc.

  // Configuration
  startCommand: text('start_command'),
  defaultPort: integer('default_port'),
  customPort: integer('custom_port'),
  envFile: text('env_file'),

  // User preferences
  isFavorite: boolean('is_favorite').default(false),
  isArchived: boolean('is_archived').default(false),
  displayOrder: integer('display_order'),

  // Metadata (stored as JSONB for flexibility)
  packageJson: jsonb('package_json'),
  detectedScripts: jsonb('detected_scripts'),
  aiAnalysis: text('ai_analysis'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
});

/**
 * Application runs/history - tracks app execution history
 */
export const appRuns = pgTable('app_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  appId: uuid('app_id').references(() => applications.id, { onDelete: 'cascade' }),

  status: varchar('status', { length: 50 }), // 'running', 'stopped', 'error', 'crashed'
  pid: integer('pid'),
  port: integer('port'),

  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  exitCode: integer('exit_code'),

  // Resource usage snapshots (stored as averages)
  avgCpuUsage: decimal('avg_cpu_usage', { precision: 5, scale: 2 }),
  avgMemoryMb: integer('avg_memory_mb'),
  peakCpuUsage: decimal('peak_cpu_usage', { precision: 5, scale: 2 }),
  peakMemoryMb: integer('peak_memory_mb'),
});

/**
 * Port allocations - for conflict management
 */
export const portAllocations = pgTable('port_allocations', {
  port: integer('port').primaryKey(),
  appId: uuid('app_id').references(() => applications.id, { onDelete: 'set null' }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow(),
  isSystemPort: boolean('is_system_port').default(false),
  notes: text('notes'),
});

/**
 * Terminal sessions - for persistent terminals
 */
export const terminalSessions = pgTable('terminal_sessions', {
  id: text('id').primaryKey(),
  appId: uuid('app_id').references(() => applications.id, { onDelete: 'set null' }),
  cwd: text('cwd').notNull(),
  shell: text('shell').default('/bin/bash'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastActivity: timestamp('last_activity', { withTimezone: true }).defaultNow(),
  isActive: boolean('is_active').default(true),

  // Store output buffer as JSONB array for session recovery
  outputBuffer: jsonb('output_buffer'),
  bufferSize: integer('buffer_size').default(10000),
});

/**
 * Tags for organization
 */
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  color: varchar('color', { length: 7 }), // hex color like '#FF5733'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/**
 * Many-to-many relationship between apps and tags
 */
export const appTags = pgTable('app_tags', {
  appId: uuid('app_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.appId, table.tagId] }),
}));

/**
 * System configuration
 */
export const systemConfig = pgTable('system_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
