const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const timestampFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
export function formatCount(value: number | null): string { return value === null ? 'Not reported' : countFormat.format(value); }
export function formatSize(kilobytes: number | null): string { return kilobytes === null ? 'Not reported' : `${formatCount(kilobytes)} KB`; }
export function formatDate(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : 'Not reported'; }
export function formatTimestamp(value: string): string { return Number.isFinite(Date.parse(value)) ? `${timestampFormat.format(new Date(value))} UTC` : 'Not reported'; }
