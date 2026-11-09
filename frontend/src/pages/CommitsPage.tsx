import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';
import { useRepository } from '../hooks/useRepository';
import { commitTitle, fetchCommits, filterCommits } from '../services/commits';
import { formatCount, formatDate, formatTimestamp } from '../services/format';
import type { CommitDays, CommitRecord } from '../types/commits';
import { Badge, Button, Card, Input } from '../components/ui/primitives';
import { AnalyticsState } from '../components/analytics/AnalyticsState';
import { CommitActivityChart } from '../components/analytics/CommitActivityChart';
import { OwnerAvatar } from '../components/OwnerAvatar';

export function CommitsPage() {
  const { state } = useRepository();
  const repo = state.status === 'success' ? state.data.repository.full_name : '';
  const [days, setDays] = useState<CommitDays>(30);
  const [author, setAuthor] = useState({ repo: '', login: '' });
  const [draft, setDraft] = useState('');
  const [validation, setValidation] = useState('');
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState({ key: '', page: 1 });
  useEffect(() => { setDraft(''); setValidation(''); setQuery(''); }, [repo]);
  const authorLogin = author.repo === repo ? author.login : '';
  const fetcher = useCallback((repository: string, signal?: AbortSignal) => fetchCommits(repository, days, authorLogin, signal), [days, authorLogin]);
  const resource = useAnalytics(fetcher, `${days}:${authorLogin}`);
  function applyAuthor(event: FormEvent) {
    event.preventDefault(); const login = draft.trim();
    if (login && !/^[a-z0-9][a-z0-9_\[\]-]{0,99}$/i.test(login)) { setValidation('Use a GitHub author login without spaces or URL characters.'); return; }
    setValidation(''); setAuthor({ repo, login });
  }
  const controls = <Card className="commit-filters" aria-label="Commit history filters"><fieldset><legend>Time range (UTC)</legend><div className="range-buttons">{([7, 30, 90] as const).map(value => <Button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</Button>)}</div></fieldset><form onSubmit={applyAuthor} noValidate><label htmlFor="commit-author">GitHub author login (optional)</label><div className="author-filter-row"><Input id="commit-author" value={draft} onChange={event => { setDraft(event.target.value); setValidation(''); }} placeholder="e.g. gaearon" autoComplete="off" spellCheck={false} maxLength={100} aria-invalid={!!validation} aria-describedby={validation ? 'commit-author-error' : undefined} /><Button type="submit" disabled={!repo || resource.retrySeconds > 0}>Apply author</Button><Button disabled={!authorLogin && !draft} onClick={() => { setDraft(''); setAuthor({ repo, login: '' }); setValidation(''); }}>Clear</Button></div>{validation && <p id="commit-author-error" role="alert" className="search-error">{validation}</p>}</form></Card>;
  if (resource.status !== 'success') return <><Heading />{controls}<AnalyticsState {...resource} label="Commit activity" /></>;
  const data = resource.data;
  const matching = filterCommits(data.commits, query);
  const listKey = `${data.repository}:${data.analyzed_at}:${days}:${authorLogin}:${query}`;
  const page = pagination.key === listKey ? pagination.page : 1;
  const pages = Math.max(1, Math.ceil(matching.length / 20));
  const visible = matching.slice((page - 1) * 20, page * 20);
  return <><Heading />{controls}
    <Card className="coverage-card"><div className="card-title-row"><h2>{data.complete ? 'Complete selected window' : 'Partial selected window'}</h2><Button onClick={resource.retry} disabled={resource.retrySeconds > 0}><RefreshCw size={15} aria-hidden="true" />Refresh commits</Button></div><p>{data.coverage_note}</p><div className="commit-snapshot"><span><strong>{formatCount(data.fetched_count)}</strong> fetched commits</span><span>{formatDate(data.range_start)} - {formatDate(data.range_end)} UTC</span><span>Branch: <strong>{data.default_branch}</strong></span><span>{data.pages_fetched}/{data.max_pages} pages fetched</span></div>{data.head_sha && <p className="analytics-footnote">Pinned branch tip: <code>{data.head_sha.slice(0, 12)}</code></p>}</Card>
    <Card aria-label="Commit activity"><div className="card-title-row"><h2>Daily commit activity</h2><Badge>{data.complete ? 'Exhausted range' : 'Chart withheld'}</Badge></div><p>Committed timestamps on the default branch, including merges. The message filter below only affects the list.</p>
      {!data.complete || data.activity === null ? <div className="commit-chart-empty"><AlertCircle size={26} aria-hidden="true" /><h3>Activity chart unavailable</h3><p>The bounded query did not retrieve the entire selected range. Choose a shorter range or an author filter. No missing days are presented as zero.</p></div> : data.fetched_count === 0 ? <div className="commit-chart-empty"><GitCommitHorizontal size={28} aria-hidden="true" /><h3>No commits in this range</h3><p>GitHub returned no matching commits after the range was exhausted. Try another author or a longer time window.</p></div> : <CommitActivityChart data={data.activity} />}
      {data.activity && <details className="daily-counts"><summary>View exact daily counts</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="analytics-table"><caption className="sr-only">Exhausted commit window, daily counts in UTC</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Commits</th></tr></thead><tbody>{data.activity.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{formatCount(day.count)}</td></tr>)}</tbody></table></div></details>}
    </Card>
    <Card className="commit-list-card" aria-label="Recent commits"><div className="card-title-row"><h2>Recent commits</h2><Badge>{matching.length} matching / {data.fetched_count} fetched</Badge></div><div className="commit-message-filter"><label htmlFor="commit-query">Filter messages or SHAs within fetched commits</label><Input id="commit-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the fetched commit messages or SHAs" /></div>
      {visible.length ? <ol className="commit-list">{visible.map(commit => <CommitItem key={commit.sha} commit={commit} />)}</ol> : <div className="commit-chart-empty"><GitCommitHorizontal size={26} aria-hidden="true" /><h3>{data.fetched_count ? 'No matching fetched commits' : 'No commits returned'}</h3><p>{data.fetched_count ? 'Change the message or SHA filter to see other fetched commits.' : 'The selected range and author filter returned no commits.'}</p></div>}
      {matching.length > 0 && <nav className="commit-pagination" aria-label="Commit list pages"><Button disabled={page <= 1} onClick={() => setPagination({ key: listKey, page: page - 1 })}><ChevronLeft size={15} aria-hidden="true" />Previous</Button><span>Page {page} of {pages}</span><Button disabled={page >= pages} onClick={() => setPagination({ key: listKey, page: page + 1 })}>Next<ChevronRight size={15} aria-hidden="true" /></Button></nav>}
      <p className="analytics-footnote">List pages contain up to 20 fetched commits. This is a bounded history view, not the repository's all-time commit count.</p>
    </Card>
    <div className="analytics-provenance"><a href={data.source_url} target="_blank" rel="noreferrer">GitHub commit API source<span className="sr-only"> (opens in a new tab)</span></a><span>Retrieved {formatTimestamp(data.analyzed_at)}</span></div>
  </>;
}
function Heading() { return <div className="page-heading"><div><p className="eyebrow">FOLLOW THE DEVELOPMENT STORY</p><h1>Commits</h1><p className="page-description">Recent history, with clear bounds and verifiable daily activity.</p></div><Badge>Default branch history</Badge></div>; }
function CommitItem({ commit }: { commit: CommitRecord }) {
  const name = commit.author_name || commit.author_login || 'Unknown author';
  return <li><div className="commit-row-heading"><a className="commit-title" href={commit.html_url} target="_blank" rel="noreferrer">{commitTitle(commit.message)}<ExternalLink size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a><a className="commit-sha" href={commit.html_url} target="_blank" rel="noreferrer" title={commit.sha}>{commit.sha.slice(0, 7)}<span className="sr-only"> (opens in a new tab)</span></a></div><div className="commit-author"><OwnerAvatar key={`${commit.author_login}:${commit.avatar_url}`} login={commit.author_login || name} url={commit.avatar_url} /><span>{commit.author_url ? <a href={commit.author_url} target="_blank" rel="noreferrer">{name}{commit.author_login && commit.author_login !== name ? ` (@${commit.author_login})` : ''}<span className="sr-only"> (opens in a new tab)</span></a> : name}</span><span>Committed <time dateTime={commit.committed_at} title={formatTimestamp(commit.committed_at)}>{formatTimestamp(commit.committed_at)}</time></span></div><details className="commit-details"><summary>Full message and SHA</summary><p className="commit-full-message">{commit.message || '(No commit message)'}</p><code>{commit.sha}</code>{commit.authored_at && <p>Authored {formatTimestamp(commit.authored_at)}</p>}{!commit.author_login && <p>Author is not linked to a GitHub account.</p>}</details></li>;
}
