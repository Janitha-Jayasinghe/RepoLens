import { ArrowRight, BookOpen, Github, ScanLine } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useRepository } from '../hooks/useRepository';
import { navigation } from '../app/navigation';
import { Badge, Card } from '../components/ui/primitives';
import { API_BASE_URL } from '../services/api';

export function WorkspacePage({ path }: { path: string }) {
  const { state } = useRepository();
  const location = useLocation();
  const page = navigation.find(item => item.path === path)!;
  const Icon = page.icon;
  return <>
    <div className="page-heading"><div><p className="eyebrow">REPOSITORY INTELLIGENCE</p><h1>{page.label}</h1><p className="page-description">{page.description}</p></div><Badge>Workspace preview</Badge></div>
    <Card className="empty-state"><div className="empty-symbol"><Icon size={32} strokeWidth={1.5} aria-hidden="true" /></div><Badge>Coming soon</Badge><h2>{path === '/' ? 'Every repository has a story.' : `${page.label} is on the way.`}</h2><p>{path === '/' ? 'Start with a public GitHub repository. RepoLens will turn its activity into a clearer picture of the project.' : page.detail}</p><div className="empty-note"><ScanLine size={16} aria-hidden="true" /><span>{path === '/' ? 'Search above to select a public GitHub repository.' : state.status === 'success' ? 'Repository selected. Detailed analytics are coming in a later phase.' : 'Select a repository using the search above.'}</span></div></Card>
    {path === '/' && <div className="overview-grid"><Card><span className="section-icon"><Github size={20} aria-hidden="true" /></span><h2>Real data. Clear context.</h2><p>Future analytics will come from the GitHub API, with sources and data coverage made explicit.</p><Link className="text-link" to={{ pathname: "/health", search: location.search }}>About maintenance insights<ArrowRight size={16} aria-hidden="true" /></Link></Card><Card><span className="section-icon"><BookOpen size={20} aria-hidden="true" /></span><h2>A foundation to build on.</h2><p>The workspace is ready. Connect with the existing backend documentation to explore the current API.</p><a className="text-link" href={`${API_BASE_URL}/docs`} target="_blank" rel="noreferrer">Open API documentation<ArrowRight size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></Card></div>}
  </>;
}
