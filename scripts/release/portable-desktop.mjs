#!/usr/bin/env node
// Pack a flat portable folder for the desktop app: the application, its bundled
// wx CLI, the media helpers and their licenses, all in one directory. Scoop can
// install this directly instead of unpacking an NSIS installer.
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  cp,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

const option = (name) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const target = option('--target');
const version = option('--version');
const output = option('--output');
if (!target || !version || !output) {
  throw new Error('Usage: scripts/release/portable-desktop.mjs --target RUST_TARGET --version VERSION --output DIR');
}

const repository = resolve(import.meta.dirname, '../..');
const appTargetDir = join(repository, 'packages/desktop/src-tauri/target', target, 'release');
const binaries = join(repository, 'packages/desktop/src-tauri/binaries');
const resources = join(repository, 'packages/desktop/src-tauri/resources');
const sounds = join(repository, 'packages/desktop/src-tauri/sounds');

const appExe = join(appTargetDir, `agent-wechat${target.includes('windows') ? '.exe' : ''}`);
const wxExe = join(binaries, `wx-${target}${target.includes('windows') ? '.exe' : ''}`);
const ffmpegExe = join(binaries, `ffmpeg-${target}${target.includes('windows') ? '.exe' : ''}`);
const ffprobeExe = join(binaries, `ffprobe-${target}${target.includes('windows') ? '.exe' : ''}`);

for (const path of [appExe, wxExe, ffmpegExe, ffprobeExe]) {
  if (!(await stat(path)).isFile()) throw new Error(`Missing desktop component: ${path}`);
}

const staging = join(resolve(output), `.portable-stage-${process.pid}`);
await mkdir(staging, { recursive: true });

const copyExecutable = async (source, name) => {
  await cp(source, join(staging, name));
  if (!target.includes('windows')) {
    const { chmod } = await import('node:fs/promises');
    await chmod(join(staging, name), 0o755);
  }
};

await copyExecutable(appExe, basename(appExe));
await copyExecutable(wxExe, 'wx.exe');
await copyExecutable(ffmpegExe, 'ffmpeg.exe');
await copyExecutable(ffprobeExe, 'ffprobe.exe');

// Keep the licensing and provenance material beside the binaries that need it.
for (const directory of [resources, sounds]) {
  try {
    for (const name of await readdir(directory)) await cp(join(directory, name), join(staging, name));
  } catch {
    // Sounds are optional; licenses are staged by prepare-sidecars below.
  }
}
try {
  await cp(
    join(repository, 'packages/cli/THIRD_PARTY_NOTICES.txt'),
    join(staging, 'THIRD-PARTY-NOTICES.txt'),
  );
} catch {}

const architecture = target.includes('x86_64') ? 'x64' : 'arm64';
const archiveName = `AgentWechat-v${version}-windows-portable-${architecture}.zip`;
const archivePath = join(resolve(output), archiveName);

// Zip through Python so the archive is built the same way on every runner and its
// entries are stored flat, without a wrapper directory and without swallowing the
// archive itself.
const { execFileSync } = await import('node:child_process');
const zipScript = [
  'import os, sys, zipfile',
  'root, output = sys.argv[1], sys.argv[2]',
  'with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:',
  '    for base, directories, names in os.walk(root):',
  '        directories.sort()',
  '        for name in sorted(names):',
  '            path = os.path.join(base, name)',
  '            archive.write(path, os.path.relpath(path, root))',
].join('\n');
execFileSync('python', ['-c', zipScript, staging, archivePath], { stdio: 'inherit' });

const bytes = await readFile(archivePath);
const digest = createHash('sha256').update(bytes).digest('hex');
await rm(staging, { recursive: true, force: true });
console.log(`Portable archive: ${archiveName} (${bytes.length} bytes, sha256 ${digest})`);
