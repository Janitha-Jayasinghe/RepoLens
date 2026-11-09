import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeRepository, apiGet, ApiError, isAnalysisResponse } from './api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('API service', () => {
  it('encodes the repository and forwards cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await apiGet('api/analyze?' + new URLSearchParams({ repo: 'facebook/react' }));
    expect(fetcher.mock.calls[0]?.[0]).toContain('repo=facebook%2Freact');
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('surfaces structured errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: 'repository_not_found', message: 'Repository not found or not public.' } }), { status: 404 })));
    await expect(analyzeRepository('missing/repo')).rejects.toMatchObject({ code: 'repository_not_found', status: 404, message: 'Repository not found or not public.' });
  });
  it('preserves rate-limit retry timing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { message: 'Rate limit reached', code: 'github_rate_limited', retry_after: 120 } }), { status: 429 })));
    await expect(analyzeRepository('owner/repo')).rejects.toMatchObject({ status: 429, retryAfter: 120 });
  });
  it('reads Retry-After when error details omit timing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '45' } })));
    await expect(apiGet('test')).rejects.toMatchObject({ retryAfter: 45, code: 'github_rate_limited' });
  });
  it('explains connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiGet('test')).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('backend is running') });
  });
  it('does not turn cancellation into a connection error', async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(apiGet('test', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('explains timeouts', async () => {
    const signal = AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(signal.reason));
    await expect(apiGet('test')).rejects.toMatchObject({ code: 'timeout' });
  });
  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(analyzeRepository('owner/repo')).rejects.toBeInstanceOf(ApiError);
    expect(isAnalysisResponse({ repository: {} })).toBe(false);
  });
  it('handles non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Gateway unavailable', { status: 502 })));
    await expect(apiGet('test')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('502') });
  });
});
