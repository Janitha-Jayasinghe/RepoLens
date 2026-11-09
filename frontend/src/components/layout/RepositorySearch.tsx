import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useRepository } from '../../hooks/useRepository';
import { Button, Input } from '../ui/primitives';

export function RepositorySearch() {
  const { selected, state, select, refresh, retrySeconds } = useRepository();
  const [input, setInput] = useState(selected);
  const [validation, setValidation] = useState('');
  useEffect(() => { setInput(selected); setValidation(''); }, [selected]);
  function submit(event: FormEvent) {
    event.preventDefault();
    try { select(input); setValidation(''); } catch (error) { setValidation((error as Error).message); }
  }
  return <div className="repository-search"><form className="repository-bar" onSubmit={submit} aria-label="Repository search" noValidate>
    <div className="search-field"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="repository-search">GitHub repository</label><Input id="repository-search" value={input} onChange={event => { setInput(event.target.value); setValidation(''); }} placeholder="GitHub URL or owner/repository" aria-invalid={!!validation} aria-describedby={validation ? 'repository-validation' : 'repository-hint'} autoComplete="off" spellCheck={false} maxLength={512} /></div>
    <Button type="submit" variant="primary" disabled={retrySeconds > 0}>Analyze</Button>
    <Button aria-label="Refresh repository" disabled={!selected || state.status === 'loading' || retrySeconds > 0} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /><span className="refresh-label">Refresh</span></Button>
  </form><p id="repository-hint" className="search-hint">Public GitHub repositories only. Enter owner/repository or a full GitHub URL.</p>
  {validation && <p id="repository-validation" className="search-error" role="alert">{validation}</p>}
  {retrySeconds > 0 && <p className="search-hint" role="status">GitHub rate limit: try again in {retrySeconds}s. Requests will not retry automatically.</p>}
  </div>;
}
