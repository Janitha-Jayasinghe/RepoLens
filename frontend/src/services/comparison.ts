import type { AnalyticsSnapshot } from '../types/snapshot';
export interface ComparisonDatum { name: string; left: number | null; right: number | null; }
export function countComparison(left: AnalyticsSnapshot, right: AnalyticsSnapshot): ComparisonDatum[] {
  return [{ name: 'Stars', left: left.overview.repository.stargazers_count, right: right.overview.repository.stargazers_count }, { name: 'Forks', left: left.overview.repository.forks_count, right: right.overview.repository.forks_count }];
}
export function languageComparison(left: AnalyticsSnapshot, right: AnalyticsSnapshot): ComparisonDatum[] {
  const a = left.languages.status === 'available' ? left.languages.data : null;
  const b = right.languages.status === 'available' ? right.languages.data : null;
  const names = new Set([...Object.keys(a?.languages ?? {}), ...Object.keys(b?.languages ?? {})]);
  const percent = (data: typeof a, name: string) => !data || !data.total_bytes ? null : (data.languages[name] ?? 0) / data.total_bytes * 100;
  return [...names].map(name => ({ name, left: percent(a, name), right: percent(b, name) })).sort((x, y) => (y.left ?? 0) + (y.right ?? 0) - (x.left ?? 0) - (x.right ?? 0)).slice(0, 6);
}
export function completeCommitCount(snapshot: AnalyticsSnapshot): number | null { return snapshot.commits.status === 'available' && snapshot.commits.data.complete ? snapshot.commits.data.fetched_count : null; }
export function completeHealthScore(snapshot: AnalyticsSnapshot): number | null { return snapshot.health.status === 'available' ? snapshot.health.data.score : null; }
