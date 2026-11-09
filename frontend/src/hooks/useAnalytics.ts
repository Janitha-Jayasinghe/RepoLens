import { useEffect, useState } from 'react';
import { useRepository } from './useRepository';
import { ApiError } from '../services/api';

export type Resource<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'success'; data: T };
export function useAnalytics<T>(fetcher: (repo: string, signal?: AbortSignal) => Promise<T>, requestKey = ''): Resource<T> & { retry: () => void; retrySeconds: number } {
  const { state, retrySeconds, reportRateLimit } = useRepository();
  const data = state.status === 'success' ? state.data : null;
  const key = data ? `${data.repository.full_name}:${data.analyzed_at}:${requestKey}` : '';
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; resource: Resource<T> }>({ key: '', resource: { status: 'idle' } });
  useEffect(() => {
    if (!data) return;
    if (retrySeconds > 0) { setResult({ key, resource: { status: 'error', error: new ApiError('GitHub API rate limit reached. Wait for the retry timer, then try again.', 'github_rate_limited', 429) } }); return; }
    const controller = new AbortController();
    let active = true;
    setResult({ key, resource: { status: 'loading' } });
    fetcher(data.repository.full_name, controller.signal).then(value => {
      if (active) setResult({ key, resource: { status: 'success', data: value } });
    }).catch(error => {
      if (!active || controller.signal.aborted) return;
      const failure = error instanceof ApiError ? error : new ApiError('Unable to load analytics. Please try again.', 'unknown');
      if (failure.status === 429) reportRateLimit(failure);
      setResult({ key, resource: { status: 'error', error: failure } });
    });
    return () => { active = false; controller.abort(); };
    // Cooldown changes update controls, but must never trigger automatic retries.
  }, [data, key, revision, fetcher, reportRateLimit]);
  const current: Resource<T> = state.status === 'loading' ? { status: 'loading' } : !data ? { status: 'idle' } : result.key !== key ? { status: 'loading' } : result.resource;
  return { ...current, retry: () => { if (!retrySeconds) setRevision(value => value + 1); }, retrySeconds };
}
