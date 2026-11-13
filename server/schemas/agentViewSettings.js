import { z } from 'zod';

export const optionalShortString = z.string().max(200).optional().nullable();

/** PUT /api/settings/agent-view body; strict, so every new preference must be listed here */
export const agentViewSettingsSchema = z
  .object({
    grouping: z.enum(['state', 'directory', 'project', 'none']).optional(),
    layout: z.enum(['tabs', 'columns', 'rows', 'grid']).optional(),
    scopeCwd: z.string().max(500).nullable().optional(),
    collapsedGroups: z.array(z.string().max(500)).max(200).optional(),
    notifications: z.boolean().optional(),
    desktopNotifications: z.boolean().optional(),
    cardDensity: z.enum(['comfortable', 'compact']).optional(),
    cardFields: z
      .object(
        Object.fromEntries(
          [
            'issue',
            'pr',
            'project',
            'branch',
            'git',
            'metrics',
            'status',
            'links',
            'servers',
            'subagents',
            'harness',
          ].map((k) => [
            k,
            z.enum(['left', 'title', 'row2', 'row3', 'row4', 'details', 'hidden']).optional(),
          ])
        )
      )
      .strict()
      .optional(),
    disabled: z.boolean().optional(),
    chatSubmitKey: z.enum(['enter', 'mod+enter']).optional(),
    chatShowSteps: z.boolean().optional(),
    agentOpenView: z.enum(['chat', 'terminal']).optional(),
    mainAgent: z
      .object({ name: z.string().trim().min(1).max(100), keepAlive: z.boolean() })
      .optional(),
    // Orchestrator sessions: row id, transcript uuid or pane id (orchestratorService.js)
    orchestrators: z
      .array(z.string().regex(/^[\w.:-]{1,200}$/))
      .max(200)
      .optional(),
    dispatch: z
      .object({
        harness: z.enum(['claude', 'omp', 'opencode', 'codex', 'pi']).optional(),
        model: optionalShortString,
        effort: optionalShortString,
        permissionMode: optionalShortString,
        agent: optionalShortString,
        fallbackModel: optionalShortString,
        skipPermissions: z.boolean().optional(),
        allowSkipPermissions: z.boolean().optional(),
        restricted: z.boolean().optional(),
        strictMcpConfig: z.boolean().optional(),
        settings: z.string().max(10000).optional().nullable(),
        addDirs: z.array(z.string().max(500)).max(20).optional(),
        pluginDirs: z.array(z.string().max(500)).max(20).optional(),
        mcpConfigs: z.array(z.string().max(10000)).max(20).optional(),
      })
      .optional(),
  })
  .strict();
