import { apiGet, ApiError } from './api';
import type { CommitActivityDay, CommitDays, CommitHistoryResponse, CommitRecord } from '../types/commits';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const timestamp = (value: unknown): value is string => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const sha = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
function url(value: unknown, hosts: string[]): boolean {
  if (typeof value !== 'string') return false;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && hosts.includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port; } catch { return false; }
}
export function isCommitRecord(value: unknown): value is CommitRecord {
  return record(value) && sha(value.sha) && url(value.html_url, ['github.com']) && typeof value.message === 'string' && nullableText(value.author_name) && nullableText(value.author_login) && (value.author_url === null || url(value.author_url, ['github.com'])) && (value.avatar_url === null || url(value.avatar_url, ['avatars.githubusercontent.com', 'github.com'])) && (value.authored_at === null || timestamp(value.authored_at)) && timestamp(value.committed_at);
}
/** Zero-fill only an exhausted range; a partial sample must never create a historical chart. */
export function aggregateCommits(commits: CommitRecord[], start: string, end: string, complete: boolean): CommitActivityDay[] | null {
  if (!complete) return null;
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 90 * 86400000) throw new Error('Invalid activity range');
  const days = new Map<string, number>();
  const first = new Date(from); first.setUTCHours(0, 0, 0, 0);
  for (let current = first.getTime(); current <= to; current += 86400000) days.set(new Date(current).toISOString().slice(0, 10), 0);
  const seen = new Set<string>();
  for (const commit of commits) {
    if (seen.has(commit.sha)) continue;
    seen.add(commit.sha);
    const at = Date.parse(commit.committed_at);
    if (at < from || at > to || !Number.isFinite(at)) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return Array.from(days, ([date, count]) => ({ date, count }));
}
export function isCommitHistoryResponse(value: unknown): value is CommitHistoryResponse {
  if (!record(value) || typeof value.repository !== 'string' || typeof value.default_branch !== 'string' || !(value.head_sha === null || sha(value.head_sha)) || !Array.isArray(value.commits) || !value.commits.every(isCommitRecord) || value.fetched_count !== value.commits.length || ![7, 30, 90].includes(Number(value.days)) || typeof value.days !== 'number' || !nullableText(value.author_filter) || !timestamp(value.range_start) || !timestamp(value.range_end) || !timestamp(value.analyzed_at) || typeof value.complete !== 'boolean' || value.has_more !== !value.complete || !integer(value.pages_fetched) || value.max_pages !== 5 || value.per_page !== 100 || value.pages_fetched > 5 || value.commits.length > 500 || typeof value.coverage_note !== 'string' || !url(value.source_url, ['api.github.com'])) return false;
  if (new Set(value.commits.map(item => item.sha)).size !== value.commits.length || value.commits.some(item => item.html_url !== `https://github.com/${value.repository}/commit/${item.sha}` || Date.parse(item.committed_at) < Date.parse(value.range_start as string) || Date.parse(item.committed_at) > Date.parse(value.range_end as string))) return false;
  const firstDay = new Date(value.range_start); firstDay.setUTCHours(0, 0, 0, 0);
  const lastDay = new Date(value.range_end); lastDay.setUTCHours(0, 0, 0, 0);
  if (Date.parse(value.range_start) > Date.parse(value.range_end) || (lastDay.getTime() - firstDay.getTime()) / 86400000 + 1 !== value.days) return false;
  try {
    const expected = aggregateCommits(value.commits, value.range_start, value.range_end, value.complete);
    if (!value.complete) return value.activity === null;
    return Array.isArray(value.activity) && value.activity.length === value.days && JSON.stringify(expected) === JSON.stringify(value.activity);
  } catch { return false; }
}
export async function fetchCommits(repo: string, days: CommitDays, author: string, signal?: AbortSignal): Promise<CommitHistoryResponse> {
  const query = new URLSearchParams({ repo, days: String(days) }); if (author) query.set('author', author);
  const value = await apiGet<unknown>(`api/commits?${query}`, signal);
  if (!isCommitHistoryResponse(value) || value.repository !== repo || value.days !== days || value.author_filter !== (author || null)) throw new ApiError('The backend returned inconsistent commit history. No activity chart can be shown safely.', 'invalid_response');
  return value;
}
export function commitTitle(message: string): string { return message.split(/\r?\n/)[0]?.trim() || '(No commit message)'; }
export function filterCommits(commits: CommitRecord[], query: string): CommitRecord[] {
  const needle = query.trim().toLowerCase();
  return needle ? commits.filter(item => item.message.toLowerCase().includes(needle) || item.sha.toLowerCase().includes(needle)) : commits;
}
