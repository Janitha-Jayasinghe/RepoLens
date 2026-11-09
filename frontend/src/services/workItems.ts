import { apiGet, ApiError } from './api';
import type { PullState, WorkCount, WorkItem, WorkKind, WorkPageResponse, WorkSummaryResponse, WorkUpdateDay } from '../types/workItems';
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function url(value: unknown, host: string): boolean { if (typeof value !== 'string') return false; try { const parsed = new URL(value); return parsed.protocol === 'https:' && parsed.hostname === host && !parsed.username && !parsed.password && !parsed.port; } catch { return false; } }
function snapshot(value: Record<string, unknown>): boolean { return typeof value.repository === 'string' && typeof value.cached === 'boolean' && timestamp(value.analyzed_at) && timestamp(value.cache_expires_at) && typeof value.coverage_note === 'string'; }
function count(value: unknown): value is WorkCount {
  return record(value) && typeof value.complete === 'boolean' && (value.complete ? integer(value.value) : value.value === null) && url(value.source_url, 'api.github.com') && typeof value.note === 'string';
}
export function isWorkSummaryResponse(value: unknown): value is WorkSummaryResponse { return record(value) && snapshot(value) && ['open_issues', 'closed_issues', 'open_pull_requests', 'merged_pull_requests'].every(key => count(value[key])); }
export function isWorkPageResponse(value: unknown): value is WorkPageResponse {
  if (!record(value) || !snapshot(value) || !['issues', 'pulls'].includes(String(value.kind)) || !['all', 'open', 'closed', 'merged'].includes(String(value.state_filter)) || (value.kind === 'issues' && value.state_filter === 'merged') || !integer(value.page) || value.page < 1 || value.page > 1000 || !integer(value.per_page) || value.per_page < 1 || value.per_page > 100 || !integer(value.scanned_count) || value.scanned_count > value.per_page || !Array.isArray(value.items) || value.returned_count !== value.items.length || value.items.length > value.scanned_count || typeof value.has_next !== 'boolean' || value.has_previous !== (value.page > 1) || !url(value.source_url, 'api.github.com')) return false;
  const numbers = new Set<number>();
  return value.items.every(item => {
    if (!record(item) || !integer(item.number) || item.number < 1 || numbers.has(item.number) || typeof item.title !== 'string' || !['open', 'closed', 'merged'].includes(String(item.state)) || (value.kind === 'issues' && (item.state === 'merged' || item.merged_at !== null)) || (value.state_filter !== 'all' && item.state !== value.state_filter) || item.html_url !== `https://github.com/${value.repository}/${value.kind === 'issues' ? 'issues' : 'pull'}/${item.number}` || !(item.author_login === null || typeof item.author_login === 'string') || !(item.author_url === null || url(item.author_url, 'github.com')) || !(item.comments === null || integer(item.comments)) || !timestamp(item.created_at) || !timestamp(item.updated_at) || !(item.closed_at === null || timestamp(item.closed_at)) || !(item.merged_at === null || timestamp(item.merged_at)) || (item.state === 'merged') !== (item.merged_at !== null)) return false;
    numbers.add(item.number); return true;
  });
}
export async function fetchWorkSummary(repo: string, signal?: AbortSignal, refresh = false): Promise<WorkSummaryResponse> {
  const query = new URLSearchParams({ repo }); if (refresh) query.set('refresh', 'true');
  const value = await apiGet<unknown>(`api/work-items/summary?${query}`, signal);
  if (!isWorkSummaryResponse(value) || value.repository !== repo) throw new ApiError('The backend returned an inconsistent issue/PR summary.', 'invalid_response');
  return value;
}
export async function fetchWorkPage(repo: string, kind: WorkKind, state: PullState, page: number, signal?: AbortSignal, refresh = false): Promise<WorkPageResponse> {
  const query = new URLSearchParams({ repo, state, page: String(page), per_page: '20' }); if (refresh) query.set('refresh', 'true');
  const value = await apiGet<unknown>(`api/${kind === 'issues' ? 'issues' : 'pull-requests'}?${query}`, signal);
  if (!isWorkPageResponse(value) || value.repository !== repo || value.kind !== kind || value.state_filter !== state || value.page !== page) throw new ApiError('The backend returned an inconsistent issue/PR page.', 'invalid_response');
  return value;
}
/** Counts each loaded row once by its latest updated_at; this is not a repository-wide event history. */
export function groupPageUpdates(issues: WorkItem[], pulls: WorkItem[]): WorkUpdateDay[] {
  const days = new Map<string, WorkUpdateDay>();
  for (const [kind, items] of [['issues', issues], ['pulls', pulls]] as const) {
    const seen = new Set<number>();
    for (const item of items) {
      if (seen.has(item.number)) continue;
      seen.add(item.number);
      const date = new Date(item.updated_at).toISOString().slice(0, 10);
      const day = days.get(date) || { date, issues: 0, pulls: 0 }; day[kind]++; days.set(date, day);
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
