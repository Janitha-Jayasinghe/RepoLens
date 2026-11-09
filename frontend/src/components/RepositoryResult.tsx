import { AlertCircle, ExternalLink } from 'lucide-react';
import { useRepository } from '../hooks/useRepository';
import { Badge, Card, LoadingCard } from './ui/primitives';

export function RepositoryResult() {
  const { state } = useRepository();
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <div className="repository-result"><LoadingCard /></div>;
  if (state.status === 'error') return <Card className="repository-result request-error" role="alert"><AlertCircle size={21} aria-hidden="true" /><div><h2>Unable to load repository</h2><p>{state.error.message}</p><p>Check the search field, or use Refresh to try again.</p></div></Card>;
  const { repository, requested_repo, analyzed_at, source_url } = state.data;
  return <Card className="repository-result" aria-label="Selected repository"><div className="card-title-row"><h2>{repository.full_name}</h2><Badge>{repository.archived ? 'Archived repository' : 'Public repository'}</Badge></div>
    {requested_repo !== repository.full_name && <p>Resolved {requested_repo} to the canonical repository {repository.full_name}.</p>}
    <p className="repository-description">{repository.description || 'No description provided by this repository.'}</p>
    <dl className="repository-details"><div><dt>Owner</dt><dd>{repository.owner.login}</dd></div><div><dt>Default branch</dt><dd>{repository.default_branch}</dd></div><div><dt>Primary language</dt><dd>{repository.language || 'Not reported'}</dd></div></dl>
    <div className="repository-source"><a className="text-link" href={source_url} target="_blank" rel="noreferrer">View on GitHub<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a><p>Retrieved <time dateTime={analyzed_at}>{new Date(analyzed_at).toLocaleString()}</time></p></div>
  </Card>;
}
