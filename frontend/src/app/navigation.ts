import { Activity, ArrowLeftRight, Braces, FileDown, GitCommitHorizontal, GitPullRequest, LayoutDashboard, Settings, Users } from 'lucide-react';
export const navigation = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, description: 'Your repository, at a glance.', detail: 'Explore repository metadata, stars, forks, and development signals in one place.' },
  { path: '/languages', label: 'Languages', icon: Braces, description: 'Understand what powers the project.', detail: 'Language breakdowns will use actual byte counts from the GitHub API.' },
  { path: '/contributors', label: 'Contributors', icon: Users, description: 'Meet the people behind the code.', detail: 'Explore contributor profiles and paginated contribution statistics.' },
  { path: '/commits', label: 'Commits', icon: GitCommitHorizontal, description: 'Follow the development story.', detail: 'Browse recent commits, authors, and available historical activity.' },
  { path: '/issues', label: 'Issues & Pull Requests', icon: GitPullRequest, description: 'Keep track of the conversation.', detail: 'Issues and pull requests will be reported separately, with clear data coverage.' },
  { path: '/health', label: 'Health', icon: Activity, description: 'See the signals of maintenance.', detail: 'An explainable maintenance assessment will show its criteria and missing signals.' },
  { path: '/comparison', label: 'Comparison', icon: ArrowLeftRight, description: 'Two repositories. A clearer perspective.', detail: 'Compare repository statistics and maintenance indicators side by side.' },
  { path: '/reports', label: 'Reports', icon: FileDown, description: 'Take your insights with you.', detail: 'Export available repository data, sources, and analysis timestamps to a PDF report.' },
  { path: '/settings', label: 'Settings', icon: Settings, description: 'Make the workspace yours.', detail: '' },
];
