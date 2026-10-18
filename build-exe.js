// Builds dist/Monitor.exe: a copy of node.exe with server.js and everything in
// public/ embedded (Node "single executable application").
//
//   npm run build:exe
//
// The exe reads cameras.json from its own folder (and creates one if missing);
// in dist/ it uses the project's cameras.json instead.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const EXE_NAME = process.platform === 'win32' ? 'Monitor.exe' : 'monitor';
const EXE = path.join(DIST, EXE_NAME);
const BLOB = path.join(DIST, 'sea-prep.blob');
const SEA_CONFIG = path.join(DIST, 'sea-config.json');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

async function main() {
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Embed every file in public/ as an asset, keyed by its path ("fonts/x.woff2").
  const publicDir = path.join(ROOT, 'public');
  const assets = Object.fromEntries(listFiles(publicDir).map((rel) => [rel, path.join(publicDir, rel)]));
  fs.writeFileSync(
    SEA_CONFIG,
    JSON.stringify({ main: path.join(ROOT, 'server.js'), output: BLOB, disableExperimentalSEAWarning: true, assets }, null, 2),
  );
  console.log(`Embedding server.js + ${Object.keys(assets).length} web files`);
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], { stdio: 'inherit' });

  // 2. Copy the node binary and inject the blob into it.
  try {
    fs.copyFileSync(process.execPath, EXE);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      console.error(`\n${EXE_NAME} is in use. Close the running Monitor window and build again.`);
      process.exit(1);
    }
    throw e;
  }
  let inject;
  try {
    ({ inject } = require('postject'));
  } catch {
    console.error('\npostject is missing. Run "npm install" first.');
    process.exit(1);
  }
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(BLOB), {
    sentinelFuse: FUSE,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });

  // No cameras.json is copied: in dist/ the exe uses the project's own one. Copied
  // elsewhere on its own, it creates one next to itself (or use a copied one).

  fs.rmSync(BLOB, { force: true });
  fs.rmSync(SEA_CONFIG, { force: true });
  console.log(`\nBuilt ${path.relative(ROOT, EXE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
