import { apiGet, ApiError } from './api';
import type { HealthFactor, HealthResponse } from '../types/health';
const ids = ['commits', 'readme', 'license', 'releases', 'issues', 'pulls'];
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function sourceUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === 'https:' && ['api.github.com', 'github.com'].includes(url.hostname) && !url.username && !url.password && !url.port; } catch { return false; } }
function factor(value: unknown): value is HealthFactor {
  return record(value) && ids.includes(String(value.id)) && typeof value.label === 'string' && integer(value.weight) && value.weight > 0 && typeof value.rule === 'string' && typeof value.explanation === 'string' && strings(value.evidence) && strings(value.source_urls) && value.source_urls.every(sourceUrl) && (value.suggestion === null || typeof value.suggestion === 'string') && (value.status === 'unavailable' ? value.score === null : value.status === 'assessed' && integer(value.score) && value.score <= value.weight);
}
/** Validate the backend arithmetic; scoring rules are never duplicated or applied in the browser. */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (!record(value) || typeof value.repository !== 'string' || value.methodology_version !== 'maintenance-v1' || !Array.isArray(value.factors) || value.factors.length !== 6 || !value.factors.every(factor) || new Set(value.factors.map(item => item.id)).size !== 6 || !timestamp(value.analyzed_at) || typeof value.cached !== 'boolean' || !(value.cache_expires_at === null || timestamp(value.cache_expires_at)) || !strings(value.maintenance_suggestions) || !strings(value.data_suggestions) || !strings(value.limitations) || typeof value.rate_limited !== 'boolean' || (value.rate_limited ? !(typeof value.retry_after === 'number' && Number.isSafeInteger(value.retry_after) && value.retry_after > 0) : value.retry_after !== null)) return false;
  if (value.status === 'incomplete' && (value.cached || value.cache_expires_at !== null)) return false;
  if (value.status === 'complete' && !timestamp(value.cache_expires_at)) return false;
  const total = value.factors.reduce((sum, item) => sum + item.weight, 0);
  const assessed = value.factors.filter(item => item.score !== null);
  const weight = assessed.reduce((sum, item) => sum + item.weight, 0);
  const points = assessed.reduce((sum, item) => sum + (item.score ?? 0), 0);
  if (total !== 100 || value.available_weight !== weight || value.observed_points !== points || value.lower_bound !== points || value.upper_bound !== points + 100 - weight) return false;
  return weight === 100 ? value.status === 'complete' && value.score === points && !value.rate_limited : value.status === 'incomplete' && value.score === null;
}
export async function fetchHealth(repo: string, signal?: AbortSignal, refresh = false): Promise<HealthResponse> {
  const query = new URLSearchParams({ repo }); if (refresh) query.set('refresh', 'true');
  const value = await apiGet<unknown>(`api/health?${query}`, signal);
  if (!isHealthResponse(value) || value.repository !== repo) throw new ApiError('The backend returned inconsistent maintenance evidence. No overall score can be shown safely.', 'invalid_response');
  return value;
}
