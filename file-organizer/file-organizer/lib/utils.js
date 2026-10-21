import fs from 'fs/promises';
import path from 'path';

export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const DAY_MS = 1000 * 60 * 60 * 24;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total > 0 ? current / total : 1;
  const filled = Math.round(percentage * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${current}/${total}`;
}

export function daysSince(date) {
  return (Date.now() - date.getTime()) / DAY_MS;
}

/** Throws ENOTDIR if the path exists but is not a directory (ENOENT/EACCES come from fs.stat). */
export async function assertDirectory(directory) {
  const stats = await fs.stat(directory);
  if (!stats.isDirectory()) {
    const error = new Error(`Not a directory: ${directory}`);
    error.code = 'ENOTDIR';
    throw error;
  }
}

/**
 * Recursively lists all regular files (absolute paths).
 * `exclude` – optional directory whose contents must be skipped.
 */
export async function listFiles(directory, { exclude } = {}) {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? entry.path;
    const full = path.join(parent, entry.name);
    if (exclude && (full === exclude || full.startsWith(exclude + path.sep))) continue;
    files.push(full);
  }
  return files;
}

/** Human-readable explanation for a Node.js file-system error. */
export function describeError(error, target = '') {
  const t = target ? `: ${target}` : '';
  switch (error.code) {
    case 'ENOENT': return `File or directory not found${t}`;
    case 'EACCES': return `Permission denied${t}`;
    case 'EPERM': return `Operation not permitted${t}`;
    case 'ENOTDIR': return `Not a directory${t}`;
    case 'EISDIR': return `Expected a file but found a directory${t}`;
    case 'EEXIST': return `Already exists${t}`;
    case 'ENOSPC': return `No space left on device${t}`;
    case 'EMFILE': return `Too many open files${t}`;
    case 'EBUSY': return `Resource is busy or locked${t}`;
    default: return `Unexpected error${t} (${error.code ?? 'no code'}): ${error.message}`;
  }
}

/** Prints an error and exits with code 1. */
export function fail(error, target = '') {
  console.error(`❌ Error: ${describeError(error, target)}`);
  process.exit(1);
}
