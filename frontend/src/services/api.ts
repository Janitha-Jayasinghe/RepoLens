import type { AnalysisResponse, ApiErrorDetail } from '../types/repository';

const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim() ||'http://127.0.0.1:8000';
const parsedUrl = new URL(configuredUrl);
if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('VITE_API_BASE_URL must use HTTP or HTTPS.');
export const API_BASE_URL = configuredUrl.replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number = 0, public readonly retryAfter?: number) { super(message); this.name = 'ApiError'; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function errorDetail(body: unknown): Partial<ApiErrorDetail> {
  if (!record(body)) return {};
  const detail = body.detail;
  if (typeof detail === 'string') return { message: detail };
  if (Array.isArray(detail)) return { message: 'The backend rejected the repository input. Check the owner and name.' };
  if (!record(detail)) return {};
  return { message: typeof detail.message === 'string' ? detail.message : undefined, code: typeof detail.code === 'string' ? detail.code : undefined, retry_after: typeof detail.retry_after === 'number' ? detail.retry_after : undefined };
}
export async function apiRequest(path: string, signal?: AbortSignal, timeoutMs = 30000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/${path.replace(/^\/+/, '')}`, { headers: { Accept: path.endsWith('.pdf') ? 'application/pdf' : 'application/json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new ApiError('The request timed out. Please try again.', 'timeout');
    throw new ApiError('Cannot reach the RepoLens API. Check your connection and make sure the backend is running.', 'network');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = errorDetail(body);
    const header = response.headers.get('Retry-After');
    const retry = detail.retry_after ?? (header && /^\d+$/.test(header) ? Number(header) : undefined);
    throw new ApiError(detail.message || `The backend could not complete the request (HTTP ${response.status}).`, detail.code || (response.status === 429 ? 'github_rate_limited' : 'http_error'), response.status, retry);
  }
  return response;
}
export async function apiGet<T>(path: string, signal?: AbortSignal, timeoutMs = 30000): Promise<T> {
  return (await apiRequest(path, signal, timeoutMs)).json().catch(() => null) as Promise<T>;
}
/** Reject schema mismatches explicitly instead of rendering undefined or invented values. */
export function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (!record(value) || !record(value.repository)) return false;
  const repo = value.repository;
  const strings = ['name', 'full_name', 'html_url', 'default_branch', 'created_at'];
  const numbers = ['id', 'stargazers_count', 'forks_count', 'open_issues_count'];
  if (!strings.every(key => typeof repo[key] === 'string') || !numbers.every(key => typeof repo[key] === 'number' && Number.isFinite(repo[key]) && repo[key] >= 0)) return false;
  const nullableCount = (value: unknown) => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  const nullableUrl = (value: unknown, hosts: string[]) => {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    try { const url = new URL(value); return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password && !url.port; } catch { return false; }
  };
  if (!nullableCount(repo.subscribers_count) || !nullableCount(repo.size) || !(repo.topics === null || (Array.isArray(repo.topics) && repo.topics.every(topic => typeof topic === 'string')))) return false;
  if (!(repo.license === null || (record(repo.license) && typeof repo.license.key === 'string' && typeof repo.license.name === 'string' && (repo.license.spdx_id === null || typeof repo.license.spdx_id === 'string')))) return false;
  if (typeof repo.created_at !== 'string' || !Number.isFinite(Date.parse(repo.created_at)) || !(repo.pushed_at === null || (typeof repo.pushed_at === 'string' && Number.isFinite(Date.parse(repo.pushed_at))))) return false;
  return record(repo.owner) && nullableUrl(repo.owner.avatar_url, ['avatars.githubusercontent.com', 'github.com']) && nullableUrl(repo.owner.html_url, ['github.com']) && typeof repo.owner.login === 'string' && typeof repo.archived === 'boolean' && repo.private === false &&
    (repo.description === null || typeof repo.description === 'string') && (repo.language === null || typeof repo.language === 'string') &&
    (repo.pushed_at === null || typeof repo.pushed_at === 'string') && typeof value.requested_repo === 'string' &&
    typeof value.analyzed_at === 'string' && Number.isFinite(Date.parse(value.analyzed_at)) &&
    typeof value.source_url === 'string' && value.source_url === `https://github.com/${repo.full_name}` && repo.html_url === value.source_url;
}
export async function analyzeRepository(repo: string, signal?: AbortSignal): Promise<AnalysisResponse> {
  const value = await apiGet<unknown>(`api/analyze?${new URLSearchParams({ repo })}`, signal);
  if (!isAnalysisResponse(value)) throw new ApiError('The backend returned an unexpected repository response. Check that both servers use the current schema.', 'invalid_response');
  return value;
}
