import { describe, expect, it } from 'vitest';
import { parseRepository } from './repositoryInput';

describe('repository input', () => {
  it.each([
    ['facebook/react', 'facebook/react'], ['vuejs/core', 'vuejs/core'],
    [' https://github.com/facebook/react/ ', 'facebook/react'],
    ['https://www.github.com/vuejs/core.git', 'vuejs/core'], ['owner/repo.git', 'owner/repo'],
  ])('parses %s', (value, expected) => expect(parseRepository(value)).toBe(expected));
  it.each(['', 'react', 'owner/repo/issues', 'https://example.com/facebook/react', 'https://github.com.evil.test/a/b', 'https://user:password@github.com/a/b', 'ftp://github.com/a/b', 'https://github.com:8080/a/b', 'https://github.com/a/b?x=y', 'https://github.com/a/b#readme', 'https://github.com/a/../b', 'https://github.com/a/b%2Fc', 'a/..', 'owner with spaces/repo'])('rejects %s', value => expect(() => parseRepository(value)).toThrow('owner/repository'));
});
