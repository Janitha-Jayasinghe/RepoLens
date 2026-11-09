import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { WorkUpdateDay } from '../../types/workItems';
import { formatCount, formatDate } from '../../services/format';

export interface WorkStateDatum { name: string; value: number; }
function StateTooltip({ active, payload }: TooltipContentProps) {
  const item = payload?.[0]?.payload as WorkStateDatum | undefined;
  return active && item ? <div className="chart-tooltip"><strong>{item.name}</strong><p>{formatCount(item.value)} GitHub-reported items</p></div> : null;
}
export function WorkStateChart({ data }: { data: WorkStateDatum[] }) {
  return <div className="work-chart" aria-label="GitHub-reported state distribution chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={data} layout="vertical" margin={{ top: 12, right: 12, bottom: 8, left: 0 }} accessibilityLayer><CartesianGrid stroke="var(--border)" horizontal={false} strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={value => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(Number(value))} /><YAxis type="category" dataKey="name" width={95} tickLine={false} axisLine={false} tick={{ fill: 'var(--foreground)', fontSize: 10 }} /><Tooltip content={props => <StateTooltip {...props} />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} /><Bar dataKey="value" fill="var(--accent)" barSize={23} radius={[0, 4, 4, 0]} isAnimationActive={false} activeBar={{ fill: 'var(--accent-hover)', stroke: 'var(--foreground)' }} /></BarChart></ResponsiveContainer></div>;
}
function UpdateTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as WorkUpdateDay | undefined;
  return active && day ? <div className="chart-tooltip"><strong>{formatDate(day.date + 'T00:00:00Z')} UTC</strong><p>{formatCount(day.issues)} loaded issues last updated</p><p>{formatCount(day.pulls)} loaded PRs last updated</p></div> : null;
}
export function WorkUpdatesChart({ data }: { data: WorkUpdateDay[] }) {
  return <><div className="work-chart" aria-label="Latest update dates in loaded pages chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={data} margin={{ top: 12, right: 8, bottom: 8, left: -20 }} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={25} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(String(date) + 'T00:00:00Z'))} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} /><Tooltip content={props => <UpdateTooltip {...props} />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} /><Bar dataKey="issues" name="Loaded issues" stackId="items" fill="var(--foreground)" fillOpacity={0.65} isAnimationActive={false} activeBar={{ stroke: 'var(--foreground)' }} /><Bar dataKey="pulls" name="Loaded PRs" stackId="items" fill="var(--accent)" isAnimationActive={false} activeBar={{ stroke: 'var(--foreground)' }} /></BarChart></ResponsiveContainer></div><div className="work-chart-legend"><span><i style={{ background: 'var(--foreground)' }} />Loaded issues</span><span><i style={{ background: 'var(--accent)' }} />Loaded pull requests</span></div></>;
}
