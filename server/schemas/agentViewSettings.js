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
    cardDetails: z.enum(['hover', 'click', 'always']).optional(),
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
          ].map((k) => [
            k,
            z.enum(['left', 'title', 'row2', 'row3', 'row4', 'details', 'hidden']).optional(),
          ])
        )
      )
      .strict()
      .optional(),
    disabled: z.boolean().optional(),
    dispatch: z
      .object({
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
