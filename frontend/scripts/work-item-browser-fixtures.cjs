// Explicit QA-only data. Never imported by the application or backend.
exports.install = async page => {
  await page.route('http://127.0.0.1:8000/**', async route => {
    const url = new URL(route.request().url());
    const requested = url.searchParams.get('repo') || 'vuejs/core';
    const repo = requested === 'facebook/react' ? 'react/react' : requested;
    const [owner, name] = repo.split('/');
    const at = new Date().toISOString(); const expires = new Date(Date.now() + 120000).toISOString();
    const snapshot = { repository: repo, analyzed_at: at, cached: false, cache_expires_at: expires, coverage_note: 'Isolated browser fixture; these are not live analytics.' };
    let data;
    if (url.pathname === '/api/analyze') data = { requested_repo: requested, source_url: 'https://github.com/' + repo, analyzed_at: at, repository: { id: 1, name, full_name: repo, html_url: 'https://github.com/' + repo, owner: { login: owner, avatar_url: null, html_url: 'https://github.com/' + owner }, description: 'Isolated browser fixture.', stargazers_count: 1, forks_count: 1, open_issues_count: 1, subscribers_count: 1, size: 1, license: null, topics: [], default_branch: 'main', language: null, archived: false, private: false, created_at: at, pushed_at: at } };
    else if (url.pathname.includes('/summary')) {
      const count = value => ({ value, complete: true, source_url: 'https://api.github.com/search/issues', note: 'Isolated test count.' });
      data = { ...snapshot, open_issues: count(42), closed_issues: count(84), open_pull_requests: count(15), merged_pull_requests: count(120) };
    } else {
      const kind = url.pathname === '/api/issues' ? 'issues' : 'pulls'; const filter = url.searchParams.get('state') || 'all'; const current = Number(url.searchParams.get('page') || 1);
      const items = Array.from({ length: kind === 'issues' ? 9 : 20 }, (_, i) => {
        const number = current * 100 + i; const state = filter === 'all' ? (kind === 'pulls' && i % 3 === 2 ? 'merged' : i % 2 ? 'closed' : 'open') : filter;
        const updated = new Date(Date.now() - (i % 5) * 86400000).toISOString();
        return { number, title: 'Isolated browser test item ' + number, html_url: 'https://github.com/' + repo + '/' + (kind === 'issues' ? 'issues' : 'pull') + '/' + number, state, author_login: owner, author_url: 'https://github.com/' + owner, comments: 0, created_at: updated, updated_at: updated, closed_at: state === 'open' ? null : updated, merged_at: state === 'merged' ? updated : null };
      });
      data = { ...snapshot, kind, state_filter: filter, items, page: current, per_page: 20, scanned_count: 20, returned_count: items.length, has_next: current < 3, has_previous: current > 1, source_url: 'https://api.github.com/repos/' + repo + '/' + kind };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
};
