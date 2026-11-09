import type { AnalysisResponse } from './repository';
import type { ContributorsResponse, LanguagesResponse } from './analytics';
import type { CommitDays, CommitHistoryResponse } from './commits';
import type { HealthResponse } from './health';
export interface SectionError { code: string; message: string; status: number; retry_after: number | null; }
export type SnapshotSection<T> = { status: 'available'; data: T; error: null } | { status: 'unavailable'; data: null; error: SectionError };
export interface AnalyticsSnapshot {
  id: string;
  overview: AnalysisResponse;
  days: CommitDays;
  languages: SnapshotSection<LanguagesResponse>;
  contributors: SnapshotSection<ContributorsResponse>;
  commits: SnapshotSection<CommitHistoryResponse>;
  health: SnapshotSection<HealthResponse>;
  analyzed_at: string;
  expires_at: string;
  cached: boolean;
  collection_complete: boolean;
  rate_limited: boolean;
  retry_after: number | null;
  notes: string[];
}
