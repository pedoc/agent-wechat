import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requiredNames = (version) => [
  `wx-v${version}-win32-x64.exe`,
  `wx-v${version}-win32-arm64.exe`,
  `AgentWechat-v${version}-windows-portable-x64.zip`,
  `AgentWechat-v${version}-windows-portable-arm64.zip`,
  `AgentWechat-v${version}-windows-x64-setup.exe`,
  `AgentWechat-v${version}-windows-arm64-setup.exe`,
];

async function stage(t, version = '3.0.0') {
  const root = await mkdtemp(join(tmpdir(), 'publish-checksums-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of requiredNames(version)) {
    await mkdir(join(root, 'cli'), { recursive: true });
    const bytes = Buffer.from(`synthetic ${name}`);
    await writeFile(join(root, 'cli', name), bytes);
  }
  return root;
}

// The script is a CLI entry point, so run it in a subprocess the way CI does.
async function run(directory, version, sourceCommit = 'a'.repeat(40)) {
  const { execFileSync } = await import('node:child_process');
  const script = join(import.meta.dirname, 'publish-checksums.mjs');
  return execFileSync(process.execPath, [script, directory, version], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_COMMIT: sourceCommit },
  });
}

test('every declared asset is hashed into one manifest carrying the build commit', async (t) => {
  const root = await stage(t);
  await run(root, '3.0.0', 'b'.repeat(40));
  const manifest = JSON.parse(await readFile(join(root, 'pedoc-windows-v3.0.0-checksums.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, '3.0.0');
  assert.equal(manifest.sourceCommit, 'b'.repeat(40));
  assert.deepEqual(manifest.assets.map((asset) => asset.file), requiredNames('3.0.0'));
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(root, 'cli', asset.file));
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
});

test('a missing required artifact refuses to publish', async (t) => {
  const root = await stage(t);
  const { rm: remove } = await import('node:fs/promises');
  await remove(join(root, 'cli', 'wx-v3.0.0-win32-arm64.exe'));
  await assert.rejects(() => run(root, '3.0.0'), /Missing required artifact: wx-v3\.0\.0-win32-arm64\.exe/);
});

test('an unexpected artifact refuses to publish rather than being silently uploaded', async (t) => {
  const root = await stage(t);
  await writeFile(join(root, 'cli', 'extra.txt'), 'not part of this release');
  await assert.rejects(() => run(root, '3.0.0'), /Unexpected artifact\(s\): extra\.txt/);
});
