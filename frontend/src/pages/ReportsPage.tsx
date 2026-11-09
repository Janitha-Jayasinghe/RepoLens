import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, FileText, RefreshCw } from 'lucide-react';
import { useRepository } from '../hooks/useRepository';
import { ApiError } from '../services/api';
import { fetchReportPdf, fetchSnapshot, reportFilename } from '../services/snapshot';
import { formatTimestamp } from '../services/format';
import type { AnalyticsSnapshot } from '../types/snapshot';
import type { CommitDays } from '../types/commits';
import { Badge, Button, Card, LoadingCard } from '../components/ui/primitives';

type Preparation = { status: 'idle' | 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; snapshot: AnalyticsSnapshot };
export function ReportsPage() {
  const { state, retrySeconds, reportRateLimit } = useRepository();
  const repo = state.status === 'success' ? state.data.repository.full_name : '';
  const [params] = useSearchParams();
  const [days, setDays] = useState<CommitDays>(() => [7, 30, 90].includes(Number(params.get('report_days'))) ? Number(params.get('report_days')) as CommitDays : 30);
  const [preparation, setPreparation] = useState<Preparation>({ status: 'idle' });
  const [download, setDownload] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const active = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => { generation.current++; active.current?.abort(); setPreparation({ status: 'idle' }); setDownload({ status: 'idle' }); return () => { generation.current++; active.current?.abort(); }; }, [repo, days]);
  function failure(error: unknown): ApiError { const value = error instanceof ApiError ? error : new ApiError('Unable to prepare this report. Please try again.', 'unknown'); if (value.status === 429) reportRateLimit(value); return value; }
  async function prepare() {
    if (!repo || retrySeconds) return;
    const refresh = preparation.status !== 'idle'; const version = ++generation.current;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setPreparation({ status: 'loading' }); setDownload({ status: 'idle' });
    try { const snapshot = await fetchSnapshot(repo, days, controller.signal, refresh); if (version !== generation.current) return; if (snapshot.rate_limited) reportRateLimit(new ApiError('GitHub rate limit interrupted report data collection.', 'github_rate_limited', 429, snapshot.retry_after ?? 60)); setPreparation({ status: 'ready', snapshot }); }
    catch (error) { if (controller.signal.aborted || version !== generation.current) return; setPreparation({ status: 'error', error: failure(error) }); }
  }
  async function exportPdf() {
    if (preparation.status !== 'ready' || retrySeconds) return;
    const snapshot = preparation.snapshot, version = ++generation.current;
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setDownload({ status: 'loading' });
    try { const blob = await fetchReportPdf(snapshot.id, controller.signal); if (version !== generation.current) return; const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = reportFilename(snapshot); document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setDownload({ status: 'success', message: 'PDF ready. Your browser download has started.' }); }
    catch (error) { if (controller.signal.aborted || version !== generation.current) return; setDownload({ status: 'error', message: failure(error).message }); }
  }
  return <><div className="page-heading"><div><p className="eyebrow">TAKE YOUR INSIGHTS WITH YOU</p><h1>PDF Reports</h1><p className="page-description">A source-linked report using a reviewed analytics snapshot.</p></div><Badge>Available data only</Badge></div>
    <Card><div className="section-heading"><FileText size={20} aria-hidden="true" /><h2>{repo || 'Select a repository above'}</h2></div><p>Prepare a snapshot first, review its coverage, then export. The PDF uses the same server-held data and does not refetch or accept browser-supplied statistics.</p><fieldset className="report-range"><legend>Commit window (UTC)</legend><div className="range-buttons">{([7, 30, 90] as const).map(value => <Button key={value} aria-pressed={days === value} disabled={download.status === 'loading'} onClick={() => setDays(value)}>{value} days</Button>)}</div></fieldset><div className="report-buttons"><Button variant="primary" onClick={() => void prepare()} disabled={!repo || preparation.status === 'loading' || download.status === 'loading' || retrySeconds > 0}><RefreshCw size={16} aria-hidden="true" />{retrySeconds ? `Retry in ${retrySeconds}s` : preparation.status === 'ready' ? 'Refresh report snapshot' : 'Prepare report snapshot'}</Button>{preparation.status === 'loading' && <Button onClick={() => { generation.current++; active.current?.abort(); setPreparation({ status: 'idle' }); }}>Cancel preparation</Button>}</div></Card>
    {preparation.status === 'idle' && <Card className="empty-state report-state"><div className="empty-symbol"><FileText size={30} aria-hidden="true" /></div><h2>No report snapshot prepared</h2><p>Reports include available overview statistics, vector charts, top-contributor information, bounded commit analytics, and maintenance evidence. Unavailable statistics are omitted.</p></Card>}
    {preparation.status === 'loading' && <div className="report-state" role="status" aria-label="Preparing report snapshot"><LoadingCard /><p className="search-hint">Collecting actual GitHub analytics. This can take up to a minute.</p></div>}
    {preparation.status === 'error' && <Card className="report-state" role="alert"><h2>Report snapshot unavailable</h2><p>{preparation.error.message}</p></Card>}
    {preparation.status === 'ready' && <Card className="report-state" aria-label="Report snapshot coverage"><div className="card-title-row"><h2>Review report coverage</h2><Badge>{preparation.snapshot.collection_complete ? 'All requested sections retrieved' : 'Some sections unavailable'}</Badge></div><p>Repository: {preparation.snapshot.overview.repository.full_name}</p><p>Analysis snapshot: {formatTimestamp(preparation.snapshot.analyzed_at)}. Export expires {formatTimestamp(preparation.snapshot.expires_at)}.</p><ul className="report-coverage"><li><CheckCircle2 size={16} aria-hidden="true" /><strong>Overview</strong><span>Repository details and available statistics</span></li>{(['languages', 'contributors', 'commits', 'health'] as const).map(name => { const section = preparation.snapshot[name]; return <li key={name}><span className="report-coverage-icon" aria-hidden="true">{section.status === 'available' ? '+' : '-'}</span><strong>{name.charAt(0).toUpperCase() + name.slice(1)}</strong><span>{section.status === 'unavailable' ? `Omitted: ${section.error.message}` : name === 'commits' && preparation.snapshot.commits.status === 'available' ? preparation.snapshot.commits.data.complete ? `${days}-day range exhausted; daily chart available` : 'Partial history; list included, historical chart omitted' : name === 'health' && preparation.snapshot.health.status === 'available' ? preparation.snapshot.health.data.score === null ? 'Incomplete assessment; available factor evidence included, no overall score' : 'Complete maintenance assessment and factor explanations' : name === 'contributors' ? 'Returned top-10 sample, not all contributors' : 'Actual language bytes and distribution chart'}</span></li>; })}</ul><p className="analytics-footnote">Each section retains its own retrieval time and source URL. Different snapshots are not an atomic transaction. The PDF uses black text, white paper, jet-orange accents, and embedded fonts.</p><Button variant="primary" onClick={() => void exportPdf()} disabled={download.status === 'loading' || retrySeconds > 0}><Download size={16} aria-hidden="true" />{download.status === 'loading' ? 'Generating PDF...' : 'Download PDF report'}</Button></Card>}
    {download.status === 'success' && <p className="report-success" role="status"><CheckCircle2 size={18} aria-hidden="true" />{download.message}</p>}
    {download.status === 'error' && <p className="search-error" role="alert">{download.message}</p>}
  </>;
}
