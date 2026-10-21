#!/usr/bin/env node
import path from 'path';
import { parseArgs } from 'util';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { formatSize, drawProgressBar, assertDirectory, describeError, fail } from './lib/utils.js';

const HELP = `file-organizer — analyze, deduplicate, organize and clean up a directory

Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <directory> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]

Options:
  -o, --output <dir>      Target directory for "organize"
      --older-than <n>    Age threshold in days for "cleanup"
      --confirm           Actually delete files in "cleanup" (default: dry run)
  -h, --help              Show this help`;

const SEP = '━'.repeat(34);

/** Progress bar that redraws one line in a TTY and prints once otherwise. */
function createProgress(label) {
  const isTTY = process.stdout.isTTY;
  return {
    update(current, total) {
      if (isTTY) process.stdout.write(`\r${label} ${drawProgressBar(current, total)}`);
    },
    finish(current, total) {
      if (isTTY) process.stdout.write('\r');
      console.log(`${label} ${drawProgressBar(current, total)}`);
    },
  };
}

function printWarnings(warnings) {
  if (warnings.length === 0) return;
  console.log(`\n⚠️  ${warnings.length} file(s) skipped:`);
  for (const w of warnings) console.log(`  - ${describeError(w.error, w.path)}`);
}

// ───────────────────────── scan ─────────────────────────
async function runScan(directory) {
  const scanner = new Scanner();
  const progress = createProgress('Processing...');
  const warnings = [];

  scanner.on('scan-start', ({ directory }) => console.log(`📂 Scanning: ${directory}`));
  scanner.on('file-found', ({ processed, total }) => progress.update(processed, total));
  scanner.on('file-error', (e) => { warnings.push(e); progress.update(e.processed, e.total); });
  scanner.on('scan-complete', (s) => {
    progress.finish(s.totalFiles + s.skipped, s.totalFiles + s.skipped);
    console.log('\n📊 Scan Results:');
    console.log(SEP);
    console.log(`Total files: ${s.totalFiles}`);
    console.log(`Total size: ${formatSize(s.totalSize)}`);
    if (s.totalFiles === 0) { printWarnings(warnings); return; }

    console.log('\nBy File Type:');
    const types = [...s.byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize);
    for (const [ext, { count, totalSize }] of types.slice(0, 5)) {
      console.log(`  ${ext.padEnd(8)}${String(count).padStart(4)} files   ${formatSize(totalSize).padStart(9)}`);
    }
    const rest = types.slice(5);
    if (rest.length) {
      const count = rest.reduce((n, [, v]) => n + v.count, 0);
      const size = rest.reduce((n, [, v]) => n + v.totalSize, 0);
      console.log(`  ${'(other)'.padEnd(8)}${String(count).padStart(4)} files   ${formatSize(size).padStart(9)}`);
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${s.age.last7} files`);
    console.log(`  Last 30 days:   ${s.age.last30} files`);
    console.log(`  Older than 90:  ${s.age.older90} files`);

    console.log('\nLargest files:');
    s.largest.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}  ${formatSize(f.size)}`));

    console.log(`\nOldest file: ${s.oldest.name} (modified ${s.oldest.daysOld} days ago)`);
    printWarnings(warnings);
  });

  await scanner.scan(directory);
}

// ───────────────────────── duplicates ─────────────────────────
async function runDuplicates(directory) {
  const finder = new DuplicateFinder();
  const progress = createProgress('Calculating hashes...');
  const warnings = [];

  finder.on('search-start', ({ directory }) => console.log(`🔍 Searching for duplicates in: ${directory}`));
  finder.on('file-processed', ({ processed, total }) => progress.update(processed, total));
  finder.on('file-error', (e) => { warnings.push(e); progress.update(e.processed, e.total); });
  finder.on('duplicates-found', ({ directory: root, totalFiles, groups, totalWasted }) => {
    progress.finish(totalFiles, totalFiles);
    if (groups.length === 0) {
      console.log('\n✅ No duplicates found.');
      printWarnings(warnings);
      return;
    }
    console.log(`\nFound ${groups.length} duplicate groups (${formatSize(totalWasted)} wasted):\n`);
    groups.forEach((g, i) => {
      console.log(SEP);
      console.log(`Group ${i + 1} (${g.copies} copies, ${formatSize(g.size)} each):`);
      console.log(`  SHA-256: ${g.hash.slice(0, 12)}...\n`);
      for (const f of g.files) {
        console.log(`  📄 ${path.join(path.basename(root), path.relative(root, f.path))}`);
      }
      console.log(`\n  Wasted space: ${formatSize(g.wasted)}\n`);
    });
    console.log(SEP);
    console.log(`💾 Total wasted space: ${formatSize(totalWasted)}`);
    printWarnings(warnings);
  });

  await finder.find(directory);
}

