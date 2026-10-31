// Checks that the GitHub Actions workflows follow R-21 (docs/00-requirements.md) and the hardening this repository uses:
// - every external Action is pinned to a 40-hex commit SHA: each `uses:` value where GitHub runs one (a job's
//   `uses`, a step's `uses`), and in the steps of the local actions (`uses: ./…`) it calls, followed through their
//   action.yml; a `uses` key anywhere else (an env variable, an input) is only data;
// - the workflow-wide default permissions are `contents: read` and nothing else;
// - no workflow runs on `pull_request_target`.
// Workflows are read with a YAML parser, so every form GitHub accepts (flow mappings, quoted keys, comments) is
// checked by its value; a file that does not parse is a problem.
// Usage: node scripts/check-workflows.mjs [repository root] (default "."; the workflows are in .github/workflows).
// Exit codes: 0 OK, 1 a problem was found, 2 the check could not be done.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

const root = resolve(process.argv[2] ?? ".");
const dir = join(root, ".github", "workflows");
let names;
try {
  names = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
} catch {
  console.error(`check-workflows: cannot read ${dir}`);
  process.exitCode = 2;
}

const problems = [];
const visited = new Set();
/** A path as messages show it: relative to the repository root. */
const rel = (path) => relative(root, path);

/** The parsed value of a YAML file, or undefined (with a problem) if it does not parse to a mapping. */
function load(path) {
  const doc = parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true, merge: true });
  if (doc.errors.length > 0) {
    problems.push(`${rel(path)}: not valid YAML (${doc.errors[0].message.split("\n")[0]})`);
    return undefined;
  }
  let value;
  try {
    value = doc.toJS(); // throws on too many alias expansions
  } catch (e) {
    problems.push(`${rel(path)}: cannot be read (${e.message})`);
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${rel(path)}: not a mapping`);
    return undefined;
  }
  return value;
}

const isMapping = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** The `uses` values of a list of steps (steps that are not mappings, or have no `uses`, run no Action). */
const stepUses = (steps) => (Array.isArray(steps) ? steps.filter((s) => isMapping(s) && "uses" in s).map((s) => s.uses) : []);
/** The `uses` values GitHub runs in a workflow: jobs.<id>.uses (a reusable workflow) and jobs.<id>.steps[*].uses. */
const workflowUses = (workflow) =>
  isMapping(workflow.jobs) ? Object.values(workflow.jobs).filter(isMapping).flatMap((job) => [...("uses" in job ? [job.uses] : []), ...stepUses(job.steps)]) : [];
/** The `uses` values GitHub runs in a composite action: runs.steps[*].uses. */
const actionUses = (action) => (isMapping(action.runs) ? stepUses(action.runs.steps) : []);

/** Checks `uses:` values from a workflow or action file, following local actions. */
function checkUses(path, list) {
  for (const uses of list) {
    if (typeof uses !== "string") {
      problems.push(`${path}: a uses: value that is not a string`);
    } else if (uses.startsWith("./")) {
      checkLocal(path, uses);
    } else if (uses.startsWith("docker://")) {
      if (!/@sha256:[0-9a-f]{64}$/.test(uses)) problems.push(`${path}: Docker image not pinned to a digest: ${uses}`);
    } else if (!/^[^@\s]+@[0-9a-f]{40}$/.test(uses)) {
      problems.push(`${path}: Action not pinned to a commit SHA: ${uses}`);
    }
  }
}

/** A local action (a directory with action.yml or action.yaml) or a local reusable workflow, relative to the root. */
function checkLocal(from, uses) {
  const target = resolve(root, uses);
  if (/\.ya?ml$/.test(uses)) {
    // A reusable workflow: GitHub only runs those from .github/workflows, which are all checked here
    if (!(target.startsWith(dir + "/") && existsSync(target))) problems.push(`${from}: local workflow not found in ${rel(dir)}: ${uses}`);
    return;
  }
  const file = ["action.yml", "action.yaml"].map((n) => join(target, n)).find((f) => existsSync(f) && statSync(f).isFile());
  if (!file) {
    problems.push(`${from}: local action not found: ${uses}`);
    return;
  }
  if (visited.has(file)) return;
  visited.add(file);
  const action = load(file);
  if (action) checkUses(`${rel(file)} (used by ${from})`, actionUses(action));
}

/** The event names of a workflow's `on:` in its three forms: a name, a list of names, or a mapping. */
function eventsOf(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.filter((e) => typeof e === "string");
  if (on !== null && typeof on === "object") return Object.keys(on);
  return [];
}

if (names) {
  if (names.length === 0) problems.push(`${dir}: no workflow files`);
  for (const name of names) {
    const workflow = load(join(dir, name));
    if (!workflow) continue;
    const path = rel(join(dir, name));
    checkUses(path, workflowUses(workflow));
    if (eventsOf(workflow.on).includes("pull_request_target")) problems.push(`${path}: pull_request_target is not used here`);
    const permissions = workflow.permissions;
    if (permissions === undefined) {
      problems.push(`${path}: no workflow-wide permissions`);
    } else {
      const ok = permissions !== null && typeof permissions === "object" && !Array.isArray(permissions) && Object.keys(permissions).length === 1 && permissions.contents === "read";
      if (!ok) problems.push(`${path}: workflow-wide permissions must be "contents: read" only (found: ${JSON.stringify(permissions)})`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exitCode = 1;
  } else {
    console.log(`check-workflows: OK (${names.length} workflow files)`);
  }
}
