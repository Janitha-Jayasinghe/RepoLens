import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLanguages, fetchContributors, formatPercent, isContributorsResponse, isLanguagesResponse, languageDistribution } from './analytics';
const base = { repository: 'owner/repo', analyzed_at: '2020-01-01T00:00:00Z', source_url: 'https://api.github.com/repos/owner/repo/languages' };
const languages = () => ({ ...base, languages: { TypeScript: 300, CSS: 100 }, total_bytes: 400 });
const contributors = () => ({ ...base, contributors: [{ id: 1, login: 'example', html_url: 'https://github.com/example', avatar_url: null, contributions: 5, type: 'User' }], returned_count: 1, per_page: 10, page: 1, has_more: true, coverage_note: 'First page only, not the total contributor population.' });
afterEach(() => vi.unstubAllGlobals());
describe('language analytics', () => {
  it('calculates percentages from actual byte counts', () => {
    expect(languageDistribution({ CSS: 100, TypeScript: 300 })).toEqual([{ name: 'TypeScript', value: 300, percent: 75 }, { name: 'CSS', value: 100, percent: 25 }]);
    expect(languageDistribution({})).toEqual([]);
    expect(languageDistribution({ Text: 0 })).toEqual([]);
  });
  it('keeps small percentages visible without inflating them', () => { expect(formatPercent(0.001)).toBe('<0.01%'); expect(formatPercent(75)).toBe('75.00%'); });
  it('accepts empty responses and rejects wrong totals/negative/string byte values', () => {
    expect(isLanguagesResponse({ ...base, languages: {}, total_bytes: 0 })).toBe(true);
    expect(isLanguagesResponse(languages())).toBe(true);
    expect(isLanguagesResponse({ ...languages(), total_bytes: 5 })).toBe(false);
    expect(isLanguagesResponse({ ...base, languages: { CSS: -1 }, total_bytes: -1 })).toBe(false);
    expect(isLanguagesResponse({ ...base, languages: { CSS: '1' }, total_bytes: 1 })).toBe(false);
  });
  it('rejects a response belonging to a different repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(languages()))));
    await expect(fetchLanguages('other/repo')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
describe('contributor analytics', () => {
  it('validates a first-page sample and never requires a fabricated total', () => expect(isContributorsResponse(contributors())).toBe(true));
  it('rejects incorrect sample counts, invalid contributions, and unsafe links', () => {
    expect(isContributorsResponse({ ...contributors(), returned_count: 10 })).toBe(false);
    expect(isContributorsResponse({ ...contributors(), per_page: 100 })).toBe(false);
    const value = contributors(); value.contributors[0]!.contributions = -1; expect(isContributorsResponse(value)).toBe(false);
    value.contributors[0]!.contributions = 5; value.contributors[0]!.html_url = 'javascript:alert(1)'; expect(isContributorsResponse(value)).toBe(false);
  });
  it('fetches the typed sample through the centralized service', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(contributors()))); vi.stubGlobal('fetch', fetcher);
    expect((await fetchContributors('owner/repo')).returned_count).toBe(1);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/api/contributors?repo=owner%2Frepo');
  });
});
