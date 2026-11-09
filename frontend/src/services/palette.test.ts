import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

describe('approved palette and public configuration', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = readdirSync(root, { recursive: true }).map(String).filter(name => /\.(css|tsx)$/.test(name) && !name.includes('.test.'));
  it('uses only approved explicit hex and RGB colors across frontend source', () => {
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      for (const match of source.matchAll(/#[a-f0-9]{3,8}\b/gi)) expect(['#000000', '#0a0a0a', '#ffffff', '#ff5f00', '#ff7518'], file).toContain(match[0].toLowerCase());
      for (const match of source.matchAll(/rgba?\(\s*(\d+)[, ]+(\d+)[, ]+(\d+)/g)) {
        const [r, g, b] = match.slice(1).map(Number);
        expect(r === g && g === b || r === 255 && g === 95 && b === 0 || r === 255 && g === 117 && b === 24, file + ' ' + match[0]).toBe(true);
      }
    }
  });
  it('does not introduce a public token environment variable', () => {
    for (const file of files) expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/VITE_\w*(?:TOKEN|SECRET|PASSWORD)/i);
  });
});
