// Builds the Monitor desktop app (Tauri): the server as dist/Monitor.exe,
// copied in as the app's "sidecar", then the window app and its installer.
//
//   npm run build:app
//
// Needs Rust (rustup) and the Visual Studio C++ build tools. Output:
// src-tauri/target/release/bundle/nsis/Monitor_<version>_x64-setup.exe

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const ROOT = __dirname;

// rustup installs to ~/.cargo/bin, which isn't always on PATH (e.g. a terminal
// opened before the install).
const cargoBin = path.join(process.env.CARGO_HOME || path.join(require('node:os').homedir(), '.cargo'), 'bin');
if (fs.existsSync(cargoBin)) process.env.PATH = cargoBin + path.delimiter + process.env.PATH;

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

// 1. The server, as a single exe.
execFileSync(process.execPath, [path.join(ROOT, 'build-exe.js')], { cwd: ROOT, stdio: 'inherit' });

// 2. Tauri looks for sidecars named after the Rust target triple.
const triple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const binDir = path.join(ROOT, 'src-tauri', 'binaries');
fs.mkdirSync(binDir, { recursive: true });
const ext = process.platform === 'win32' ? '.exe' : '';
fs.copyFileSync(path.join(ROOT, 'dist', `Monitor${ext}`), path.join(binDir, `monitor-server-${triple}${ext}`));
console.log(`Copied the server to src-tauri/binaries/monitor-server-${triple}${ext}`);

// 3. The app and its installer.
run('npx tauri build');
