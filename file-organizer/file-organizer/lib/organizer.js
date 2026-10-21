import { EventEmitter } from 'events';
import fs, { constants } from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { listFiles, LARGE_FILE_THRESHOLD } from './utils.js';

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

export function getCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) return category;
  }
  return 'Other';
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export class Organizer extends EventEmitter {
  async organize(source, output) {
    const src = path.resolve(source);
    const dest = path.resolve(output);

    if (src === dest) {
      const error = new Error('Source and target directories must be different');
      error.code = 'EINVAL';
      throw error;
    }

    this.emit('organize-start', { source: src, output: dest });

    // Create all category folders first
    for (const category of Object.keys(categories)) {
      await fsp.mkdir(path.join(dest, category), { recursive: true });
    }
    this.emit('folders-created', { categories: Object.keys(categories) });

    // If target lives inside source, don't re-copy already organized files
    const paths = await listFiles(src, { exclude: dest.startsWith(src + path.sep) ? dest : undefined });
    const total = paths.length;

    const summary = {};
    for (const c of Object.keys(categories)) summary[c] = { count: 0, totalSize: 0 };
    let totalSize = 0;
    let copied = 0;
    let failed = 0;
    let processed = 0;

    for (const filePath of paths) {
      processed++;
      const category = getCategory(filePath);
      this.emit('copy-start', { path: filePath, category, processed, total });
      try {
        const stats = await fsp.stat(filePath);
        const target = await this.#copyFile(filePath, path.join(dest, category), stats.size);
        copied++;
        totalSize += stats.size;
        summary[category].count++;
        summary[category].totalSize += stats.size;
        this.emit('copy-complete', { path: filePath, target, category, size: stats.size, processed, total });
      } catch (error) {
        failed++;
        this.emit('copy-error', { path: filePath, error, processed, total });
      }
    }

    const result = { source: src, output: dest, summary, totalFiles: copied, totalSize, failed };
    this.emit('organize-complete', result);
    return result;
  }

  /** Copies without overwriting: file.pdf -> file(1).pdf -> file(2).pdf ... */
  async #copyFile(sourcePath, targetDir, size) {
    const ext = path.extname(sourcePath);
    const base = path.basename(sourcePath, ext);

    for (let n = 0; ; n++) {
      const name = n === 0 ? `${base}${ext}` : `${base}(${n})${ext}`;
      const target = path.join(targetDir, name);
      if (await exists(target)) continue;

      try {
        if (size >= LARGE_FILE_THRESHOLD) {
          await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(target, { flags: 'wx' }));
        } else {
          await fsp.copyFile(sourcePath, target, constants.COPYFILE_EXCL);
        }
        return target;
      } catch (error) {
        if (error.code === 'EEXIST') continue; // name was taken in the meantime
        await fsp.unlink(target).catch(() => {}); // remove partial copy
        throw error;
      }
    }
  }
}
