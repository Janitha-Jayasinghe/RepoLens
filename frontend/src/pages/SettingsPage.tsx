import { Moon, Sun } from 'lucide-react';
import { Badge, Button, Card } from '../components/ui/primitives';
import { useTheme } from '../hooks/useTheme';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return <><div className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Settings</h1><p className="page-description">A workspace that feels like yours.</p></div></div>
    <Card><h2>Appearance</h2><p>Choose your preferred theme. Your choice is saved on this device when browser storage is available.</p><div className="theme-options" role="group" aria-label="Color theme"><Button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={18} aria-hidden="true" />Dark</Button><Button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={18} aria-hidden="true" />Light</Button></div></Card>
    <Card className="settings-future"><div className="card-title-row"><h2>Repository preferences</h2><Badge>Coming soon</Badge></div><p>Default repository and saved chart preferences are planned. Repository analytics are available now; automatic refresh is intentionally disabled to respect GitHub API limits.</p></Card>
  </>;
}
