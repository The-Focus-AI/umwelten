/**
 * Stage 0: Convert epub/pdf files in input/memorization/books/ to plain .txt
 *
 * Requires: pandoc (for epub) and/or pdftotext (for pdf)
 * Calibre's ebook-convert is used as fallback for epub.
 *
 * Usage: pnpm tsx examples/memorization/00-convert-books.ts
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BOOKS_DIR = path.join(process.cwd(), 'input', 'memorization', 'books');

function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')           // remove extension
    .replace(/--.*$/g, '')             // remove everything after --
    .replace(/\.\d+$/, '')            // remove trailing .NNN (gutenberg IDs)
    .replace(/[^a-zA-Z0-9\s-]/g, '')  // remove special chars
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function convertEpub(inputPath: string, outputPath: string): boolean {
  // Try pandoc first (cleaner output)
  try {
    execSync(`pandoc "${inputPath}" -t plain --wrap=none -o "${outputPath}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return true;
  } catch {
    // Fall back to ebook-convert (Calibre)
    try {
      execSync(`ebook-convert "${inputPath}" "${outputPath}"`, {
        stdio: 'pipe',
        timeout: 120_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function convertPdf(inputPath: string, outputPath: string): boolean {
  // Try pdftotext (poppler)
  try {
    execSync(`pdftotext -layout "${inputPath}" "${outputPath}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return true;
  } catch {
    // Fall back to pandoc
    try {
      execSync(`pandoc "${inputPath}" -t plain --wrap=none -o "${outputPath}"`, {
        stdio: 'pipe',
        timeout: 120_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function main() {
  console.log('=== Stage 0: Convert Books to Plain Text ===\n');

  const files = fs.readdirSync(BOOKS_DIR).filter(f =>
    f.endsWith('.epub') || f.endsWith('.pdf'),
  );

  if (files.length === 0) {
    console.log('No epub/pdf files found in input/memorization/books/');
    return;
  }

  console.log(`Found ${files.length} file(s) to convert:\n`);

  const converted: string[] = [];

  for (const file of files) {
    const inputPath = path.join(BOOKS_DIR, file);
    const slug = slugify(file);
    const outputPath = path.join(BOOKS_DIR, `${slug}.txt`);

    // Skip if already converted
    if (fs.existsSync(outputPath)) {
      const words = fs.readFileSync(outputPath, 'utf-8').split(/\s+/).filter(w => w).length;
      console.log(`  SKIP: ${file} -> ${slug}.txt (${words.toLocaleString()} words, already exists)`);
      converted.push(slug);
      continue;
    }

    process.stdout.write(`  Converting: ${file} -> ${slug}.txt...`);

    let ok = false;
    if (file.endsWith('.epub')) {
      ok = convertEpub(inputPath, outputPath);
    } else if (file.endsWith('.pdf')) {
      ok = convertPdf(inputPath, outputPath);
    }

    if (ok && fs.existsSync(outputPath)) {
      const words = fs.readFileSync(outputPath, 'utf-8').split(/\s+/).filter(w => w).length;
      console.log(` OK (${words.toLocaleString()} words)`);
      converted.push(slug);
    } else {
      console.log(` FAILED`);
    }
  }

  console.log(`\nConverted ${converted.length}/${files.length} files.`);
  console.log('\nBook IDs for config.json:');
  for (const slug of converted) {
    console.log(`  "${slug}"`);
  }

  console.log('\nUpdate input/memorization/config.json with trainBooks and testBooks arrays.');
}

main();
