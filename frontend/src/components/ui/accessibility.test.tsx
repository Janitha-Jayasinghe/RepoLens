// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';
import { Button, Tooltip } from './primitives';
import { ThemeProvider } from '../../hooks/useTheme';
import { SettingsPage } from '../../pages/SettingsPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe('keyboard and recovery', () => {
  it('activates a button with the keyboard', async () => {
    const click = vi.fn(); render(<Button onClick={click}>Refresh</Button>);
    const user = userEvent.setup(); await user.tab(); await user.keyboard('{Enter}'); expect(click).toHaveBeenCalledOnce();
  });
  it('does not activate disabled requests', async () => {
    const click = vi.fn(); render(<Button disabled onClick={click}>Refresh</Button>);
    await userEvent.setup().click(screen.getByRole('button')); expect(click).not.toHaveBeenCalled();
  });
  it('dismisses a keyboard tooltip with Escape', async () => {
    render(<Tooltip label="Help"><Button>Details</Button></Tooltip>);
    const user = userEvent.setup(); await user.tab(); await user.keyboard('{Escape}');
    expect(screen.getByRole('tooltip').parentElement?.className).toContain('tooltip-dismissed');
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });
  it('recovers a failed page without removing its surrounding shell', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); let broken = true;
    function Page() { if (broken) throw new Error('test-only failure'); return <h1>Recovered page</h1>; }
    render(<><nav>Workspace navigation</nav><ErrorBoundary scoped><Page /></ErrorBoundary></>);
    expect(screen.getByRole('alert').textContent).toContain('could not be displayed');
    expect(screen.getByRole('navigation')).toBeTruthy(); broken = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try page again' }));
    expect(screen.getByRole('heading', { name: 'Recovered page' })).toBeTruthy();
  });
  it('retains a global recovery fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() { throw new Error('test'); return null; }
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
  });
  it('changes and persists the selected theme through keyboard controls', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<ThemeProvider><SettingsPage /></ThemeProvider>); const user = userEvent.setup();
    await user.tab(); await user.tab(); await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('repolens.theme')).toBe('light');
  });
});
