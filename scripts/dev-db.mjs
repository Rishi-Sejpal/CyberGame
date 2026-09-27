#!/usr/bin/env node
/**
 * Local MongoDB for development.
 *
 *   node scripts/dev-db.mjs          start (foreground, Ctrl-C to stop)
 *   node scripts/dev-db.mjs start    start in the background
 *   node scripts/dev-db.mjs stop     stop it
 *   node scripts/dev-db.mjs status   report whether it is up
 *
 * Why a script instead of "just run mongod": the port, the dbpath and the log
 * file have to agree with `MONGODB_URI` in `.env.example`, and a contributor who
 * guesses wrong gets a connection error that looks like an application bug. This
 * keeps the one true location in one place and prints it.
 *
 * The test suite does not use this: `tests/setup/global.ts` boots its own
 * throwaway instance on a different port so a dev database is never at risk.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DBPATH = join(ROOT, '.mongo');
const LOGPATH = join(ROOT, '.mongo', 'mongod.log');
/**
 * mongod's own pid file. Using it rather than one of our own means there is a
 * single source of truth: whatever pid mongod recorded is the pid we signal.
 */
const LOCKPATH = join(DBPATH, 'mongod.lock');
const PORT = 27018;
const HOST = '127.0.0.1';

/** Where a packaged mongod usually lives, if it is not already on PATH. */
const CANDIDATE_BINARIES = [
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
  '/opt/homebrew/bin/mongod',
  '/opt/homebrew/opt/mongodb-community/bin/mongod',
  'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe',
];

function findBinary() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mongod'], {
    encoding: 'utf8',
  });
  if (which.status === 0) {
    const first = which.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  return CANDIDATE_BINARIES.find((candidate) => existsSync(candidate)) ?? null;
}

function readPid() {
  if (!existsSync(LOCKPATH)) return null;
  const raw = Number.parseInt(readFileSync(LOCKPATH, 'utf8').trim(), 10);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

function isAlive(pid) {
  try {
    // Signal 0 performs the permission/existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portInUse(port) {
  return new Promise((resolvePort) => {
    const socket = net.connect({ port, host: HOST });
    const finish = (inUse) => {
      socket.destroy();
      resolvePort(inUse);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * A lock file left behind by a crash. mongod removes its own on a clean exit, so
 * a lock naming a dead pid means the previous run did not shut down; removing it
 * is what allows a restart.
 */
function clearStaleLock() {
  const pid = readPid();
  if (pid === null || !isAlive(pid)) {
    if (existsSync(LOCKPATH)) unlinkSync(LOCKPATH);
  }
}

function baseArgs() {
  return ['--dbpath', DBPATH, '--port', String(PORT), '--bind_ip', HOST, '--logpath', LOGPATH];
}

async function start({ background }) {
  clearStaleLock();

  if (await portInUse(PORT)) {
    console.error(`Port ${PORT} is already in use.`);
    console.error('  • If that is this project\'s mongod, run `npm run db:stop` first.');
    console.error('  • If it is something else, point MONGODB_URI at that port instead.');
    process.exit(1);
  }

  const binary = findBinary();
  if (!binary) {
    console.error('Could not find `mongod`.');
    console.error('  • Install MongoDB 7 or newer, or');
    console.error('  • point MONGODB_URI at a MongoDB you already run (Docker, Atlas, a VM).');
    process.exit(1);
  }

  mkdirSync(DBPATH, { recursive: true });

  const args = background ? [...baseArgs(), '--fork'] : baseArgs();
  const child = spawn(binary, args, { stdio: background ? 'ignore' : 'inherit' });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  if (background) {
    // `--fork` daemonises: the parent waits for the child to be ready, so its
    // exit status is the signal that startup succeeded.
    await new Promise((r) => child.on('exit', r));
    if (child.exitCode !== 0) {
      console.error(`mongod exited with code ${child.exitCode}. See ${LOGPATH}.`);
      process.exit(1);
    }
    console.log(`mongod listening on mongodb://${HOST}:${PORT}`);
    console.log(`  dbpath  ${DBPATH}`);
    console.log(`  log     ${LOGPATH}`);
    console.log('\nSet MONGODB_URI=mongodb://127.0.0.1:27018/cybergrid in .env.local');
    return;
  }

  const stop = () => {
    if (!exited) child.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`mongod listening on mongodb://${HOST}:${PORT} (Ctrl-C to stop)`);
  await new Promise((r) => child.on('exit', r));
}

async function stop() {
  clearStaleLock();
  const pid = readPid();
  if (pid === null) {
    console.log('No lock file: the local mongod does not appear to be running.');
    return;
  }

  process.kill(pid, 'SIGINT');
  // Wait for a clean shutdown so WiredTiger is not left mid-checkpoint.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (!isAlive(pid)) break;
  }
  if (isAlive(pid)) {
    console.error(`Sent SIGINT to ${pid} but it is still running after 15s.`);
    console.error('  Check the log before escalating to SIGKILL; a kill mid-write');
    console.error('  forces journal recovery on the next start.');
    process.exit(1);
  }
  console.log('mongod stopped.');
}

async function status() {
  const up = await portInUse(PORT);
  const pid = readPid();
  console.log(`mongod on ${HOST}:${PORT}: ${up ? 'running' : 'not running'}${pid ? ` (pid ${pid})` : ''}`);
  if (!up) process.exitCode = 1;
}

const command = process.argv[2] ?? 'start';
if (command === 'start') await start({ background: process.argv.includes('--bg') || process.env.CG_DB_BG === '1' });
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/dev-db.mjs [start [--bg] | stop | status]');
  process.exit(1);
}
