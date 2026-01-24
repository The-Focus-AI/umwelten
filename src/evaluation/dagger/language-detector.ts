/**
 * Language detection and static configuration utilities
 */

import type { ContainerConfig, CacheVolumeConfig } from './types.js';

/**
 * Known language configurations for common languages
 * These avoid the need for LLM calls in simple cases
 */
export const KNOWN_LANGUAGE_CONFIGS: Record<string, Partial<ContainerConfig>> = {
  typescript: {
    baseImage: 'node:20-alpine',
    setupCommands: ['npm install -g tsx'],
    runCommand: ['npx', 'tsx', '/app/code.ts'],
    cacheVolumes: [{ name: 'npm-cache', mountPath: '/root/.npm' }],
    workdir: '/app',
  },
  javascript: {
    baseImage: 'node:20-alpine',
    runCommand: ['node', '/app/code.js'],
    cacheVolumes: [{ name: 'npm-cache', mountPath: '/root/.npm' }],
    workdir: '/app',
  },
  python: {
    baseImage: 'python:3.11-alpine',
    runCommand: ['python', '/app/code.py'],
    cacheVolumes: [{ name: 'pip-cache', mountPath: '/root/.cache/pip' }],
    workdir: '/app',
  },
  ruby: {
    baseImage: 'ruby:3.2-alpine',
    runCommand: ['ruby', '/app/code.rb'],
    cacheVolumes: [{ name: 'gem-cache', mountPath: '/root/.gem' }],
    workdir: '/app',
  },
  go: {
    baseImage: 'golang:1.21-alpine',
    runCommand: ['go', 'run', '/app/code.go'],
    cacheVolumes: [{ name: 'go-cache', mountPath: '/go/pkg/mod' }],
    workdir: '/app',
  },
  rust: {
    baseImage: 'rust:1.75-alpine',
    setupCommands: ['rustc /app/code.rs -o /app/code'],
    runCommand: ['/app/code'],
    cacheVolumes: [{ name: 'cargo-cache', mountPath: '/usr/local/cargo/registry' }],
    workdir: '/app',
  },
  java: {
    baseImage: 'openjdk:17-alpine',
    setupCommands: ['javac /app/code.java'],
    runCommand: ['java', '-cp', '/app', 'Main'],
    workdir: '/app',
  },
  php: {
    baseImage: 'php:8.2-alpine',
    runCommand: ['php', '/app/code.php'],
    workdir: '/app',
  },
  perl: {
    baseImage: 'perl:5.42',
    runCommand: ['perl', '/app/code.pl'],
    workdir: '/app',
  },
  bash: {
    baseImage: 'bash:latest',
    setupCommands: ['chmod +x /app/code.sh'],
    runCommand: ['bash', '/app/code.sh'],
    workdir: '/app',
  },
  swift: {
    baseImage: 'swift:5.9-focal',
    runCommand: ['swift', '/app/code.swift'],
    workdir: '/app',
  },
};

/**
 * File extensions for languages
 */
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: '.ts',
  javascript: '.js',
  python: '.py',
  ruby: '.rb',
  go: '.go',
  rust: '.rs',
  java: '.java',
  php: '.php',
  perl: '.pl',
  bash: '.sh',
  swift: '.swift',
};

/**
 * Package detection patterns for common languages
 */
