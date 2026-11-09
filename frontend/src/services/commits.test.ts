import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateCommits, commitTitle, fetchCommits, filterCommits, isCommitHistoryResponse, isCommitRecord } from './commits';
import type { CommitHistoryResponse, CommitRecord } from '../types/commits';
function commit(character = 'a', date = '2020-01-02T10:00:00Z'): CommitRecord {
  return { sha: character.repeat(40), html_url: `https://github.com/owner/repo/commit/${character.repeat(40)}`, message: 'Fix parser\n\nMore details', author_name: 'Git author', author_login: null, author_url: null, avatar_url: null, authored_at: '2019-01-01T00:00:00Z', committed_at: date };
}
function fixture(): CommitHistoryResponse {
  const commits = [commit()]; const start = '2020-01-01T00:00:00Z', end = '2020-01-07T12:00:00Z';
  return { repository: 'owner/repo', default_branch: 'main', head_sha: 'f'.repeat(40), commits, fetched_count: 1, days: 7, author_filter: null, range_start: start, range_end: end, complete: true, has_more: false, pages_fetched: 1, max_pages: 5, per_page: 100, activity: aggregateCommits(commits, start, end, true), coverage_note: 'Selected window exhausted.', analyzed_at: end, source_url: 'https://api.github.com/repos/owner/repo/commits' };
}
afterEach(() => vi.unstubAllGlobals());
describe('commit transformation and list filters', () => {
  it('extracts a subject without discarding the full stored message', () => { expect(commitTitle(commit().message)).toBe('Fix parser'); expect(commitTitle('')).toBe('(No commit message)'); });
  it('filters fetched messages and SHA prefixes without claiming to filter all history', () => { const entries = [commit(), { ...commit('b'), message: 'Update docs' }]; expect(filterCommits(entries, 'PARSER')).toHaveLength(1); expect(filterCommits(entries, 'bbbbbbb')).toHaveLength(1); expect(filterCommits(entries, 'unknown')).toHaveLength(0); });
  it('accepts unlinked authors and rejects fake timestamps or unsafe commit links', () => { expect(isCommitRecord(commit())).toBe(true); expect(isCommitRecord({ ...commit(), committed_at: null })).toBe(false); expect(isCommitRecord({ ...commit(), html_url: 'javascript:alert(1)' })).toBe(false); });
});
describe('commit chart aggregation', () => {
  it('uses committer dates in UTC, removes duplicates, and excludes out-of-window records', () => {
    const rows = [commit(), commit(), commit('b', '2020-01-03T01:00:00+02:00'), commit('c', '2020-01-04T00:00:00Z')];
    expect(aggregateCommits(rows, '2020-01-01T00:00:00Z', '2020-01-03T23:59:00Z', true)).toEqual([{ date: '2020-01-01', count: 0 }, { date: '2020-01-02', count: 2 }, { date: '2020-01-03', count: 0 }]);
  });
  it('does not zero-fill incomplete samples', () => expect(aggregateCommits([commit()], '2020-01-01T00:00:00Z', '2020-01-07T12:00:00Z', false)).toBeNull());
  it('refuses invalid or excessive chart windows', () => { expect(() => aggregateCommits([], 'invalid', 'invalid', true)).toThrow(); expect(() => aggregateCommits([], '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z', true)).toThrow(); });
  it('validates complete activity against the actual fetched records', () => { expect(isCommitHistoryResponse(fixture())).toBe(true); const value = fixture(); value.activity![0]!.count = 999; expect(isCommitHistoryResponse(value)).toBe(false); });
  it('accepts incomplete data only when the historical chart is withheld', () => { const value = { ...fixture(), complete: false, has_more: true, activity: null }; expect(isCommitHistoryResponse(value)).toBe(true); expect(isCommitHistoryResponse({ ...value, activity: fixture().activity })).toBe(false); });
  it('rejects duplicate SHAs and invented range lengths', () => { const value = fixture(); value.commits.push(commit()); value.fetched_count = 2; expect(isCommitHistoryResponse(value)).toBe(false); expect(isCommitHistoryResponse({ ...fixture(), days: 90 })).toBe(false); });
  it('passes selected days and author to the real API service', async () => { const value = { ...fixture(), author_filter: 'example' }; const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(value))); vi.stubGlobal('fetch', fetcher); expect((await fetchCommits('owner/repo', 7, 'example')).fetched_count).toBe(1); expect(fetcher.mock.calls[0]?.[0]).toContain('days=7&author=example'); });
});
