import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; scoped?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('RepoLens rendering failed', error, info.componentStack); }
  render() {
    if (this.state.failed && this.props.scoped) return <section className="card error-recovery" role="alert"><h1>This page could not be displayed</h1><p>Your workspace is still available. Try this page again or choose another page from navigation.</p><button type="button" className="button button--primary" onClick={() => this.setState({ failed: false })}>Try page again</button><a className="text-link" href="/">Return to Overview</a></section>;
    if (this.state.failed) return <main className="min-h-screen bg-surface p-8 text-foreground"><h1 className="text-2xl font-bold">Unable to display RepoLens</h1><p className="mt-3">Reload the page to try again.</p><button className="mt-6 rounded bg-orange px-4 py-2 text-black" onClick={() => window.location.reload()}>Reload page</button></main>;
    return this.props.children;
  }
}
