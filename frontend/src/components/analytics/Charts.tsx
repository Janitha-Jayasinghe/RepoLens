import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { formatCount } from '../../services/format';
import { formatPercent } from '../../services/analytics';

export interface ChartDatum { name: string; value: number; percent?: number; }
export const chartColors = ['var(--accent)', 'rgb(255 95 0 / .78)', 'rgb(255 95 0 / .56)', 'var(--foreground)', 'rgb(255 95 0 / .34)', 'var(--muted)'];
export function ChartTooltip({ active, payload, unit }: TooltipContentProps & { unit: 'bytes' | 'contributions' }) {
  const item = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !item) return null;
  return <div className="chart-tooltip"><strong>{item.name}</strong><p>{formatCount(item.value)} {unit}</p>{item.percent !== undefined && <p>{formatPercent(item.percent)} of detected bytes</p>}</div>;
}
export function HorizontalChart({ data, unit, selected, onSelect }: { data: ChartDatum[]; unit: 'bytes' | 'contributions'; selected?: string | null; onSelect?: (name: string) => void }) {
  const height = Math.max(240, data.length * 43 + 40);
  return <div className="horizontal-chart" style={{ height }} aria-label={`${unit === 'bytes' ? 'Language distribution' : 'Contributor contributions'} chart`}><ResponsiveContainer width="100%" height="100%" minWidth={0}>
    <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 8, bottom: 10 }} accessibilityLayer>
      <CartesianGrid stroke="var(--border)" horizontal={false} strokeDasharray="3 3" />
      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={value => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(Number(value))} />
      <YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false} tick={{ fill: 'var(--foreground)', fontSize: 10 }} tickFormatter={value => String(value).length > 15 ? String(value).slice(0, 13) + '\u2026' : String(value)} interval={0} />
      <Tooltip content={props => <ChartTooltip {...props} unit={unit} />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
      <Bar dataKey="value" name={unit} fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false} activeBar={{ fill: 'var(--accent)', stroke: 'var(--foreground)' }} onClick={entry => onSelect?.(String(entry.name))}>
        {data.map((item, index) => <Cell key={item.name} fill={unit === 'bytes' ? chartColors[index % chartColors.length] : 'var(--accent)'} opacity={selected && item.name !== selected ? 0.25 : 1} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer></div>;
}
