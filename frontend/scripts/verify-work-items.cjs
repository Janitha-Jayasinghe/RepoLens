// Optional live browser verification; see README for temporary Playwright setup.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const python = path.join(root, 'backend/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const servers = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5178'], { cwd: path.join(root, 'frontend'), stdio: 'ignore', windowsHide: true, env: { ...process.env, VITE_API_BASE_URL: 'http://127.0.0.1:8000' } }),
  spawn(python, ['-B', '-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000'], { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, CORS_ORIGINS: 'http://127.0.0.1:5178,http://127.0.0.1:5173,http://localhost:5173' } }),
];
const count = value => value === null ? 'Not reported' : new Intl.NumberFormat('en-US').format(value);
(async () => {
  let browser;
  try {
    for (const base of ['http://127.0.0.1:5178', 'http://127.0.0.1:8000']) { let ready = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); } assert.ok(ready, base); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1900 }, colorScheme: 'dark' }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (process.env.REPOLENS_OFFLINE_BROWSER_TESTS === '1') { await require('./work-item-browser-fixtures.cjs').install(page); console.log('MODE: isolated browser fixtures; no GitHub calls'); }
    await page.goto('http://127.0.0.1:5178/issues');
    await page.getByRole('heading', { name: 'Select a repository to begin', exact: true }).first().waitFor();
    const initialSummary = page.waitForResponse(response => response.url().includes('/api/work-items/summary?') && response.status() === 200);
    const initialIssues = page.waitForResponse(response => response.url().includes('/api/issues?') && response.status() === 200);
    const initialPulls = page.waitForResponse(response => response.url().includes('/api/pull-requests?') && response.status() === 200);
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('vuejs/core'); await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const [summary, issues, pulls] = await Promise.all([initialSummary.then(response => response.json()), initialIssues.then(response => response.json()), initialPulls.then(response => response.json())]);
    await page.locator('.work-summary-cards').waitFor();
    const issueCard = page.getByRole('region', { name: 'Recent issues', exact: true }); const pullCard = page.getByRole('region', { name: 'Recent pull requests', exact: true });
    await issueCard.locator('table').waitFor(); await pullCard.locator('table').waitFor();
    for (const [label, key] of [['Open issues', 'open_issues'], ['Closed issues', 'closed_issues'], ['Open pull requests', 'open_pull_requests'], ['Merged pull requests', 'merged_pull_requests']]) assert.equal(await page.getByRole('region', { name: label, exact: true }).locator('.stat-value').textContent(), count(summary[key].value));
    function checkItems(data, kind) { for (const item of data.items) { assert.ok(item.html_url.includes(kind === 'issues' ? '/issues/' : '/pull/')); if (kind === 'issues') assert.notEqual(item.state, 'merged'); } }
    checkItems(issues, 'issues'); checkItems(pulls, 'pulls');
    assert.equal(await issueCard.locator('tbody tr').count(), issues.returned_count); assert.equal(await pullCard.locator('tbody tr').count(), pulls.returned_count);
    for (const [card, data] of [[issueCard, issues], [pullCard, pulls]]) for (const [index, item] of data.items.entries()) { const row = card.locator('tbody tr').nth(index); assert.equal(await row.locator('.work-item-title').getAttribute('href'), item.html_url); assert.ok((await row.locator('.work-item-title').textContent()).includes(item.title)); assert.equal(await row.locator('.work-state-badge').textContent(), item.state); }
    console.log('PASS: separate summary and table values match their API responses');
    async function issueFilter(state) { const response = page.waitForResponse(response => response.url().includes('/api/issues?') && new URL(response.url()).searchParams.get('state') === state && response.status() === 200); await page.getByRole('group', { name: 'Issue states', exact: true }).getByRole('button', { name: state[0].toUpperCase() + state.slice(1), exact: true }).click(); const data = await (await response).json(); await issueCard.getByText('API page ' + data.page + ':', { exact: false }).waitFor(); assert.ok(data.items.every(item => state === 'all' || item.state === state)); return data; }
    async function pullFilter(state, label) { const response = page.waitForResponse(response => response.url().includes('/api/pull-requests?') && new URL(response.url()).searchParams.get('state') === state && response.status() === 200); await page.getByRole('group', { name: 'Pull request states', exact: true }).getByRole('button', { name: label, exact: true }).click(); const data = await (await response).json(); await pullCard.getByText('API page ' + data.page + ':', { exact: false }).waitFor(); assert.ok(data.items.every(item => state === 'all' || item.state === state)); return data; }
    await issueFilter('open'); await issueFilter('closed');
    await pullFilter('merged', 'Merged'); await pullFilter('closed', 'Closed (unmerged)');
    await issueFilter('all'); await pullFilter('all', 'All');
    if (issues.has_next) { const response = page.waitForResponse(response => response.url().includes('/api/issues?') && new URL(response.url()).searchParams.get('page') === '2' && response.status() === 200); await issueCard.getByRole('button', { name: 'Next', exact: true }).click(); const data = await (await response).json(); await issueCard.getByText('API page 2:', { exact: false }).waitFor(); assert.ok(data.has_previous); const back = page.waitForResponse(response => response.url().includes('/api/issues?') && new URL(response.url()).searchParams.get('page') === '1' && response.status() === 200); await issueCard.getByRole('button', { name: 'Previous', exact: true }).click(); await back; }
    const refreshResponse = page.waitForResponse(response => response.url().includes('/api/issues?') && new URL(response.url()).searchParams.get('refresh') === 'true' && response.status() === 200);
    await issueCard.getByRole('button', { name: 'Refresh issues', exact: true }).click(); assert.equal((await (await refreshResponse).json()).cached, false); await issueCard.locator('table').waitFor();
    console.log('PASS: open/closed issue filters, merged/unmerged PR filters, raw API-page pagination, and explicit cache-bypass refresh');
    for (const chart of ['.work-chart-grid .work-chart']) await page.locator(chart).first().waitFor();
    for (const bar of await page.locator('.work-chart-grid .recharts-rectangle').all()) { const box = await bar.boundingBox(); if (box?.height > 1 && box?.width > 1) { await bar.hover(); break; } }
    await page.locator('.chart-tooltip').first().waitFor(); await page.mouse.move(0, 0);
    const shots = process.env.REPOLENS_OFFLINE_BROWSER_TESTS === '1' ? path.join(require('node:os').tmpdir(), 'repolens-work-items-browser-fixtures') : path.join(root, 'documentation/screenshots'); fs.mkdirSync(shots, { recursive: true });
    for (const theme of ['dark', 'light']) { await page.evaluate(value => document.documentElement.dataset.theme = value, theme); for (const width of [320, 375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1900 }); await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(300);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
          console.log('Overflow detail', await page.evaluate(() => ({ tables: [...document.querySelectorAll('.table-scroll')].map(el => ({ width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, overflow: getComputedStyle(el).overflowX, display: getComputedStyle(el).display })), width: innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('body *')].filter(el => (!el.closest('.table-scroll') || el.classList.contains('table-scroll')) && el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', right: el.getBoundingClientRect().right, text: el.textContent?.slice(0, 65) })).slice(0, 16) })));
          await page.screenshot({ path: path.join(shots, 'phase-7-overflow-debug.png') });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'work page overflow ' + width); }
      const invalid = await page.locator('.work-chart-grid svg *').evaluateAll(elements => { const bad = new Set(); for (const el of elements) for (const key of ['fill', 'stroke']) { const color = getComputedStyle(el)[key]; const match = color.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/); if (!match) continue; const [r, g, b] = match.slice(1).map(Number); if (!(r === g && g === b) && !(r === 255 && g === 95 && b === 0) && !(r === 255 && g === 117 && b === 24)) bad.add(color); } return [...bad]; }); assert.deepEqual(invalid, []);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.screenshot({ path: path.join(shots, 'phase-7-issues-' + theme + '.png') });
    }
    await page.setViewportSize({ width: 375, height: 950 }); await page.waitForTimeout(100); await page.getByRole('region', { name: 'Loaded item update dates', exact: true }).screenshot({ path: path.join(shots, 'phase-7-issues-mobile-activity.png') });
    console.log('PASS: sample-scoped activity chart/tooltips, five responsive widths, scrollable mobile tables, and approved chart palette in both themes');
    let mode = 'partial', calls = 0;
    await page.route('**/api/work-items/summary?*', async route => { calls++; if (mode === 'rate') { await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'github_rate_limited', message: 'GitHub API rate limit reached.', retry_after: 2 } }) }); return; } const data = structuredClone(summary); data.cached = false; data.open_issues = { ...data.open_issues, value: null, complete: false, note: 'GitHub search is incomplete. No exact count is shown.' }; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }); });
    await page.getByRole('button', { name: 'Refresh summary', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="Open issues"] .stat-value')?.textContent === 'Not reported');
    await page.route('**/api/issues?*', async route => { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...issues, items: [], returned_count: 0, has_next: true, cached: false }) }); });
    await issueCard.getByRole('button', { name: 'Refresh issues', exact: true }).click(); await issueCard.getByRole('heading', { name: 'No matching items on this API page', exact: true }).waitFor(); assert.ok(await issueCard.getByRole('button', { name: 'Next', exact: true }).isEnabled());
    mode = 'rate'; await page.getByRole('button', { name: 'Refresh summary', exact: true }).click(); await page.getByRole('heading', { name: 'Issue/PR summary unavailable', exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled()); const before = calls; await page.waitForTimeout(3100); assert.equal(calls, before);
    console.log('PASS: incomplete summary stays unknown, filtered empty pages keep Next, and rate-limit failures do not auto-retry');
    await page.unroute('**/api/work-items/summary?*'); await page.unroute('**/api/issues?*');
    const otherSummary = page.waitForResponse(response => response.url().includes('/api/work-items/summary?') && response.status() === 200); const otherIssues = page.waitForResponse(response => response.url().includes('/api/issues?') && response.status() === 200); const otherPulls = page.waitForResponse(response => response.url().includes('/api/pull-requests?') && response.status() === 200);
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('facebook/react'); await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const [nextSummary, nextIssues, nextPulls] = await Promise.all([otherSummary.then(response => response.json()), otherIssues.then(response => response.json()), otherPulls.then(response => response.json())]);
    await page.locator('.work-summary-cards').waitFor(); assert.equal(new URL(page.url()).searchParams.get('repo'), nextSummary.repository); assert.equal(nextIssues.repository, nextSummary.repository); assert.equal(nextPulls.repository, nextSummary.repository); assert.equal(await page.getByRole('region', { name: 'Open issues', exact: true }).locator('.stat-value').textContent(), count(nextSummary.open_issues.value));
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('region', { name: 'Stars', exact: true }).waitFor(); assert.deepEqual(errors, []);
    console.log('PASS: second public repository updates canonical selection and separate data; overview/navigation preserved; no runtime errors');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
