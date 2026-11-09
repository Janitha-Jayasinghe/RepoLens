import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkPage, fetchWorkSummary, groupPageUpdates, isWorkPageResponse, isWorkSummaryResponse } from './workItems';
import type { WorkItem, WorkPageResponse, WorkSummaryResponse } from '../types/workItems';
const snapshot = { repository: 'owner/repo', analyzed_at: '2020-01-01T12:00:00Z', cached: false, cache_expires_at: '2020-01-01T12:01:00Z', coverage_note: 'Page snapshot only.' };
function item(number = 1, state: WorkItem['state'] = 'open', pull = false): WorkItem { return { number, title: 'Example', html_url: `https://github.com/owner/repo/${pull ? 'pull' : 'issues'}/${number}`, state, author_login: null, author_url: null, comments: null, created_at: '2019-01-01T00:00:00Z', updated_at: '2020-01-01T12:00:00Z', closed_at: state === 'open' ? null : '2020-01-01T12:00:00Z', merged_at: state === 'merged' ? '2020-01-01T12:00:00Z' : null }; }
function page(): WorkPageResponse { return { ...snapshot, kind: 'issues', state_filter: 'all', items: [item()], page: 1, per_page: 20, scanned_count: 20, returned_count: 1, has_next: true, has_previous: false, source_url: 'https://api.github.com/repos/owner/repo/issues' }; }
function summary(): WorkSummaryResponse { const count = { value: 10000, complete: true, source_url: 'https://api.github.com/search/issues', note: 'Search snapshot.' }; return { ...snapshot, open_issues: count, closed_issues: count, open_pull_requests: count, merged_pull_requests: count }; }
afterEach(() => vi.unstubAllGlobals());
describe('separate summary counts', () => {
  it('accepts search-reported totals independently of page size or the 1000-item search retrieval cap', () => expect(isWorkSummaryResponse(summary())).toBe(true));
  it('accepts incomplete search only without an exact value', () => { const value = summary(); value.open_issues = { ...value.open_issues, value: null, complete: false }; expect(isWorkSummaryResponse(value)).toBe(true); value.open_issues.value = 100; expect(isWorkSummaryResponse(value)).toBe(false); });
  it('requests an explicit cache bypass when refreshed', async () => { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(summary()))); vi.stubGlobal('fetch', fetcher); await fetchWorkSummary('owner/repo', undefined, true); expect(fetcher.mock.calls[0]?.[0]).toContain('refresh=true'); });
});
describe('work-item page schema and requests', () => {
  it('accepts short and empty filtered pages while retaining next-page metadata', () => { expect(isWorkPageResponse(page())).toBe(true); expect(isWorkPageResponse({ ...page(), items: [], returned_count: 0 })).toBe(true); });
  it('rejects pull requests masquerading as issues and contradictory merged states', () => { expect(isWorkPageResponse({ ...page(), items: [item(1, 'merged', true)] })).toBe(false); expect(isWorkPageResponse({ ...page(), items: [{ ...item(), merged_at: '2020-01-01T12:00:00Z' }] })).toBe(false); });
  it('rejects duplicate rows, mismatched page counts, and unsafe URLs', () => { expect(isWorkPageResponse({ ...page(), items: [item(), item()], returned_count: 2 })).toBe(false); expect(isWorkPageResponse({ ...page(), returned_count: 20 })).toBe(false); expect(isWorkPageResponse({ ...page(), items: [{ ...item(), html_url: 'javascript:alert(1)' }] })).toBe(false); });
  it('passes state and API page through the centralized service', async () => { const value = { ...page(), page: 2, has_previous: true, state_filter: 'closed', items: [item(1, 'closed')] }; const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(value))); vi.stubGlobal('fetch', fetcher); await fetchWorkPage('owner/repo', 'issues', 'closed', 2); expect(fetcher.mock.calls[0]?.[0]).toContain('state=closed&page=2'); });
});
describe('loaded-page latest-update aggregation', () => {
  it('uses latest updated_at in UTC, not creation dates or full event histories', () => { const issue = { ...item(), updated_at: '2020-01-02T01:00:00+02:00' }; expect(groupPageUpdates([issue, issue], [item(2, 'merged', true)])).toEqual([{ date: '2020-01-01', issues: 1, pulls: 1 }]); });
  it('does not extrapolate unobserved dates or fabricate rows for empty pages', () => { expect(groupPageUpdates([], [])).toEqual([]); expect(groupPageUpdates([item()], [])).toEqual([{ date: '2020-01-01', issues: 1, pulls: 0 }]); });
});
