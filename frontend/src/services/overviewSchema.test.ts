import { describe, expect, it } from 'vitest';
import { isAnalysisResponse } from './api';

// Synthetic fixture for schema tests only. Application values always come from GitHub.
function fixture() {
  return { requested_repo: 'owner/repo', source_url: 'https://github.com/owner/repo', analyzed_at: '2020-01-01T00:00:00Z', repository: {
    id: 1, name: 'repo', full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', owner: { login: 'owner', avatar_url: null, html_url: null },
    description: null, stargazers_count: 0, forks_count: 0, open_issues_count: 0, subscribers_count: null as number | null, size: null as number | null,
    license: null as { key: string; name: string; spdx_id: string | null } | null, topics: null as string[] | null,
    default_branch: 'main', language: null, archived: false, private: false, created_at: '2020-01-01T00:00:00Z', pushed_at: null,
  } };
}
describe('overview response schema', () => {
  it('accepts unknown metadata without replacing it with zero', () => expect(isAnalysisResponse(fixture())).toBe(true));
  it('accepts reported zero, empty topics, and a detected license', () => {
    const value = fixture(); Object.assign(value.repository, { subscribers_count: 0, size: 0, topics: [], license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' } });
    expect(isAnalysisResponse(value)).toBe(true);
  });
  it.each(['subscribers_count', 'size'])('rejects negative %s', field => {
    const value = fixture(); Object.assign(value.repository, { [field]: -1 });
    expect(isAnalysisResponse(value)).toBe(false);
  });
  it('rejects malformed topic and license objects', () => {
    const value = fixture(); Object.assign(value.repository, { topics: [42] }); expect(isAnalysisResponse(value)).toBe(false);
    Object.assign(value.repository, { topics: [], license: {} }); expect(isAnalysisResponse(value)).toBe(false);
  });
  it('rejects unsafe avatar and profile URLs', () => {
    const value = fixture(); Object.assign(value.repository.owner, { avatar_url: 'https://untrusted.test/image.png' });
    expect(isAnalysisResponse(value)).toBe(false);
    Object.assign(value.repository.owner, { avatar_url: null, html_url: 'javascript:alert(1)' }); expect(isAnalysisResponse(value)).toBe(false);
  });
  it('rejects invalid date strings', () => {
    const value = fixture(); value.repository.created_at = 'invalid'; expect(isAnalysisResponse(value)).toBe(false);
  });
});
