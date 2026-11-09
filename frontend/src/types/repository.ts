/** Matches FastAPI Repository/AnalysisResponse in backend/main.py. */
export interface RepositoryOwner { login: string; avatar_url: string | null; html_url: string | null; }
export interface RepositoryLicense { key: string; name: string; spdx_id: string | null; }
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  owner: RepositoryOwner;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  subscribers_count: number | null;
  size: number | null;
  license: RepositoryLicense | null;
  topics: string[] | null;
  default_branch: string;
  language: string | null;
  archived: boolean;
  private: boolean;
  created_at: string;
  pushed_at: string | null;
}
export interface AnalysisResponse {
  requested_repo: string;
  repository: Repository;
  analyzed_at: string;
  source_url: string;
}
export interface ApiErrorDetail {
  code: string;
  message: string;
  retry_after?: number;
  reset_at?: string | null;
}
