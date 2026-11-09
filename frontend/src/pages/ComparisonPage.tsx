import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2, ExternalLink } from 'lucide-react';
import { useRepository } from '../hooks/useRepository';
import { ApiError } from '../services/api';
import { parseRepository } from '../services/repositoryInput';
import { fetchSnapshot } from '../services/snapshot';
import { completeCommitCount, completeHealthScore, countComparison, languageComparison } from '../services/comparison';
import { formatCount, formatDate, formatTimestamp } from '../services/format';
import { ComparisonChart } from '../components/analytics/ComparisonCharts';
import { HealthGauge } from '../components/analytics/HealthGauge';
import { OwnerAvatar } from '../components/OwnerAvatar';
import { Badge, Button, Card, Input, LoadingCard } from '../components/ui/primitives';
import type { AnalyticsSnapshot } from '../types/snapshot';
import type { CommitDays } from '../types/commits';

type Side = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'success'; data: AnalyticsSnapshot };
export function ComparisonPage() {
  const [params, setParams] = useSearchParams();
  const { selected, reportRateLimit, retrySeconds } = useRepository();
  const left = params.get('compare_left') || '', right = params.get('compare_right') || '';
  const days: CommitDays = [7, 30, 90].includes(Number(params.get('compare_days'))) ? Number(params.get('compare_days')) as CommitDays : 30;
  const [draftLeft, setDraftLeft] = useState(left || selected), [draftRight, setDraftRight] = useState(right);
  const [draftDays, setDraftDays] = useState<CommitDays>(days);
  const [validation, setValidation] = useState(''); const [revision, setRevision] = useState(0);
  const key = `${left}:${right}:${days}`;
  const [results, setResults] = useState<{ key: string; left: Side; right: Side }>({ key: '', left: { status: 'idle' }, right: { status: 'idle' } });
  const cooldown = useRef(retrySeconds); cooldown.current = retrySeconds;
  useEffect(() => { setDraftLeft(left || selected); setDraftRight(right); setDraftDays(days); }, [left, right, days, selected]);
  useEffect(() => {
    if (!left || !right) return;
    let a: string, b: string;
    try { a = parseRepository(left); b = parseRepository(right); } catch (error) { const failure = new ApiError((error as Error).message, 'invalid_repository'); setResults({ key, left: { status: 'error', error: failure }, right: { status: 'error', error: failure } }); return; }
    if (cooldown.current) { const error = new ApiError('Wait for the GitHub retry timer, then compare again.', 'github_rate_limited'); setResults({ key, left: { status: 'error', error }, right: { status: 'error', error } }); return; }
    const controller = new AbortController(); let active = true;
    setResults({ key, left: { status: 'loading' }, right: { status: 'loading' } });
    async function load(side: 'left' | 'right', repo: string) {
      try { const data = await fetchSnapshot(repo, days, controller.signal); if (!active) return; if (data.rate_limited) reportRateLimit(new ApiError('GitHub rate limit interrupted comparison analytics.', 'github_rate_limited', 429, data.retry_after ?? 60)); setResults(current => ({ ...current, [side]: { status: 'success', data } })); }
      catch (error) { if (!active || controller.signal.aborted) return; const failure = error instanceof ApiError ? error : new ApiError('Unable to retrieve this repository.', 'unknown'); if (failure.status === 429) reportRateLimit(failure); setResults(current => ({ ...current, [side]: { status: 'error', error: failure } })); }
    }
    void load('left', a); void load('right', b);
    return () => { active = false; controller.abort(); };
  }, [left, right, days, revision, key, reportRateLimit]);
  function submit(event: FormEvent) {
    event.preventDefault();
    try { const a = parseRepository(draftLeft), b = parseRepository(draftRight); if (a.toLowerCase() === b.toLowerCase()) throw new Error('Choose two different repositories.'); setValidation(''); setParams(current => { const next = new URLSearchParams(current); next.set('compare_left', a); next.set('compare_right', b); next.set('compare_days', String(draftDays)); return next; }); setRevision(value => value + 1); }
    catch (error) { setValidation((error as Error).message); }
  }
  const ready = results.key === key;
  const first: Side = ready ? results.left : left && right ? { status: 'loading' } : { status: 'idle' };
  const second: Side = ready ? results.right : left && right ? { status: 'loading' } : { status: 'idle' };
  const pair = first.status === 'success' && second.status === 'success' ? [first.data, second.data] as const : null;
  const same = pair && pair[0].overview.repository.id === pair[1].overview.repository.id;
  const busy = first.status === 'loading' || second.status === 'loading';
  return <><div className="page-heading"><div><p className="eyebrow">TWO REPOSITORIES, CLEARER CONTEXT</p><h1>Repository Comparison</h1><p className="page-description">Compare verified snapshots without declaring an inherently better project.</p></div><Badge>Public repositories</Badge></div>
    <Card><form onSubmit={submit} noValidate className="comparison-form"><div><label htmlFor="compare-left">First repository</label><Input id="compare-left" value={draftLeft} onChange={event => setDraftLeft(event.target.value)} placeholder="GitHub URL or owner/repository" autoComplete="off" spellCheck={false} aria-describedby={validation ? 'comparison-error' : undefined} /></div><div><label htmlFor="compare-right">Second repository</label><Input id="compare-right" value={draftRight} onChange={event => setDraftRight(event.target.value)} placeholder="GitHub URL or owner/repository" autoComplete="off" spellCheck={false} aria-describedby={validation ? 'comparison-error' : undefined} /></div><fieldset><legend>Commit window (UTC)</legend><div className="range-buttons">{([7, 30, 90] as const).map(value => <Button key={value} aria-pressed={draftDays === value} onClick={() => setDraftDays(value)}>{value} days</Button>)}</div></fieldset><Button type="submit" variant="primary" disabled={busy || retrySeconds > 0}><ArrowLeftRight size={16} aria-hidden="true" />{busy ? 'Collecting snapshots...' : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : 'Compare repositories'}</Button></form>{validation && <p id="comparison-error" role="alert" className="search-error">{validation}</p>}<p className="analytics-footnote">Both inputs accept public GitHub URLs or owner/repository names. Workspace selection is preserved. Collection may take up to a minute.</p></Card>
    {pair && <p className="comparison-ready" role="status"><CheckCircle2 size={17} aria-hidden="true" />Comparison ready using available data. Each section keeps its own source timestamp and coverage limits.</p>}
    {same && <p role="alert" className="search-error">Both inputs resolve to the same canonical repository. Choose a different repository for a meaningful comparison.</p>}
    <div className="comparison-columns"><ComparisonSide side={first} label="First repository" /><ComparisonSide side={second} label="Second repository" /></div>
    {pair && !same && <div className="comparison-chart-grid"><Card aria-label="Stars and forks comparison"><h2>Stars and forks</h2><p>Independent GitHub snapshots. Counts describe adoption and activity context, not code quality.</p><ComparisonChart data={countComparison(...pair)} left={pair[0].overview.repository.full_name} right={pair[1].overview.repository.full_name} /></Card><Card aria-label="Language share comparison"><h2>Language share</h2><p>Up to six languages by combined share; each percentage uses that repository's full detected byte total. Missing distributions are omitted, not zero-filled.</p>{languageComparison(...pair).length ? <ComparisonChart data={languageComparison(...pair)} left={pair[0].overview.repository.full_name} right={pair[1].overview.repository.full_name} percent /> : <p>No language percentages are available for this pair.</p>}</Card></div>}
  </>;
}
function ComparisonSide({ side, label }: { side: Side; label: string }) {
  if (side.status === 'idle') return <Card className="empty-state"><h2>{label}</h2><p>Choose a repository above to retrieve its analytics.</p></Card>;
  if (side.status === 'loading') return <div role="status" aria-label={`Loading ${label.toLowerCase()}`}><LoadingCard /></div>;
  if (side.status === 'error') return <Card role="alert"><h2>{label} unavailable</h2><p>{side.error.message}</p></Card>;
  const data = side.data, repo = data.overview.repository;
  const commitCount = completeCommitCount(data), healthScore = completeHealthScore(data);
  const search = new URLSearchParams({ repo: repo.full_name, report_days: String(data.days) }).toString();
  const age = Math.floor((Date.parse(data.analyzed_at) - Date.parse(repo.created_at)) / 86400000);
  return <Card className="comparison-repository" aria-label={`${label} snapshot`}><div className="comparison-identity"><OwnerAvatar key={repo.full_name} login={repo.owner.login} url={repo.owner.avatar_url} /><div><span>{label}</span><h2><a href={repo.html_url} target="_blank" rel="noreferrer">{repo.full_name}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></h2></div></div><p className="repository-description">{repo.description || 'No description provided.'}</p><dl className="overview-details"><div><dt>Stars</dt><dd>{formatCount(repo.stargazers_count)}</dd></div><div><dt>Forks</dt><dd>{formatCount(repo.forks_count)}</dd></div><div><dt>Open issues + PRs</dt><dd>{formatCount(repo.open_issues_count)}</dd></div><div><dt>Created / age</dt><dd>{formatDate(repo.created_at)}{age >= 0 ? ` / ${formatCount(age)} days` : ''}</dd></div><div><dt>Last push</dt><dd>{formatDate(repo.pushed_at)}</dd></div><div><dt>Primary language</dt><dd>{repo.language || 'Not reported'}</dd></div><div><dt>Language bytes</dt><dd>{data.languages.status === 'available' ? `${formatCount(data.languages.data.total_bytes)} bytes` : 'Unavailable'}</dd></div><div><dt>Commits / {data.days} days</dt><dd>{commitCount === null ? 'Unavailable or incomplete' : formatCount(commitCount)}</dd></div></dl>
    {data.languages.status === 'available' && <p className="comparison-language-list">Detected: {Object.keys(data.languages.data.languages).join(', ') || 'No language bytes detected'}</p>}
    {data.commits.status === 'available' && <p className="analytics-footnote">{data.commits.data.coverage_note}</p>}
    {data.contributors.status === 'available' && <p className="analytics-footnote">{data.contributors.data.returned_count} contributors returned in the top-10 page; not a total contributor count.</p>}
    <div className="comparison-health"><h3>Maintenance signals</h3>{data.health.status === 'available' ? <><HealthGauge score={healthScore} /><p>{healthScore === null ? 'Assessment incomplete; no overall score.' : `Methodology ${data.health.data.methodology_version}. Not an objective source-code quality score.`}</p><Link className="text-link" to={{ pathname: '/health', search }}>Inspect factor evidence</Link></> : <p>{data.health.error.message}</p>}</div>
    {[data.languages, data.contributors, data.commits].filter(section => section.status === 'unavailable').map(section => <p key={section.error.code + section.error.message} className="analytics-footnote">Unavailable section: {section.error.message}</p>)}
    <p className="analytics-footnote">{data.cached ? 'Cached' : 'Fresh'} snapshot: {formatTimestamp(data.analyzed_at)}. Source timestamps can differ.</p><Link className="button button--secondary comparison-report-link" to={{ pathname: '/reports', search }}>Prepare PDF report</Link>
  </Card>;
}
