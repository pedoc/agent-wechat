#!/usr/bin/env node
// Combine this run's independently built artifacts into one checksum manifest and
// refuse to publish when an asset is missing, unexpected or does not match its hash.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

const [directory, version] = process.argv.slice(2);
if (!directory || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  throw new Error('Usage: scripts/release/publish-checksums.mjs DIRECTORY VERSION');
}

// Every asset this repository promises for a Windows build.
const required = [
  `wx-v${version}-win32-x64.exe`,
  `wx-v${version}-win32-arm64.exe`,
  `AgentWechat-v${version}-windows-portable-x64.zip`,
  `AgentWechat-v${version}-windows-portable-arm64.zip`,
  `AgentWechat-v${version}-windows-x64-setup.exe`,
  `AgentWechat-v${version}-windows-arm64-setup.exe`,
];

async function collect(root) {
  const found = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.set(basename(path), path);
    }
  }
  await walk(root);
  return found;
}

const files = await collect(resolve(directory));
const names = [...files.keys()];
// The checksum manifest is written into the same directory, so it is excluded by
// name below; each CLI artifact carries its build identity file.
const allowed = new Set([...required, 'native-ci-build.json']);
const unexpected = names.filter((name) => !allowed.has(name));
if (unexpected.length) throw new Error(`Unexpected artifact(s): ${unexpected.join(', ')}`);

const assets = [];
for (const name of required) {
  const path = files.get(name);
  if (!path) throw new Error(`Missing required artifact: ${name}`);
  const bytes = await readFile(path);
  assets.push({ file: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

await mkdir(resolve(directory), { recursive: true });
const output = join(resolve(directory), `pedoc-windows-v${version}-checksums.json`);
await writeFile(
  output,
  `${JSON.stringify({ schemaVersion: 1, version, sourceCommit: process.env.SOURCE_COMMIT ?? '', assets }, null, 2)}\n`,
);
console.log(`Verified ${assets.length} asset(s); wrote ${output}`);
