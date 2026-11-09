export interface LanguagesResponse {
  repository: string;
  languages: Record<string, number>;
  total_bytes: number;
  analyzed_at: string;
  source_url: string;
}
export interface Contributor {
  id: number;
  login: string;
  html_url: string;
  avatar_url: string | null;
  contributions: number;
  type: string;
}
export interface ContributorsResponse {
  repository: string;
  contributors: Contributor[];
  returned_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
  coverage_note: string;
  analyzed_at: string;
  source_url: string;
}
export interface LanguageDatum { name: string; value: number; percent: number; }