// ───────────────────────── organize ─────────────────────────
async function runOrganize(directory, output) {
  const organizer = new Organizer();
  const progress = createProgress('Copying files...');
  const warnings = [];

  organizer.on('organize-start', ({ source, output }) => {
    console.log(`📦 Organizing: ${source}`);
    console.log(`Target: ${output}\n`);
  });
  organizer.on('folders-created', ({ categories }) => {
    console.log('Creating folders...');
    for (const c of categories) console.log(`  ✓ ${c}/`);
    console.log('');
  });
  organizer.on('copy-complete', ({ processed, total }) => progress.update(processed, total));
  organizer.on('copy-error', (e) => { warnings.push(e); progress.update(e.processed, e.total); });
  organizer.on('organize-complete', ({ output, summary, totalFiles, totalSize, failed }) => {
    progress.finish(totalFiles + failed, totalFiles + failed);
    console.log('\n✅ Organization complete!\n');
    console.log('Summary:');
    const folder = path.basename(output);
    for (const [category, { count }] of Object.entries(summary)) {
      console.log(`  ${(category + ':').padEnd(11)}${String(count).padStart(4)} files → ${folder}/${category}/`);
    }
    console.log(`\nTotal copied: ${totalFiles} files (${formatSize(totalSize)})`);
    if (failed) printWarnings(warnings);
  });

  await organizer.organize(directory, output);
}

// ───────────────────────── cleanup ─────────────────────────
async function runCleanup(directory, days, confirm) {
  const root = path.resolve(directory);
  const cleanup = new Cleanup();
  const warnings = [];
  cleanup.on('file-error', (e) => warnings.push(e));

  console.log(`🧹 Cleanup: ${root}`);
  console.log(`Looking for files older than ${days} days...\n`);

  const files = await cleanup.find(root, days);
  if (files.length === 0) {
    console.log('✅ No files to delete.');
    printWarnings(warnings);
    return;
  }

  const totalSize = files.reduce((n, f) => n + f.size, 0);
  console.log(`Found ${files.length} files to delete:\n`);
  console.log(SEP);
  const PREVIEW = 3;
  for (const f of files.slice(0, PREVIEW)) {
    console.log(`${path.relative(root, f.path)}`);
    console.log(`  Size: ${formatSize(f.size)}`);
    console.log(`  Modified: ${f.daysOld} days ago (${f.mtime.toISOString().slice(0, 10)})\n`);
  }
  if (files.length > PREVIEW) console.log(`... (${files.length - PREVIEW} more files)`);
  console.log(SEP);
  console.log(`\nTotal: ${files.length} files (${formatSize(totalSize)})\n`);

  if (!confirm) {
    console.log('⚠️  DRY RUN MODE: No files were deleted.');
    console.log('To actually delete these files, run with --confirm flag.');
    printWarnings(warnings);
    return;
  }

  console.log(`⚠️  DELETING ${files.length} files (${formatSize(totalSize)}). This action cannot be undone!\n`);
  const progress = createProgress('Deleting...');
  cleanup.on('file-deleted', ({ processed, total }) => progress.update(processed, total));
  cleanup.on('file-error', (e) => { if (e.processed) progress.update(e.processed, e.total); });
  cleanup.on('cleanup-complete', ({ deleted, failed, freed, total }) => {
    progress.finish(total, total);
    console.log('\n✅ Cleanup complete!');
    console.log(`Deleted: ${deleted} files (${formatSize(freed)} freed)`);
    if (failed) console.log(`Failed: ${failed} files`);
  });
  await cleanup.delete(files);
  printWarnings(warnings.filter((w) => w.processed));
  if (warnings.some((w) => w.processed)) process.exitCode = 1;
}

// ───────────────────────── main ─────────────────────────
function usageError(message) {
  console.error(`❌ Error: ${message}\n`);
  console.error(HELP);
  process.exit(1);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        'older-than': { type: 'string' },
        confirm: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    usageError(error.message);
  }

  const { values, positionals } = parsed;
  const [command, directory] = positionals;

  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  if (!['scan', 'duplicates', 'organize', 'cleanup'].includes(command)) usageError(`Unknown command: ${command}`);
  if (!directory) usageError(`Missing <directory> argument for "${command}"`);

  let days;
  if (command === 'organize' && !values.output) usageError('"organize" requires --output <target directory>');
  if (command === 'cleanup') {
    days = Number(values['older-than']);
    if (values['older-than'] === undefined || !Number.isFinite(days) || days < 0) {
      usageError('"cleanup" requires --older-than <days> (a non-negative number)');
    }
  }

  try {
    await assertDirectory(directory);
    switch (command) {
      case 'scan': await runScan(directory); break;
      case 'duplicates': await runDuplicates(directory); break;
      case 'organize': await runOrganize(directory, values.output); break;
      case 'cleanup': await runCleanup(directory, days, values.confirm); break;
    }
  } catch (error) {
    fail(error, error.path ?? directory);
  }
}

main();
