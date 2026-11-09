import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, Moon, ScanLine, Sun, X } from 'lucide-react';
import { RepositorySearch } from './RepositorySearch';
import { RepositoryResult } from '../RepositoryResult';
import { navigation } from '../../app/navigation';
import { useRepository } from '../../hooks/useRepository';
import { useTheme } from '../../hooks/useTheme';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Button, Tooltip } from '../ui/primitives';
import Footer from "./Footer";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const { state } = useRepository();
  const { theme, setTheme } = useTheme();
  const page = navigation.find(item => item.path === location.pathname);
  useEffect(() => {
    setMobileOpen(false);
    document.title = `${page?.label ?? 'Page not found'} | RepoLens`;
    main.current?.focus();
  }, [location.pathname, page?.label]);
  useEffect(() => {
    if (mobileOpen) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
    const previous = document.body.style.overflow;
    if (mobileOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => { if (query.matches) setMobileOpen(false); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  function links(mobile = false) {
    return <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}>{navigation.map(({ path, label, icon: Icon }) =>
      <NavLink key={path} to={{ pathname: path, search: location.search }} end={path === '/'} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`} aria-label={label} title={!mobile && collapsed ? label : undefined} onClick={() => { if (mobile) setMobileOpen(false); }}>
        <Icon size={19} aria-hidden="true" /><span className="nav-label">{label}</span>
      </NavLink>)}</nav>;
  }
  return <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar" aria-label="Workspace sidebar">
      <Link to={{ pathname: "/", search: location.search }} className="brand" aria-label="RepoLens home"><span className="brand-icon"><ScanLine size={23} aria-hidden="true" /></span><span className="brand-word">RepoLens<span className="brand-dot">.</span></span></Link>
      <p className="nav-heading">WORKSPACE</p>{links()}
      <div className="sidebar-bottom"><div className="workspace-note"><span className="status-dot" /><span className="nav-label">Built for the curious.</span></div>
        <Button variant="ghost" className="collapse-button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span className="nav-label">Collapse sidebar</span></>}</Button>
      </div>
    </aside>
    <dialog ref={dialog} className="mobile-drawer" aria-label="Workspace navigation" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      const first = elements?.[0];
      const last = elements?.[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onCancel={() => setMobileOpen(false)} onClose={() => { setMobileOpen(false); menuButton.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <div className="drawer-content"><div className="drawer-header"><Link to={{ pathname: "/", search: location.search }} className="brand" onClick={() => setMobileOpen(false)}><ScanLine className="brand-icon" /><span>RepoLens.</span></Link><Button variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></Button></div>{links(true)}</div>
    </dialog>
    <div className="workspace">
      <header className="topbar">
        <button ref={menuButton} type="button" className="button button--ghost mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} aria-haspopup="dialog" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
        <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{page?.label ?? 'Not found'}</strong></div>
        <div className="topbar-actions"><span className="preview-label">PUBLIC REPOSITORY ANALYTICS</span><Tooltip label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}><Button variant="ghost" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</Button></Tooltip></div>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className="main-content">
        <RepositorySearch />
        {(location.pathname !== "/" || state.status === "error") && <RepositoryResult />}
        <ErrorBoundary key={location.pathname} scoped><Outlet /></ErrorBoundary>
        <footer className="workspace-footer"><span>RepoLens <span aria-hidden="true">/</span> Repository intelligence</span><span>Powered by curiosity. Backed by data.</span></footer>
      </main>
      <Footer />
    </div>
  </div>;
}
