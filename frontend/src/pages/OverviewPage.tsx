import { BookOpen, CalendarDays, CircleDot, Database, ExternalLink, Eye, GitBranch, GitFork, Github, Scale, ScanLine, Star, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AnalysisResponse } from '../types/repository';
import { OwnerAvatar } from '../components/OwnerAvatar';
import { StatCard } from '../components/ui/StatCard';
import { Badge, Card, Skeleton } from '../components/ui/primitives';
import { useRepository } from '../hooks/useRepository';
import { formatDate, formatSize, formatTimestamp } from '../services/format';

function GithubLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}<span className="sr-only"> (opens in a new tab)</span></a>;
}
function DateValue({ value }: { value: string | null }) {
  return value ? <time dateTime={value} title={formatTimestamp(value)}>{formatDate(value)}</time> : <>Not reported</>;
}
function OverviewSkeleton() {
  return <div className="overview-dashboard" role="status" aria-label="Loading repository overview" aria-busy="true"><span className="sr-only">Loading repository overview</span><Card><Skeleton className="skeleton-heading" /><Skeleton /><Skeleton className="skeleton-short" /></Card><div className="stats-grid">{Array.from({ length: 4 }, (_, index) => <Card key={index}><Skeleton className="skeleton-heading" /><Skeleton /><Skeleton className="skeleton-short" /></Card>)}</div><Card><Skeleton /><Skeleton /><Skeleton /></Card></div>;
}
export function OverviewPage() {
  const { state } = useRepository();
  return <>
    <div className="page-heading"><div><p className="eyebrow">REPOSITORY INTELLIGENCE</p><h1>Overview</h1><p className="page-description">The essentials behind the repository.</p></div><Badge>{state.status === 'success' ? 'GitHub API snapshot' : 'Repository overview'}</Badge></div>
    {state.status === 'idle' && <Card className="empty-state"><div className="empty-symbol"><ScanLine size={32} aria-hidden="true" /></div><h2>Every repository has a story.</h2><p>Enter a public GitHub repository above to explore its community, metadata, and latest push.</p><div className="empty-note"><Github size={16} aria-hidden="true" />Use owner/repository or a full GitHub URL.</div></Card>}
    {state.status === 'loading' && <OverviewSkeleton />}
    {state.status === 'error' && <Card className="empty-state"><div className="empty-symbol"><BookOpen size={30} aria-hidden="true" /></div><h2>Overview unavailable</h2><p>No repository statistics are shown because this request did not succeed. Check the message above and try again.</p></Card>}
    {state.status === 'success' && <OverviewDashboard data={state.data} />}
  </>;
}
function OverviewDashboard({ data }: { data: AnalysisResponse }) {
  const { repository: repo, requested_repo, analyzed_at, source_url } = data;
  const licenseLabel = repo.license ? (repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : repo.license.name) : 'No license detected';
  return <div className="overview-dashboard">
    <Card className="repository-hero" aria-label="Repository identity"><div className="hero-top"><div className="repository-identity"><GithubLink href={repo.owner.html_url || `https://github.com/${repo.owner.login}`} className="avatar-link"><OwnerAvatar key={`${repo.full_name}:${repo.owner.avatar_url}`} login={repo.owner.login} url={repo.owner.avatar_url} /></GithubLink><div><GithubLink href={repo.owner.html_url || `https://github.com/${repo.owner.login}`} className="owner-link">{repo.owner.login}</GithubLink><h2><GithubLink href={source_url}>{repo.name}</GithubLink></h2></div></div><GithubLink href={source_url} className="button button--primary"><Github size={16} aria-hidden="true" />View on GitHub<ExternalLink size={14} aria-hidden="true" /></GithubLink></div>
      <p className="canonical-name">{repo.full_name}</p><p className="repository-description">{repo.description || 'No description provided by this repository.'}</p>
      <div className="repository-tags"><Badge>Public repository</Badge>{repo.archived && <Badge>Archived</Badge>}<Badge>{repo.language || 'Language not reported'}</Badge></div>
      {requested_repo !== repo.full_name && <p className="canonical-note">Resolved {requested_repo} to {repo.full_name}.</p>}
    </Card>
    <div className="stats-grid"><StatCard label="Stars" value={repo.stargazers_count} icon={Star} description="Users who starred this repository" /><StatCard label="Forks" value={repo.forks_count} icon={GitFork} description="GitHub-reported repository forks" /><StatCard label="Open issues + pull requests" value={repo.open_issues_count} icon={CircleDot} description="Combined open issues and pull requests" /><StatCard label="Subscribers" value={repo.subscribers_count} icon={Eye} description="Users watching repository activity" /></div>
    <div className="overview-information-grid"><Card aria-label="Repository details"><div className="section-heading"><Database size={18} aria-hidden="true" /><h2>Repository details</h2></div><dl className="overview-details">
      <div><dt><CircleDot size={15} aria-hidden="true" />Primary language</dt><dd>{repo.language || 'Not reported'}</dd></div>
      <div><dt><Scale size={15} aria-hidden="true" />License</dt><dd title={repo.license?.name}>{licenseLabel}</dd></div>
      <div><dt><GitBranch size={15} aria-hidden="true" />Default branch</dt><dd><GithubLink className="detail-link" href={`${source_url}/tree/${encodeURIComponent(repo.default_branch)}`}>{repo.default_branch}<ExternalLink size={12} aria-hidden="true" /></GithubLink></dd></div>
      <div><dt><Database size={15} aria-hidden="true" />Repository size</dt><dd>{formatSize(repo.size)}</dd></div>
      <div><dt><CalendarDays size={15} aria-hidden="true" />Created</dt><dd><DateValue value={repo.created_at} /></dd></div>
      <div><dt><GitBranch size={15} aria-hidden="true" />Last push</dt><dd><DateValue value={repo.pushed_at} /></dd></div>
    </dl><p className="metadata-note">Dates shown in UTC. Size is reported by GitHub in KB.</p></Card>
    <Card className="topics-card" aria-label="Repository topics"><div className="section-heading"><Tag size={18} aria-hidden="true" /><h2>Topics</h2></div><p>How this repository describes itself.</p>{repo.topics?.length ? <ul className="topic-list">{repo.topics.map(topic => <li key={topic}><GithubLink className="topic-link" href={`https://github.com/topics/${encodeURIComponent(topic)}`}>{topic}</GithubLink></li>)}</ul> : <div className="topics-empty"><Tag size={24} aria-hidden="true" /><p>{repo.topics === null ? 'Topics were not reported by GitHub.' : 'This repository has no topics.'}</p></div>}</Card></div>
    <div className="overview-provenance"><span><Github size={15} aria-hidden="true" />Source: <GithubLink href={source_url}>GitHub REST API repository data<ExternalLink size={12} aria-hidden="true" /></GithubLink></span><span>Retrieved <time dateTime={analyzed_at}>{formatTimestamp(analyzed_at)}</time></span></div>
  </div>;
}
