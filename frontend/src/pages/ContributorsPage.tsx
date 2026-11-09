import { useState } from 'react';
import { ExternalLink, RefreshCw, Users } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';
import { fetchContributors } from '../services/analytics';
import { formatCount, formatTimestamp } from '../services/format';
import { AnalyticsState } from '../components/analytics/AnalyticsState';
import { HorizontalChart } from '../components/analytics/Charts';
import { OwnerAvatar } from '../components/OwnerAvatar';
import { Badge, Button, Card } from '../components/ui/primitives';

export function ContributorsPage() {
  const resource = useAnalytics(fetchContributors);
  const [highlight, setHighlight] = useState<{ repo: string; login: string } | null>(null);
  if (resource.status !== 'success') return <><PageHeading /><AnalyticsState {...resource} label="Contributor analytics" /></>;
  const data = resource.data;
  const selected = highlight?.repo === data.repository && data.contributors.some(item => item.login === highlight.login) ? highlight.login : null;
  const chart = data.contributors.map(item => ({ name: item.login, value: item.contributions }));
  const select = (login: string) => setHighlight(selected === login ? null : { repo: data.repository, login });
  return <><PageHeading /><Card className="coverage-card"><div className="card-title-row"><h2>Top {data.returned_count} returned contributors</h2><Button onClick={resource.retry} disabled={resource.retrySeconds > 0}><RefreshCw size={15} aria-hidden="true" />Refresh contributors</Button></div><p>{data.coverage_note}</p><p>{data.has_more ? 'GitHub reports additional contributor pages beyond this sample.' : 'GitHub reports no next page for this response. This still does not count every person who contributed.'}</p><p>Counts describe GitHub-attributed contributions, not individual productivity or total project work.</p></Card>
    {!data.contributors.length ? <Card className="empty-state"><div className="empty-symbol"><Users size={28} aria-hidden="true" /></div><h2>No contributor data returned</h2><p>GitHub returned no ranked contributors for this repository. Contributor history may be empty or unavailable.</p></Card> : <div className="contributor-grid"><Card aria-label="Contributor leaderboard"><h2>Contributor leaderboard</h2><p>Ranked within the returned page, by contribution count.</p><ol className="contributor-list">{data.contributors.map((item, index) => <li key={item.id} className={selected === item.login ? 'is-highlighted' : ''}><span className="contributor-rank" aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span><OwnerAvatar key={`${item.id}:${item.avatar_url}`} login={item.login} url={item.avatar_url} /><div className="contributor-person"><a href={item.html_url} target="_blank" rel="noreferrer">{item.login}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a><span>{item.type === 'Bot' ? 'Bot account' : 'GitHub contributor'}</span></div><button type="button" className="contributor-count" aria-label={`Highlight ${item.login}: ${formatCount(item.contributions)} contributions`} aria-pressed={selected === item.login} onClick={() => select(item.login)}>{formatCount(item.contributions)}<span>contributions</span></button></li>)}</ol></Card>
    <Card aria-label="Contributor contribution chart"><h2>Contributions in this sample</h2><p>Hover or use the chart keyboard controls for exact counts. Select a leaderboard count to highlight it.</p><HorizontalChart data={chart} unit="contributions" selected={selected} onSelect={select} /></Card></div>}
    <div className="analytics-provenance"><a href={data.source_url} target="_blank" rel="noreferrer">GitHub contributor API source<span className="sr-only"> (opens in a new tab)</span></a><span>Retrieved {formatTimestamp(data.analyzed_at)}</span></div>
  </>;
}
function PageHeading() { return <div className="page-heading"><div><p className="eyebrow">THE PEOPLE BEHIND THE CODE</p><h1>Contributors</h1><p className="page-description">Explore the leading contributors in GitHub's returned sample.</p></div><Badge>Top 10 sample ? Page 1</Badge></div>; }
