/** Model × effort picker: one row per model, one column per effort level any model takes */

export interface HarnessModel {
  id: string;
  label: string;
  group: string;
  efforts: string[];
}

/** Low to high; levels a CLI names that are not listed here go to the end */
const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];

export function effortColumns(models: HarnessModel[]): string[] {
  const all = new Set(models.flatMap((m) => m.efforts));
  const known = EFFORT_ORDER.filter((l) => all.has(l));
  return [...known, ...[...all].filter((l) => !EFFORT_ORDER.includes(l))];
}

/**
 * The listed models plus `extra` names (aliases the CLI help does not mention), the extra ones
 * with the efforts of the first listed model; rows filtered on id, label and provider
 */
export function matrixRows(
  models: HarnessModel[],
  extra: string[],
  filter: string
): HarnessModel[] {
  const efforts = models[0]?.efforts ?? [];
  const group = models[0]?.group ?? '';
  const rows = [
    ...models,
    ...extra
      .filter((id) => !models.some((m) => m.id === id))
      .map((id) => ({ id, label: id, group, efforts })),
  ];
  const q = filter.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((m) => `${m.id} ${m.label} ${m.group}`.toLowerCase().includes(q));
}

/** Button text: `opus · high`, `default` for what the CLI picks itself */
export const pickLabel = (model: string, effort: string, defaultModel?: string | null) =>
  `${model || (defaultModel ? `default (${defaultModel})` : 'default')}${effort ? ` · ${effort}` : ''}`;
