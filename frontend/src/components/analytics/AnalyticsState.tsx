import { AlertCircle, Search } from 'lucide-react';
import { Button, Card, Skeleton } from '../ui/primitives';
import type { ApiError } from '../../services/api';

export function AnalyticsState({ status, error, retry, retrySeconds, label }: { status: 'idle' | 'loading' | 'error'; error?: ApiError; retry: () => void; retrySeconds: number; label: string }) {
  if (status === 'loading') return <div role="status" aria-label={`Loading ${label.toLowerCase()}`} aria-busy="true" className="analytics-loading"><span className="sr-only">Loading {label.toLowerCase()}</span><Card><Skeleton className="skeleton-heading" /><Skeleton /><div className="chart-skeleton"><Skeleton /><Skeleton /><Skeleton /></div></Card></div>;
  return <Card className="empty-state" role={status === 'error' ? 'alert' : undefined}><div className="empty-symbol">{status === 'error' ? <AlertCircle size={28} /> : <Search size={28} />}</div><h2>{status === 'error' ? `${label} unavailable` : 'Select a repository to begin'}</h2><p>{error?.message || 'Use the repository search above. Analytics will use real data returned by GitHub.'}</p>{status === 'error' && <Button className="analytics-retry" onClick={retry} disabled={retrySeconds > 0}>{retrySeconds > 0 ? `Retry in ${retrySeconds}s` : 'Retry analytics'}</Button>}</Card>;
}
