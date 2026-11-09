import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ThemeProvider } from '../hooks/useTheme';
import { WorkspacePage } from '../pages/WorkspacePage';
import { LoadingCard } from '../components/ui/primitives';
import { OverviewPage } from '../pages/OverviewPage';
import { SettingsPage } from '../pages/SettingsPage';
import { RepositoryProvider } from '../hooks/useRepository';
import { navigation } from './navigation';

const ComparisonPage = lazy(() => import('../pages/ComparisonPage').then(module => ({ default: module.ComparisonPage })));
const ReportsPage = lazy(() => import('../pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const HealthPage = lazy(() => import('../pages/HealthPage').then(module => ({ default: module.HealthPage })));
const IssuesPage = lazy(() => import('../pages/IssuesPage').then(module => ({ default: module.IssuesPage })));
const CommitsPage = lazy(() => import('../pages/CommitsPage').then(module => ({ default: module.CommitsPage })));
const LanguagesPage = lazy(() => import('../pages/LanguagesPage').then(module => ({ default: module.LanguagesPage })));
const ContributorsPage = lazy(() => import('../pages/ContributorsPage').then(module => ({ default: module.ContributorsPage })));

export function App() {
  return <ThemeProvider><RepositoryProvider><Routes><Route element={<AppShell />}>
    {navigation.filter(item => !['/settings', '/', '/languages', '/contributors', '/commits', '/issues', '/health', '/comparison', '/reports'].includes(item.path)).map(item => <Route key={item.path} path={item.path} element={<WorkspacePage path={item.path} />} />)}
    <Route path="/comparison" element={<Suspense fallback={<LoadingCard />}><ComparisonPage /></Suspense>} />
    <Route path="/reports" element={<Suspense fallback={<LoadingCard />}><ReportsPage /></Suspense>} />
    <Route path="/health" element={<Suspense fallback={<LoadingCard />}><HealthPage /></Suspense>} />
    <Route path="/issues" element={<Suspense fallback={<LoadingCard />}><IssuesPage /></Suspense>} />
    <Route path="/commits" element={<Suspense fallback={<LoadingCard />}><CommitsPage /></Suspense>} />
    <Route path="/languages" element={<Suspense fallback={<LoadingCard />}><LanguagesPage /></Suspense>} />
    <Route path="/contributors" element={<Suspense fallback={<LoadingCard />}><ContributorsPage /></Suspense>} />
    <Route path="/" element={<OverviewPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<section className="empty-state"><h1>Page not found</h1><p>This page does not exist in your workspace.</p><Link className="text-link" to="/">Return to Overview</Link></section>} />
  </Route></Routes></RepositoryProvider></ThemeProvider>;
}
