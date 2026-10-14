// Workspace housekeeping for the settings page: sizes, metrics cache and the .trash folder only.
import fs from "node:fs";
import { join } from "node:path";

const SCENARIO = /^[a-f0-9]{32}$/;

/** Bytes under `path`, never following symlinks (a link counts as its own entry). */
function bytes(path) {
  let stat;
  try { stat = fs.lstatSync(path); } catch { return 0; }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of fs.readdirSync(path)) total += bytes(join(path, name));
  return total;
}

const entries = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const isDir = (path) => { try { return fs.lstatSync(path).isDirectory(); } catch { return false; } };

export function storageInfo(workspace) {
  const scenarios = entries(workspace).filter(n => SCENARIO.test(n) && isDir(join(workspace, n)));
  let metricsBytes = 0, scenarioBytes = 0;
  for (const id of scenarios) {
    const metrics = bytes(join(workspace, id, "metrics"));
    metricsBytes += metrics;
    scenarioBytes += bytes(join(workspace, id)) - metrics;
  }
  const trash = join(workspace, ".trash");
  return { workspace, scenarios: scenarios.length, scenarioBytes, metricsBytes,
    trashBytes: bytes(trash), trashItems: isDir(trash) ? entries(trash).length : 0 };
}

/** Removes only `<workspace>/<scenario id>/metrics` directories; scenario packages stay intact. */
export function clearMetricsCache(workspace) {
  let removed = 0;
  for (const id of entries(workspace).filter(n => SCENARIO.test(n))) {
    const metrics = join(workspace, id, "metrics");
    if (isDir(join(workspace, id)) && isDir(metrics)) { fs.rmSync(metrics, { recursive: true, force: true }); removed++; }
  }
  return { removed };
}

/** Permanently deletes what earlier scenario deletes moved into `<workspace>/.trash`. */
export function emptyTrash(workspace) {
  const trash = join(workspace, ".trash");
  if (!isDir(trash)) return { removed: 0 };
  const names = entries(trash);
  for (const name of names) fs.rmSync(join(trash, name), { recursive: true, force: true });
  return { removed: names.length };
}
