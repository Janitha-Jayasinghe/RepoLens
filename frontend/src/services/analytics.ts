import { apiGet, ApiError } from './api';
import type { ContributorsResponse, LanguageDatum, LanguagesResponse } from '../types/analytics';
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function url(value: unknown, hosts: string[]): boolean {
  if (typeof value !== 'string') return false;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && hosts.includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port; } catch { return false; }
}
function base(value: Record<string, unknown>): boolean {
  return typeof value.repository === 'string' && /^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(value.repository) && typeof value.analyzed_at === 'string' && Number.isFinite(Date.parse(value.analyzed_at)) && url(value.source_url, ['api.github.com']);
}
export function isLanguagesResponse(value: unknown): value is LanguagesResponse {
  if (!record(value) || !base(value) || !record(value.languages) || !count(value.total_bytes)) return false;
  return Object.entries(value.languages).every(([name, bytes]) => !!name && count(bytes)) && Object.values(value.languages).reduce<number>((total, bytes) => total + (bytes as number), 0) === value.total_bytes;
}
export function isContributorsResponse(value: unknown): value is ContributorsResponse {
  if (!record(value) || !base(value) || !Array.isArray(value.contributors) || value.page !== 1 || value.per_page !== 10 || value.contributors.length > 10 || value.returned_count !== value.contributors.length || typeof value.has_more !== 'boolean' || typeof value.coverage_note !== 'string') return false;
  return value.contributors.every(item => record(item) && count(item.id) && typeof item.login === 'string' && !!item.login && url(item.html_url, ['github.com']) && (item.avatar_url === null || url(item.avatar_url, ['avatars.githubusercontent.com', 'github.com'])) && count(item.contributions) && typeof item.type === 'string');
}
export async function fetchLanguages(repo: string, signal?: AbortSignal): Promise<LanguagesResponse> {
  const value = await apiGet<unknown>(`api/languages?${new URLSearchParams({ repo })}`, signal);
  if (!isLanguagesResponse(value) || value.repository !== repo) throw new ApiError('The backend returned an unexpected language response.', 'invalid_response');
  return value;
}
export async function fetchContributors(repo: string, signal?: AbortSignal): Promise<ContributorsResponse> {
  const value = await apiGet<unknown>(`api/contributors?${new URLSearchParams({ repo })}`, signal);
  if (!isContributorsResponse(value) || value.repository !== repo) throw new ApiError('The backend returned an unexpected contributor response.', 'invalid_response');
  return value;
}
export function languageDistribution(languages: Record<string, number>): LanguageDatum[] {
  const total = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);
  return Object.entries(languages).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value, percent: total ? value / total * 100 : 0 }));
}
export function formatPercent(value: number): string { return value > 0 && value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`; }
