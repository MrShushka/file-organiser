import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { listFiles } from './utils.js';

/** SHA-256 via stream – never loads the whole file into memory. */
export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const root = path.resolve(directory);
    this.emit('search-start', { directory: root });

    const paths = await listFiles(root);
    const total = paths.length;
    const byHash = new Map(); // hash -> [{ path, size }]
    let processed = 0;

    for (const filePath of paths) {
      processed++;
      try {
        const [stats, hash] = await Promise.all([fsp.stat(filePath), calculateHash(filePath)]);
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push({ path: filePath, size: stats.size });
        this.emit('file-processed', { path: filePath, hash, processed, total });
      } catch (error) {
        this.emit('file-error', { path: filePath, error, processed, total });
      }
    }

    const groups = [];
    for (const [hash, files] of byHash) {
      if (files.length > 1) {
        const size = files[0].size;
        groups.push({ hash, files, size, copies: files.length, wasted: size * (files.length - 1) });
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);

    const result = {
      directory: root,
      totalFiles: total,
      groups,
      totalWasted: groups.reduce((sum, g) => sum + g.wasted, 0),
    };
    this.emit('duplicates-found', result);
    return result;
  }
}
