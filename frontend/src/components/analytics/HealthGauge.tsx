export function HealthGauge({ score }: { score: number | null }) {
  const radius = 72, circumference = 2 * Math.PI * radius;
  return <div className={`health-gauge ${score === null ? 'health-gauge-incomplete' : ''}`} role="img" aria-label={score === null ? 'Maintenance assessment incomplete; overall score unavailable' : `Maintenance-signal score ${score} out of 100`}>
    <svg viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r={radius} fill="none" stroke="var(--border)" strokeWidth="9" /><circle cx="90" cy="90" r={radius} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={score === null ? '5 8' : circumference} strokeDashoffset={score === null ? 0 : circumference * (1 - score / 100)} transform="rotate(-90 90 90)" /></svg>
    <div className="health-gauge-value"><strong>{score === null ? 'N/A' : score}</strong><span>{score === null ? 'Unscored' : 'out of 100'}</span></div>
  </div>;
}
