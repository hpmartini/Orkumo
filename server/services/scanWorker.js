/**
 * Scan child of scannerService.runScanJob: runs one job from argv[2] (JSON) and writes its result as
 * JSON to stdout. Its own process, so a root on a hung mount can be killed instead of blocking the
 * server (bundled next to dist-server/index.js).
 */
import { presetDockerAvailable, scanAgentRepos, scanRoot } from './scannerService.js';

const job = JSON.parse(process.argv[2]);
presetDockerAvailable(job.docker);
const result =
  job.job === 'agents'
    ? scanAgentRepos(job.known, job.mains)
    : scanRoot(job.root, job.maxDepth, job.excludePatterns);
process.stdout.write(JSON.stringify(result));
