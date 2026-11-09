import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { analyzeRepository, ApiError } from '../services/api';
import { parseRepository } from '../services/repositoryInput';
import type { AnalysisResponse } from '../types/repository';

type State = { status: 'idle'; data?: never; error?: never } | { status: 'loading'; data?: never; error?: never } | { status: 'success'; data: AnalysisResponse; error?: never } | { status: 'error'; error: ApiError; data?: never };
interface RepositoryContextValue { state: State; selected: string; select: (repo: string) => void; refresh: () => void; retrySeconds: number; reportRateLimit: (error: ApiError) => void; }
const RepositoryContext = createContext<RepositoryContextValue | null>(null);
export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('repo') || '';
  const [state, setState] = useState<State>({ status: 'idle' });
  const [revision, setRevision] = useState(0);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cooldown = useRef(0);
  const lastSuccess = useRef<{ repo: string; revision: number } | null>(null);
  const reportRateLimit = useCallback((error: ApiError) => {
    cooldown.current = Math.max(cooldown.current, Date.now() + Math.max(1, error.retryAfter ?? 60) * 1000);
    setRetryUntil(cooldown.current); setNow(Date.now());
  }, []);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => { const current = Date.now(); setNow(current); if (current >= retryUntil) setRetryUntil(0); }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => {
    if (!selected) { lastSuccess.current = null; setState({ status: 'idle' }); return; }
    if (lastSuccess.current?.repo === selected && lastSuccess.current.revision === revision) return;
    lastSuccess.current = null;
    let repo: string;
    try { repo = parseRepository(selected); } catch (error) { setState({ status: 'error', error: new ApiError((error as Error).message, 'invalid_repository') }); return; }
    if (cooldown.current > Date.now()) {
      setState({ status: 'error', error: new ApiError('GitHub API rate limit reached. Wait until the retry timer finishes, then refresh or search again.', 'github_rate_limited', 429) }); return;
    }
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    analyzeRepository(repo, controller.signal).then(data => {
      if (!active) return;
      lastSuccess.current = { repo: data.repository.full_name, revision };
      setState({ status: 'success', data });
      if (selected !== data.repository.full_name) setParams(current => { const next = new URLSearchParams(current); next.set('repo', data.repository.full_name); return next; }, { replace: true });
    }).catch(error => {
      if (!active || controller.signal.aborted) return;
      const failure = error instanceof ApiError ? error : new ApiError('Unable to load this repository. Please try again.', 'unknown');
      if (failure.status === 429 || failure.code === 'github_rate_limited') {
        cooldown.current = Date.now() + Math.max(1, failure.retryAfter ?? 60) * 1000;
        setRetryUntil(cooldown.current); setNow(Date.now());
      }
      setState({ status: 'error', error: failure });
    });
    return () => { active = false; controller.abort(); };
  }, [selected, revision, setParams]);
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  function refresh() { if (cooldown.current <= Date.now()) setRevision(value => value + 1); }
  function select(input: string) {
    const repo = parseRepository(input);
    if (cooldown.current > Date.now()) return;
    if (repo === selected) refresh();
    else setParams(current => { const next = new URLSearchParams(current); next.set('repo', repo); return next; });
  }
  return <RepositoryContext.Provider value={{ state, selected, select, refresh, retrySeconds, reportRateLimit }}>{children}</RepositoryContext.Provider>;
}
export function useRepository() {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('RepositoryProvider is required.');
  return context;
}
