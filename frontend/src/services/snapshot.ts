import { apiGet, apiRequest, ApiError, isAnalysisResponse } from './api';
import { isContributorsResponse, isLanguagesResponse } from './analytics';
import { isCommitHistoryResponse } from './commits';
import { isHealthResponse } from './health';
import type { AnalyticsSnapshot, SnapshotSection } from '../types/snapshot';
import type { CommitDays } from '../types/commits';
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function time(value: unknown): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function section<T>(value: unknown, validate: (data: unknown) => data is T): value is SnapshotSection<T> {
  return record(value) && (value.status === 'available' ? value.error === null && validate(value.data) : value.status === 'unavailable' && value.data === null && record(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string' && typeof value.error.status === 'number' && (value.error.retry_after === null || (typeof value.error.retry_after === 'number' && value.error.retry_after > 0)));
}
export function isSnapshot(value: unknown): value is AnalyticsSnapshot {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id) || !isAnalysisResponse(value.overview) || ![7, 30, 90].includes(Number(value.days)) || typeof value.days !== 'number' || !section(value.languages, isLanguagesResponse) || !section(value.contributors, isContributorsResponse) || !section(value.commits, isCommitHistoryResponse) || !section(value.health, isHealthResponse) || !time(value.analyzed_at) || !time(value.expires_at) || typeof value.cached !== 'boolean' || typeof value.collection_complete !== 'boolean' || typeof value.rate_limited !== 'boolean' || !Array.isArray(value.notes) || !value.notes.every(note => typeof note === 'string')) return false;
  if (value.rate_limited ? !(typeof value.retry_after === 'number' && value.retry_after > 0) : value.retry_after !== null) return false;
  const canonical = value.overview.repository.full_name;
  const sections = [value.languages, value.contributors, value.commits, value.health];
  if (sections.some(item => item.status === 'available' && item.data.repository !== canonical) || value.collection_complete !== sections.every(item => item.status === 'available')) return false;
  return value.commits.status !== 'available' || value.commits.data.days === value.days;
}
export async function fetchSnapshot(repo: string, days: CommitDays, signal?: AbortSignal, refresh = false): Promise<AnalyticsSnapshot> {
  const query = new URLSearchParams({ repo, days: String(days) }); if (refresh) query.set('refresh', 'true');
  const value = await apiGet<unknown>(`api/snapshot?${query}`, signal, 65000);
  if (!isSnapshot(value) || value.days !== days) throw new ApiError('The backend returned an inconsistent analytics snapshot.', 'invalid_response');
  return value;
}
export async function fetchReportPdf(id: string, signal?: AbortSignal): Promise<Blob> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError('Prepare a valid snapshot before exporting.', 'invalid_snapshot');
  const response = await apiRequest(`api/reports/${id}.pdf`, signal);
  if (!response.headers.get('Content-Type')?.includes('application/pdf')) throw new ApiError('The server did not return a PDF document.', 'invalid_pdf');
  const blob = await response.blob();
  if (new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new ApiError('The downloaded document was not a valid PDF.', 'invalid_pdf');
  return blob;
}
export function reportFilename(snapshot: AnalyticsSnapshot): string { return `repolens-${snapshot.overview.repository.full_name.replace(/[^a-z0-9_.-]/gi, '-')}-${snapshot.analyzed_at.slice(0, 10)}.pdf`; }
