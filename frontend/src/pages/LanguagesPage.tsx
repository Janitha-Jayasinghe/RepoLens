import { useState } from 'react';
import { Braces, Database, RefreshCw } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAnalytics } from '../hooks/useAnalytics';
import { fetchLanguages, formatPercent, languageDistribution } from '../services/analytics';
import { formatCount, formatTimestamp } from '../services/format';
import { AnalyticsState } from '../components/analytics/AnalyticsState';
import { chartColors, ChartTooltip, HorizontalChart } from '../components/analytics/Charts';
import { Badge, Button, Card } from '../components/ui/primitives';

export function LanguagesPage() {
  const resource = useAnalytics(fetchLanguages);
  const [selection, setSelection] = useState<{ repo: string; name: string } | null>(null);
  if (resource.status !== 'success') return <><PageHeading /><AnalyticsState {...resource} label="Language analytics" /></>;
  const data = resource.data;
  const rows = languageDistribution(data.languages);
  const selected = selection?.repo === data.repository && rows.some(row => row.name === selection.name) ? selection.name : null;
  function select(name: string) { setSelection(selected === name ? null : { repo: data.repository, name }); }
  return <><PageHeading /><div className="analytics-summary"><div><Database size={18} aria-hidden="true" /><span>Total detected language bytes<strong data-testid="language-total">{formatCount(data.total_bytes)} bytes</strong></span></div><Button onClick={resource.retry} disabled={resource.retrySeconds > 0}><RefreshCw size={15} aria-hidden="true" />Refresh languages</Button></div>
    {!rows.length ? <Card className="empty-state"><div className="empty-symbol"><Braces size={28} aria-hidden="true" /></div><h2>No language bytes detected</h2><p>GitHub returned no detected language bytes for this repository. No language distribution can be calculated.</p></Card> : <>
    <div className="language-chart-grid"><Card aria-label="Language composition"><h2>Language composition</h2><p>Share of detected bytes. Select a language below to highlight it.</p><div className="donut-chart" aria-label="Language doughnut chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart accessibilityLayer><Pie data={rows} dataKey="value" nameKey="name" innerRadius="56%" outerRadius="82%" paddingAngle={rows.length > 1 ? 1 : 0} stroke="var(--panel)" strokeWidth={2} isAnimationActive={false} onClick={entry => select(String(entry.name))}>{rows.map((row, index) => <Cell key={row.name} fill={chartColors[index % chartColors.length]} opacity={selected && selected !== row.name ? 0.25 : 1} />)}</Pie><Tooltip content={props => <ChartTooltip {...props} unit="bytes" />} isAnimationActive={false} /></PieChart></ResponsiveContainer></div>
    <ul className="language-legend" aria-label="Language legend">{rows.map((row, index) => <li key={row.name}><button type="button" aria-pressed={selected === row.name} onClick={() => select(row.name)}><span className="legend-swatch" style={{ background: chartColors[index % chartColors.length] }} /><span>{row.name}</span><strong>{formatPercent(row.percent)}</strong></button></li>)}</ul></Card>
    <Card aria-label="Language distribution"><h2>Language distribution</h2><p>Absolute byte counts, with the same full dataset as the doughnut.</p><HorizontalChart data={rows} unit="bytes" selected={selected} onSelect={select} /></Card></div>
    <Card aria-label="Language breakdown"><div className="card-title-row"><h2>Language breakdown</h2><Badge>{rows.length} detected languages</Badge></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="analytics-table"><caption className="sr-only">Language bytes and share of total detected bytes</caption><thead><tr><th scope="col">Language</th><th scope="col">Detected bytes</th><th scope="col">Share</th></tr></thead><tbody>{rows.map(row => <tr key={row.name} className={selected === row.name ? 'selected-row' : ''}><th scope="row">{row.name}</th><td>{formatCount(row.value)}</td><td>{formatPercent(row.percent)}</td></tr>)}</tbody></table></div><p className="analytics-footnote">Percentages are calculated from GitHub language byte counts and may not sum to 100% after rounding. These values do not measure code quality.</p></Card>
    </>}
    <div className="analytics-provenance"><a href={data.source_url} target="_blank" rel="noreferrer">GitHub language API source<span className="sr-only"> (opens in a new tab)</span></a><span>Retrieved {formatTimestamp(data.analyzed_at)}</span></div>
  </>;
}
function PageHeading() { return <div className="page-heading"><div><p className="eyebrow">REPOSITORY INTELLIGENCE</p><h1>Languages</h1><p className="page-description">Understand what powers the project.</p></div><Badge>Detected language bytes</Badge></div>; }
