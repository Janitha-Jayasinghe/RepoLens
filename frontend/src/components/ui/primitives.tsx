import { cloneElement, useId, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button type="button" className={`button button--${variant} ${className}`} {...props} />;
}
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />;
}
export function Badge({ children }: { children: ReactNode }) { return <span className="badge">{children}</span>; }
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props} />; }
export function Tooltip({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return <span className={`tooltip-wrap ${dismissed ? 'tooltip-dismissed' : ''}`} onMouseEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)} onKeyDown={event => { if (event.key === 'Escape') setDismissed(true); }}>{cloneElement(children, { 'aria-describedby': id })}<span id={id} role="tooltip" className="tooltip">{label}</span></span>;
}
export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`skeleton ${className}`} {...props} />;
}
export function LoadingCard() {
  return <Card aria-busy="true" aria-label="Loading repository"><span role="status" className="sr-only">Loading repository</span><Skeleton className="skeleton-heading" /><Skeleton /><Skeleton className="skeleton-short" /></Card>;
}
