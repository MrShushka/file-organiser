import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { listFiles, daysSince } from './utils.js';

export class Cleanup extends EventEmitter {
  /** Finds files whose mtime is older than `days` days. */
  async find(directory, days) {
    const root = path.resolve(directory);
    const paths = await listFiles(root);
    const oldFiles = [];

    for (const filePath of paths) {
      try {
        const stats = await fs.stat(filePath);
        const daysOld = daysSince(stats.mtime);
        if (daysOld > days) {
          const file = { path: filePath, size: stats.size, mtime: stats.mtime, daysOld: Math.floor(daysOld) };
          oldFiles.push(file);
          this.emit('file-found', file);
        }
      } catch (error) {
        this.emit('file-error', { path: filePath, error });
      }
    }

    oldFiles.sort((a, b) => b.daysOld - a.daysOld);
    return oldFiles;
  }

  /** Actually deletes the given files (fs.unlink). */
  async delete(files) {
    const total = files.length;
    let deleted = 0;
    let freed = 0;
    let failed = 0;
    let processed = 0;

    for (const file of files) {
      processed++;
      try {
        await fs.unlink(file.path);
        deleted++;
        freed += file.size;
        this.emit('file-deleted', { ...file, processed, total });
      } catch (error) {
        failed++;
        this.emit('file-error', { path: file.path, error, processed, total });
      }
    }

    const result = { deleted, failed, freed, total };
    this.emit('cleanup-complete', result);
    return result;
  }
}
