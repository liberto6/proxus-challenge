#!/usr/bin/env node
// Verifies the dependency rule between packages and server layers.
//
//   transport -> domain <- infra        (server)
//   web -> shared <- server             (packages)
//
// Rules are import-based: a file in a layer must not import from a layer it is
// not allowed to depend on. Files listed in KNOWN_EXCEPTIONS are reported but do
// not fail the check; each exception states why it exists and what removes it.
//
// Usage: node scripts/check-architecture.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = path.join(root, "packages");

const dirs = {
  shared: path.join(packages, "shared", "src"),
  web: path.join(packages, "web", "src"),
  server: path.join(packages, "server", "src"),
  domain: path.join(packages, "server", "src", "domain"),
  infra: path.join(packages, "server", "src", "infra"),
  transport: path.join(packages, "server", "src", "transport")
};

// Each rule: which files it applies to, and which targets are forbidden.
// `forbiddenDirs` are resolved relative imports; `forbiddenSpecifiers` are
// bare package specifiers (prefix match).
const rules = [
  {
    name: "shared must not depend on server or web",
    scope: dirs.shared,
    forbiddenDirs: [dirs.server, dirs.web],
    forbiddenSpecifiers: ["@proxus/server", "@proxus/web"]
  },
  {
    name: "web must not depend on server",
    scope: dirs.web,
    forbiddenDirs: [dirs.server],
    forbiddenSpecifiers: ["@proxus/server"]
  },
  {
    name: "domain must not depend on infra, transport or Node platform bindings",
    scope: dirs.domain,
    forbiddenDirs: [dirs.infra, dirs.transport],
    forbiddenSpecifiers: ["@effect/platform-node"]
  },
  {
    name: "infra must not depend on transport",
    scope: dirs.infra,
    forbiddenDirs: [dirs.transport],
    forbiddenSpecifiers: []
  }
];

// Files that break a rule on purpose today. Keep this list short and dated.
const KNOWN_EXCEPTIONS = new Map([]);

const importPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

const isInside = (file, dir) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const violations = [];

for (const rule of rules) {
  for (const file of walk(rule.scope)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;

      let reason;
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        const hit = rule.forbiddenDirs.find((dir) => isInside(target, dir));
        if (hit) reason = `imports ${path.relative(root, target).replaceAll("\\", "/")}`;
      } else {
        const hit = rule.forbiddenSpecifiers.find((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
        if (hit) reason = `imports ${specifier}`;
      }

      if (reason) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({ rule: rule.name, file: path.relative(root, file).replaceAll("\\", "/"), line, reason });
      }
    }
  }
}

const failures = violations.filter((v) => !KNOWN_EXCEPTIONS.has(v.file));
const exceptions = violations.filter((v) => KNOWN_EXCEPTIONS.has(v.file));

if (exceptions.length > 0) {
  console.log("Known exceptions (reported, not failing):");
  for (const v of exceptions) {
    console.log(`  ${v.file}:${v.line}  ${v.reason}\n    why: ${KNOWN_EXCEPTIONS.get(v.file)}`);
  }
  console.log("");
}

if (failures.length > 0) {
  console.error("Architecture rule violations:");
  for (const v of failures) {
    console.error(`  ${v.file}:${v.line}  ${v.reason}\n    rule: ${v.rule}`);
  }
  console.error(`\n${failures.length} violation(s). See AGENTS.md > Architecture.`);
  process.exit(1);
}

console.log(`Architecture check passed (${rules.length} rules, ${exceptions.length} known exception(s)).`);
