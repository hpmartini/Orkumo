// Writes server/orchestrator/report.schema.json from the zod schema (single source of truth)
import fs from 'fs';
import { z } from 'zod';
import { reportSchema, REPORT_SCHEMA_VERSION } from '../server/services/orchestratorReport.js';

const out = new URL('../server/orchestrator/report.schema.json', import.meta.url);
const schema = {
  $id: `urn:orkumo:orchestrator-report:v${REPORT_SCHEMA_VERSION}`,
  title: 'Orkumo orchestrator report',
  ...z.toJSONSchema(reportSchema, { io: 'input' }),
};
fs.writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
