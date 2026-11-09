export interface CommitRecord {
  sha: string;
  html_url: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  author_url: string | null;
  avatar_url: string | null;
  authored_at: string | null;
  committed_at: string;
}
export interface CommitActivityDay { date: string; count: number; }
export type CommitDays = 7 | 30 | 90;
export interface CommitHistoryResponse {
  repository: string;
  default_branch: string;
  head_sha: string | null;
  commits: CommitRecord[];
  fetched_count: number;
  days: CommitDays;
  author_filter: string | null;
  range_start: string;
  range_end: string;
  complete: boolean;
  has_more: boolean;
  pages_fetched: number;
  max_pages: number;
  per_page: number;
  activity: CommitActivityDay[] | null;
  coverage_note: string;
  analyzed_at: string;
  source_url: string;
}
