import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { listFiles, daysSince } from './utils.js';

export class Scanner extends EventEmitter {
  async scan(directory) {
    const root = path.resolve(directory);
    this.emit('scan-start', { directory: root });

    const paths = await listFiles(root);
    const total = paths.length;

    const byType = new Map(); // ext -> { count, totalSize }
    let totalSize = 0;
    let largest = [];
    let oldest = null;
    const age = { last7: 0, last30: 0, older90: 0 };
    let processed = 0;
    let scanned = 0;

    for (const filePath of paths) {
      processed++;
      try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase() || '(none)';
        const days = daysSince(stats.mtime);
        const fileData = { path: filePath, name: path.basename(filePath), size: stats.size, mtime: stats.mtime };

        scanned++;
        totalSize += stats.size;

        const entry = byType.get(ext) ?? { count: 0, totalSize: 0 };
        entry.count++;
        entry.totalSize += stats.size;
        byType.set(ext, entry);

        if (days <= 7) age.last7++;
        if (days <= 30) age.last30++;
        if (days > 90) age.older90++;

        largest.push(fileData);
        largest.sort((a, b) => b.size - a.size);
        largest = largest.slice(0, 3);

        if (!oldest || stats.mtime < oldest.mtime) oldest = fileData;

        this.emit('file-found', { ...fileData, processed, total });
      } catch (error) {
        this.emit('file-error', { path: filePath, error, processed, total });
      }
    }

    const statistics = {
      directory: root,
      totalFiles: scanned,
      totalSize,
      byType,
      age,
      largest,
      oldest: oldest ? { ...oldest, daysOld: Math.floor(daysSince(oldest.mtime)) } : null,
      skipped: total - scanned,
    };
    this.emit('scan-complete', statistics);
    return statistics;
  }
}
