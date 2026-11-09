import { useState } from 'react';
import { UserRound } from 'lucide-react';

export function OwnerAvatar({ login, url }: { login: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="owner-avatar avatar-fallback" role="img" aria-label={`${login} avatar unavailable`}><UserRound size={28} aria-hidden="true" /></span>;
  return <img className="owner-avatar" src={url} width={64} height={64} alt={`${login} avatar`} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
