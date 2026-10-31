// Tests for check-workflows.mjs: each rule is broken once in a workflow of its own, in each YAML form GitHub reads
// the same way; equivalent forms of a passing workflow pass; and the real workflows pass.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/check-workflows.mjs");
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const GOOD = `name: x
on:
  push:
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    permissions:
      pages: write
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: ./local-action
`;
const LOCAL_ACTION = `name: local
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${SHA}
`;

/** Runs the check on a new repository root holding `files` (paths relative to the root). */
function run(files) {
  const root = mkdtempSync(join(tmpdir(), "check-workflows-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return spawnSync("node", [SCRIPT, root], { encoding: "utf8" });
}

const W = ".github/workflows";
const withGood = (files) => ({ [`${W}/a.yml`]: GOOD, "local-action/action.yml": LOCAL_ACTION, ...files });

describe("check-workflows (R-21)", () => {
  it("passes a workflow that follows every rule (job-level permissions may add more; a local action is followed)", () => {
    const r = run(withGood({}));
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("OK (1 workflow files)");
    expect(r.status).toBe(0);
  });

  it("passes the repository's own workflows", () => {
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  for (const [name, text] of [
    ["permissions as a flow mapping", GOOD.replace("permissions:\n  contents: read", "permissions: {contents: read}")],
    ["a blank line and a comment in the permissions", GOOD.replace("permissions:\n  contents: read", "permissions:\n\n  # the default\n  contents: read # only")],
    ["quoted permission keys and values", GOOD.replace("permissions:\n  contents: read", '"permissions":\n  "contents": "read"')],
    ["the forbidden words only in comments", GOOD.replace("on:\n", "# not pull_request_target\non:\n").replace("steps:\n", "steps:\n      # - uses: actions/checkout@v7\n")],
    ["a uses key that is only data (in env, and in a step's with)", GOOD.replace("jobs:\n", "env: { uses: harmless-input }\njobs:\n").replace("# v7.0.1\n", "# v7.0.1\n        with:\n          uses: actions/checkout@v7\n")],
    ["a digest-pinned Docker image", GOOD.replace("      - uses: ./local-action\n", `      - uses: ./local-action\n      - uses: docker://alpine@sha256:${"a".repeat(64)}\n`)],
  ]) {
    it(`passes ${name}`, () => {
      expect(text).not.toBe(GOOD); // the form really differs from GOOD
      const r = run(withGood({ [`${W}/b.yaml`]: text }));
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  }

  for (const [name, files, message] of [
    ["a tag instead of a SHA", { [`${W}/b.yaml`]: GOOD.replace(`@${SHA}`, "@v7") }, "not pinned"],
    ["a short SHA", { [`${W}/b.yaml`]: GOOD.replace(`@${SHA}`, `@${SHA.slice(0, 12)}`) }, "not pinned"],
    ["a quoted tag", { [`${W}/b.yaml`]: GOOD.replace(`actions/checkout@${SHA}`, '"actions/checkout@v7"') }, "not pinned"],
    ["a tag in a flow-mapping step", { [`${W}/b.yaml`]: GOOD.replace(`- uses: actions/checkout@${SHA} # v7.0.1`, "- { uses: actions/checkout@v7 }") }, "not pinned"],
    ["a tag under a quoted uses key", { [`${W}/b.yaml`]: GOOD.replace(`- uses: actions/checkout@${SHA}`, '- "uses": actions/checkout@v7') }, "not pinned"],
    ["a reusable workflow on a tag", { [`${W}/b.yaml`]: GOOD.replace("    runs-on: ubuntu-latest\n", "    uses: octo/repo/.github/workflows/x.yml@v1\n") }, "not pinned"],
    ["an unpinned Docker image", { [`${W}/b.yaml`]: GOOD.replace("      - uses: ./local-action\n", "      - uses: ./local-action\n      - uses: docker://alpine:3\n") }, "Docker image not pinned"],
    ["a tag inside a local composite action", { [`${W}/b.yaml`]: GOOD.replace("./local-action", "./other-action"), "other-action/action.yaml": LOCAL_ACTION.replace(`@${SHA}`, "@v7") }, "other-action/action.yaml (used by .github/workflows/b.yaml): Action not pinned"],
    ["a tag in a local action called by a local action", { [`${W}/b.yaml`]: GOOD.replace("./local-action", "./outer"), "outer/action.yml": LOCAL_ACTION.replace(`actions/setup-node@${SHA}`, "./inner"), "inner/action.yml": LOCAL_ACTION.replace(`@${SHA}`, "@v7") }, "inner/action.yml (used by outer/action.yml (used by .github/workflows/b.yaml)): Action not pinned"],
    ["a local action that does not exist", { [`${W}/b.yaml`]: GOOD.replace("./local-action", "./missing") }, "local action not found"],
    ["pull_request_target as a key", { [`${W}/b.yaml`]: GOOD.replace("  push:", "  pull_request_target:") }, "pull_request_target"],
    ["pull_request_target as a quoted key", { [`${W}/b.yaml`]: GOOD.replace("  push:", '  "pull_request_target":') }, "pull_request_target"],
    ["pull_request_target in a flow list", { [`${W}/b.yaml`]: GOOD.replace("on:\n  push:", "on: [push, pull_request_target]") }, "pull_request_target"],
    ["pull_request_target as the only event", { [`${W}/b.yaml`]: GOOD.replace("on:\n  push:", "on: pull_request_target") }, "pull_request_target"],
    ["no workflow-wide permissions", { [`${W}/b.yaml`]: GOOD.replace("permissions:\n  contents: read\n", "") }, "no workflow-wide permissions"],
    ["contents: write at the top", { [`${W}/b.yaml`]: GOOD.replace("permissions:\n  contents: read", "permissions:\n  contents: write") }, '"contents: read" only'],
    ["read-all at the top", { [`${W}/b.yaml`]: GOOD.replace("permissions:\n  contents: read", "permissions: read-all") }, '"contents: read" only'],
    ["an extra top-level permission", { [`${W}/b.yaml`]: GOOD.replace("  contents: read\n", "  contents: read\n  pages: write\n") }, '"contents: read" only'],
    ["an extra permission in a flow mapping", { [`${W}/b.yaml`]: GOOD.replace("permissions:\n  contents: read", "permissions: {contents: read, pages: write}") }, '"contents: read" only'],
    ["a duplicated key", { [`${W}/b.yaml`]: GOOD.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n  contents: write") }, "not valid YAML"],
    ["a file that is not YAML", { [`${W}/b.yaml`]: "on: [push\n" }, "not valid YAML"],
  ]) {
    it(`fails on ${name}`, () => {
      const r = run(withGood(files));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("b.yaml");
      expect(r.stderr).toContain(message);
      expect(r.stderr).not.toContain("a.yml");
    });
  }

  it("fails when there are no workflows, and stops with 2 when the directory cannot be read", () => {
    expect(run({}).status).toBe(1);
    expect(spawnSync("node", [SCRIPT, join(tmpdir(), "no-such-dir-xyz")], { encoding: "utf8" }).status).toBe(2);
  });
});
