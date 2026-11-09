import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { CommitActivityDay } from '../../types/commits';
import { formatCount, formatDate } from '../../services/format';

function ActivityTooltip({ active, payload }: TooltipContentProps) {
  const item = payload?.[0]?.payload as CommitActivityDay | undefined;
  return active && item ? <div className="chart-tooltip"><strong>{formatDate(item.date + 'T00:00:00Z')} UTC</strong><p>{formatCount(item.count)} commits</p></div> : null;
}
export function CommitActivityChart({ data }: { data: CommitActivityDay[] }) {
  return <div className="commit-activity-chart" aria-label="Daily commit activity chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={data} accessibilityLayer margin={{ top: 15, right: 8, left: -15, bottom: 8 }}>
    <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
    <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={30} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(String(date) + 'T00:00:00Z'))} />
    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
    <Tooltip content={props => <ActivityTooltip {...props} />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
    <Bar dataKey="count" name="Commits" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} activeBar={{ fill: 'var(--accent-hover)', stroke: 'var(--foreground)' }} />
  </BarChart></ResponsiveContainer></div>;
}
