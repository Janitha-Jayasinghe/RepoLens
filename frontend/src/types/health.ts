export interface HealthFactor {
  id: 'commits' | 'readme' | 'license' | 'releases' | 'issues' | 'pulls';
  label: string;
  weight: number;
  score: number | null;
  status: 'assessed' | 'unavailable';
  rule: string;
  explanation: string;
  evidence: string[];
  source_urls: string[];
  suggestion: string | null;
}
export interface HealthResponse {
  repository: string;
  methodology_version: string;
  status: 'complete' | 'incomplete';
  score: number | null;
  observed_points: number;
  available_weight: number;
  lower_bound: number;
  upper_bound: number;
  factors: HealthFactor[];
  maintenance_suggestions: string[];
  data_suggestions: string[];
  limitations: string[];
  analyzed_at: string;
  cached: boolean;
  cache_expires_at: string | null;
  rate_limited: boolean;
  retry_after: number | null;
}