export const PACKAGE_PATTERNS: Record<string, RegExp[]> = {
  python: [/^import\s+(\w+)/gm, /^from\s+(\w+)\s+import/gm],
  typescript: [
    /import\s+.*from\s+['"]([^'"./][^'"]*)['"]/g,
    /require\(['"]([^'"./][^'"]*)['"]\)/g,
  ],
  javascript: [
    /import\s+.*from\s+['"]([^'"./][^'"]*)['"]/g,
    /require\(['"]([^'"./][^'"]*)['"]\)/g,
  ],
  ruby: [/^require\s+['"]([^'"]+)['"]/gm, /^gem\s+['"]([^'"]+)['"]/gm],
  go: [/import\s+["']([^"']+)["']/g, /import\s+\(\s*["']([^"']+)["']/g],
};

/**
 * Standard library modules that don't need installation
 */
export const STDLIB_MODULES: Record<string, Set<string>> = {
  python: new Set([
    'os',
    'sys',
    'json',
    'math',
    'random',
    'datetime',
    'time',
    're',
    'collections',
    'itertools',
    'functools',
    'pathlib',
    'typing',
    'dataclasses',
    'unittest',
    'argparse',
    'logging',
    'subprocess',
    'threading',
    'multiprocessing',
    'socket',
    'http',
    'urllib',
    'hashlib',
    'base64',
    'copy',
    'io',
    'string',
    'struct',
    'pickle',
    'csv',
    'xml',
    'html',
    'email',
    'calendar',
    'textwrap',
    'difflib',
    'pprint',
    'traceback',
    'gc',
    'inspect',
    'dis',
    'timeit',
    'profile',
    'abc',
    'contextlib',
    'decimal',
    'fractions',
    'statistics',
    'secrets',
    'uuid',
    'tempfile',
    'shutil',
    'glob',
    'fnmatch',
    'linecache',
    'tokenize',
    'codecs',
    'locale',
    'gettext',
    'operator',
    'weakref',
    'types',
    'array',
    'bisect',
    'heapq',
    'queue',
    'enum',
    'graphlib',
    'select',
    'selectors',
    'asyncio',
    'signal',
    'mmap',
    'ctypes',
  ]),
  typescript: new Set([
    'fs',
    'path',
    'os',
    'crypto',
    'util',
    'events',
    'stream',
    'http',
    'https',
    'url',
    'querystring',
    'buffer',
    'assert',
    'child_process',
    'cluster',
    'dgram',
    'dns',
    'domain',
    'net',
    'readline',
    'repl',
    'string_decoder',
    'tls',
    'tty',
    'v8',
    'vm',
    'zlib',
    'process',
    'console',
    'module',
    'perf_hooks',
    'worker_threads',
  ]),
  javascript: new Set([
    'fs',
    'path',
    'os',
    'crypto',
    'util',
    'events',
    'stream',
    'http',
    'https',
    'url',
    'querystring',
    'buffer',
    'assert',
    'child_process',
    'cluster',
    'dgram',
    'dns',
    'domain',
    'net',
    'readline',
    'repl',
    'string_decoder',
    'tls',
    'tty',
    'v8',
    'vm',
    'zlib',
    'process',
    'console',
    'module',
    'perf_hooks',
    'worker_threads',
  ]),
};

/**
 * Detects required packages from code
 */
export function detectPackages(code: string, language: string): string[] {
  const patterns = PACKAGE_PATTERNS[language];
  if (!patterns) return [];

  const stdlib = STDLIB_MODULES[language] || new Set();
  const packages = new Set<string>();

  for (const pattern of patterns) {
    // Create fresh regex for each iteration
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      const pkg = match[1].split('/')[0]; // Get base package name
      if (!stdlib.has(pkg) && !pkg.startsWith('.') && !pkg.startsWith('@types/')) {
        packages.add(pkg);
      }
    }
  }

  return Array.from(packages);
}

/**
 * Checks if a language is known and can use static config
 */
export function isKnownLanguage(language: string): boolean {
  return language in KNOWN_LANGUAGE_CONFIGS;
}

/**
 * Gets the file extension for a language
 */
export function getExtension(language: string): string {
  return LANGUAGE_EXTENSIONS[language] || `.${language}`;
}

/**
 * Gets the full static config for a known language
 */
export function getStaticConfig(language: string): ContainerConfig | null {
  const config = KNOWN_LANGUAGE_CONFIGS[language];
  if (!config) return null;

  return {
    baseImage: config.baseImage!,
    setupCommands: config.setupCommands || [],
    runCommand: config.runCommand!,
    cacheVolumes: config.cacheVolumes || [],
    workdir: config.workdir || '/app',
  };
}

/**
 * Gets list of all known languages
 */
export function getKnownLanguages(): string[] {
  return Object.keys(KNOWN_LANGUAGE_CONFIGS);
}
