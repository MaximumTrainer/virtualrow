import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

/** Every file under a directory, recursively, as repo-relative POSIX paths. */
const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [path.relative(repoRoot, full).split(path.sep).join('/')];
  });
};

const sourceFiles = () =>
  walk(path.join(repoRoot, 'src'))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ path: f, text: fs.readFileSync(path.join(repoRoot, f), 'utf8') }));

const preloadedUrls = (text: string) =>
  [...text.matchAll(/useGLTF\.preload\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([, url]) => url);

describe('public/ ships only what a browser can use', () => {
  it('carries no CAD source files', () => {
    // vite copies publicDir into dist verbatim, so anything parked here is
    // deployed. CAD sources belong in assets-src/, not in the download.
    const cad = walk(path.join(repoRoot, 'public')).filter((f) => /\.(step|stp|f3d|scad)$/i.test(f));

    expect(cad).toEqual([]);
  });
});

describe('GLB preloads', () => {
  it('only preloads models the scene actually renders', () => {
    const sources = sourceFiles();
    const preloaded = new Set(sources.flatMap(({ text }) => preloadedUrls(text)));

    // A preload only earns its bytes if some other reference renders the model.
    // Only app code counts: a spec naming the path proves nothing about what
    // the scene draws.
    const appCode = sources.filter(({ path: p }) => !p.startsWith('src/__tests__/'));
    const orphaned = [...preloaded].filter((url) =>
      appCode.every(({ text }) => !text.replace(/useGLTF\.preload\([^)]*\)/g, '').includes(url)),
    );

    expect(orphaned).toEqual([]);
  });

  it('preloads paths that exist in public/', () => {
    const missing = sourceFiles()
      .flatMap(({ text }) => preloadedUrls(text))
      .filter((url) => !fs.existsSync(path.join(repoRoot, 'public', url.replace(/^\//, ''))));

    expect(missing).toEqual([]);
  });
});
