export type IssueState = 'all' | 'open' | 'closed';
export type PullState = IssueState | 'merged';
export type WorkKind = 'issues' | 'pulls';
export interface WorkCount { value: number | null; complete: boolean; source_url: string; note: string; }
export interface WorkSummaryResponse {
  repository: string;
  open_issues: WorkCount;
  closed_issues: WorkCount;
  open_pull_requests: WorkCount;
  merged_pull_requests: WorkCount;
  analyzed_at: string;
  cached: boolean;
  cache_expires_at: string;
  coverage_note: string;
}
export interface WorkItem {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed' | 'merged';
  author_login: string | null;
  author_url: string | null;
  comments: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}
export interface WorkPageResponse {
  repository: string;
  kind: WorkKind;
  state_filter: PullState;
  items: WorkItem[];
  page: number;
  per_page: number;
  scanned_count: number;
  returned_count: number;
  has_next: boolean;
  has_previous: boolean;
  analyzed_at: string;
  cached: boolean;
  cache_expires_at: string;
  coverage_note: string;
  source_url: string;
}
export interface WorkUpdateDay { date: string; issues: number; pulls: number; }
