import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth, isHealthResponse } from './health';
import type { HealthResponse } from '../types/health';
function fixture(): HealthResponse {
  const factors = (['commits', 'readme', 'license', 'releases', 'issues', 'pulls'] as const).map((id, index) => { const weight = [25, 15, 10, 15, 20, 15][index]!; return { id, label: id, weight, score: weight, status: 'assessed' as const, rule: 'Test rule', explanation: 'Verified fixture signal', evidence: ['Test-only evidence'], source_urls: ['https://api.github.com/repos/owner/repo'], suggestion: null }; });
  return { repository: 'owner/repo', methodology_version: 'maintenance-v1', status: 'complete', score: 100, observed_points: 100, available_weight: 100, lower_bound: 100, upper_bound: 100, factors, maintenance_suggestions: [], data_suggestions: [], limitations: ['Not source-code quality.'], analyzed_at: '2020-01-01T00:00:00Z', cached: false, cache_expires_at: '2020-01-01T00:02:00Z', rate_limited: false, retry_after: null };
}
afterEach(() => vi.unstubAllGlobals());
describe('maintenance-health response integrity', () => {
  it('accepts backend-calculated scores without rescoring factors in the client', () => expect(isHealthResponse(fixture())).toBe(true));
  it('accepts a complete zero score', () => { const value = fixture(); value.factors.forEach(factor => factor.score = 0); Object.assign(value, { score: 0, observed_points: 0, lower_bound: 0, upper_bound: 0 }); expect(isHealthResponse(value)).toBe(true); });
  it('requires unknown factors to leave the overall score unassigned', () => { const value = fixture(); Object.assign(value.factors[0]!, { score: null, status: 'unavailable' }); Object.assign(value, { score: null, status: 'incomplete', cache_expires_at: null, observed_points: 75, available_weight: 75, lower_bound: 75, upper_bound: 100 }); expect(isHealthResponse(value)).toBe(true); value.score = 100; expect(isHealthResponse(value)).toBe(false); });
  it('rejects invalid weights, duplicate factors, and scores exceeding their weight', () => { const value = fixture(); value.factors[0]!.weight = 26; expect(isHealthResponse(value)).toBe(false); const duplicate = fixture(); duplicate.factors[1] = duplicate.factors[0]!; expect(isHealthResponse(duplicate)).toBe(false); const excess = fixture(); excess.factors[0]!.score = 26; expect(isHealthResponse(excess)).toBe(false); });
  it('rejects mismatched bounds and silently normalized missing factors', () => { const value = fixture(); value.lower_bound = 0; expect(isHealthResponse(value)).toBe(false); });
  it('rejects unsafe evidence links', () => { const value = fixture(); value.factors[0]!.source_urls = ['javascript:alert(1)']; expect(isHealthResponse(value)).toBe(false); });
  it('encodes explicit refresh and preserves returned methodology', async () => { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture()))); vi.stubGlobal('fetch', fetcher); expect((await fetchHealth('owner/repo', undefined, true)).methodology_version).toBe('maintenance-v1'); expect(fetcher.mock.calls[0]?.[0]).toContain('refresh=true'); });
  it('rejects evidence for a different repository', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture())))); await expect(fetchHealth('other/repo')).rejects.toMatchObject({ code: 'invalid_response' }); });
});
