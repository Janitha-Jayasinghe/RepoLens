import type { LucideIcon } from 'lucide-react';
import { formatCount } from '../../services/format';
import { Card } from './primitives';

export function StatCard({ label, value, icon: Icon, description }: { label: string; value: number | null; icon: LucideIcon; description: string }) {
  return <Card className="stat-card" aria-label={label}>
    <div className="stat-heading"><h2>{label}</h2><Icon size={19} aria-hidden="true" /></div>
    <p className={`stat-value ${value === null ? 'stat-unavailable' : ''}`}>{formatCount(value)}</p>
    <p className="stat-description">{description}</p>
  </Card>;
}
