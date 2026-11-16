import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('management styles remain compatible with Chrome 102', async () => {
  const css = await fs.readFile(path.join(rootDir, 'public', 'styles.css'), 'utf8');

  for (const pattern of [
    /color-mix\(/,
    /:has\(/,
    /@container\b/,
    /\boklch\(/,
    /\blight-dark\(/,
    /text-wrap:\s*balance/
  ]) {
    assert.doesNotMatch(css, pattern);
  }

  assert.match(css, /::selection\s*\{[^}]*background-color:\s*var\(--selection-bg\)/);
  assert.match(
    css,
    /\.code-input::selection\s*\{[^}]*background-color:\s*var\(--code-selection-bg\)/
  );
});
