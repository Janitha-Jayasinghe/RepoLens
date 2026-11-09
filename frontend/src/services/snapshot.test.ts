import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReportPdf, fetchSnapshot, isSnapshot, reportFilename } from './snapshot';
import { completeCommitCount, completeHealthScore, countComparison, languageComparison } from './comparison';
import type { AnalyticsSnapshot } from '../types/snapshot';

// Synthetic response fixture for tests only; never imported by the application.
function fixture(name = 'owner/repo', stars = 0): AnalyticsSnapshot {
  const at = '2020-01-07T12:00:00Z';
  const missing = () => ({ status: 'unavailable' as const, data: null, error: { code: 'unavailable', message: 'Not collected in fixture', status: 502, retry_after: null } });
  const commits = { repository: name, default_branch: 'main', head_sha: 'a'.repeat(40), commits: [], fetched_count: 0, days: 7 as const, author_filter: null, range_start: '2020-01-01T00:00:00Z', range_end: at, complete: true, has_more: false, pages_fetched: 1, max_pages: 5, per_page: 100, activity: Array.from({ length: 7 }, (_, index) => ({ date: `2020-01-0${index + 1}`, count: 0 })), coverage_note: 'Exhausted selected range.', analyzed_at: at, source_url: `https://api.github.com/repos/${name}/commits` };
  return { id: '12345678-1234-1234-1234-123456789abc', overview: { requested_repo: name, source_url: `https://github.com/${name}`, analyzed_at: at, repository: { id: 1, name: name.split('/')[1]!, full_name: name, html_url: `https://github.com/${name}`, owner: { login: name.split('/')[0]!, html_url: null, avatar_url: null }, description: null, stargazers_count: stars, forks_count: 0, open_issues_count: 0, subscribers_count: null, size: null, license: null, topics: [], default_branch: 'main', language: null, archived: false, private: false, created_at: at, pushed_at: null } }, days: 7, languages: { status: 'available', error: null, data: { repository: name, languages: { TypeScript: 300, CSS: 100 }, total_bytes: 400, analyzed_at: at, source_url: `https://api.github.com/repos/${name}/languages` } }, contributors: missing(), commits: { status: 'available', error: null, data: commits }, health: missing(), analyzed_at: at, expires_at: '2020-01-07T12:05:00Z', cached: false, collection_complete: false, rate_limited: false, retry_after: null, notes: ['Test-only snapshot.'] };
}
afterEach(() => vi.unstubAllGlobals());
describe('snapshot integrity and comparison transformations', () => {
  it('accepts explicit unavailable sections without inventing values', () => { expect(isSnapshot(fixture())).toBe(true); expect(completeHealthScore(fixture())).toBeNull(); });
  it('rejects inconsistent coverage or cross-repository sections', () => { expect(isSnapshot({ ...fixture(), collection_complete: true })).toBe(false); const value = fixture(); if (value.languages.status === 'available') value.languages.data.repository = 'other/repo'; expect(isSnapshot(value)).toBe(false); });
  it('compares exact stars/forks and preserves true zero', () => expect(countComparison(fixture(), fixture('other/repo', 1000))).toEqual([{ name: 'Stars', left: 0, right: 1000 }, { name: 'Forks', left: 0, right: 0 }]));
  it('uses each language total as the denominator, omitting unavailable distributions', () => { const a = fixture(), b = fixture('other/repo'); b.languages = { status: 'unavailable', data: null, error: { code: 'missing', message: 'Unavailable', status: 502, retry_after: null } }; expect(languageComparison(a, b)).toEqual([{ name: 'TypeScript', left: 75, right: null }, { name: 'CSS', left: 25, right: null }]); });
  it('does not compare partial fetched commits as full window totals', () => { const value = fixture(); expect(completeCommitCount(value)).toBe(0); if (value.commits.status === 'available') Object.assign(value.commits.data, { complete: false, has_more: true, activity: null }); expect(completeCommitCount(value)).toBeNull(); });
  it('keeps filenames safe and tied to canonical identity', () => expect(reportFilename(fixture())).toBe('repolens-owner-repo-2020-01-07.pdf'));
  it('retrieves a typed snapshot with the selected window and explicit refresh', async () => { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture()))); vi.stubGlobal('fetch', fetcher); expect((await fetchSnapshot('owner/repo', 7, undefined, true)).days).toBe(7); expect(fetcher.mock.calls[0]?.[0]).toContain('days=7&refresh=true'); });
});
describe('PDF response handling', () => {
  it('accepts PDF bytes with correct MIME type', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('%PDF-1.4 test document', { headers: { 'Content-Type': 'application/pdf' } }))); expect((await fetchReportPdf(fixture().id)).type).toBe('application/pdf'); });
  it('rejects mislabeled and malformed downloads', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not a PDF', { headers: { 'Content-Type': 'application/pdf' } }))); await expect(fetchReportPdf(fixture().id)).rejects.toMatchObject({ code: 'invalid_pdf' }); });
  it('surfaces expired-snapshot errors instead of downloading JSON', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: 'snapshot_expired', message: 'Prepare a new snapshot.' } }), { status: 410 }))); await expect(fetchReportPdf(fixture().id)).rejects.toMatchObject({ code: 'snapshot_expired', status: 410 }); });
});
