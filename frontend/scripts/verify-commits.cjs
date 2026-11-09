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
const count = value => new Intl.NumberFormat('en-US').format(value);
(async () => {
  let browser;
  try {
    for (const base of ['http://127.0.0.1:5178', 'http://127.0.0.1:8000']) {
      let ready = false;
      for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
      assert.ok(ready, base + ' readiness');
    }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1150 }, colorScheme: 'dark' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5178/commits');
    await page.getByRole('heading', { name: 'Select a repository to begin', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('vuejs/core');
    const initialResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200);
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const initial = await (await initialResponse).json();
    assert.equal(initial.days, 30); assert.ok(initial.complete);
    await page.getByRole('heading', { name: 'Complete selected window', exact: true }).waitFor();
    assert.equal(initial.activity.reduce((sum, day) => sum + day.count, 0), initial.fetched_count);
    assert.equal(await page.locator('.commit-list > li').count(), Math.min(initial.fetched_count, 20));
    assert.ok((await page.locator('.commit-title').first().textContent()).startsWith(initial.commits[0].message.split(/\r?\n/)[0].trim()));
    assert.equal(await page.locator('.commit-sha').first().getAttribute('href'), initial.commits[0].html_url);
    await page.locator('.commit-details summary').first().click(); assert.equal(await page.locator('.commit-details code').first().textContent(), initial.commits[0].sha);
    await page.locator('.commit-details summary').first().click();
    if (initial.fetched_count > 20) { await page.getByRole('button', { name: 'Next', exact: true }).click(); assert.equal(await page.locator('.commit-sha').first().getAttribute('href'), initial.commits[20].html_url); await page.getByRole('button', { name: 'Previous', exact: true }).click(); }
    const query = page.getByRole('textbox', { name: 'Filter messages or SHAs within fetched commits', exact: true });
    await query.fill(initial.commits[0].sha.slice(0, 12)); assert.equal(await page.locator('.commit-list > li').count(), 1);
    await query.fill('this-filter-matches-no-commit-73921'); await page.getByRole('heading', { name: 'No matching fetched commits', exact: true }).waitFor(); await query.fill('');
    await page.getByText('View exact daily counts', { exact: true }).click();
    const values = await page.locator('.daily-counts tbody td').allTextContents(); assert.deepEqual(values, initial.activity.map(day => count(day.count)));
    await page.getByText('View exact daily counts', { exact: true }).click();
    for (const bar of await page.locator('.commit-activity-chart .recharts-rectangle').all()) { const box = await bar.boundingBox(); if (box?.height > 1) { await bar.hover(); break; } }
    await page.locator('.chart-tooltip').filter({ hasText: 'commits' }).waitFor();
    console.log('PASS: live 30-day history, exact daily aggregation, list pagination, message/SHA filters, full message/SHA, links, and tooltips');
    const sevenResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200 && new URL(response.url()).searchParams.get('days') === '7');
    await page.getByRole('button', { name: '7 days', exact: true }).click(); const seven = await (await sevenResponse).json();
    await page.getByRole('heading', { name: 'Complete selected window', exact: true }).waitFor(); assert.equal(seven.activity.length, 7);
    const login = seven.commits.find(item => item.author_login)?.author_login || initial.commits.find(item => item.author_login)?.author_login;
    assert.ok(login);
    await page.getByRole('textbox', { name: 'GitHub author login (optional)', exact: true }).fill(login);
    const authorResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200 && new URL(response.url()).searchParams.get('author') === login);
    await page.getByRole('button', { name: 'Apply author', exact: true }).click(); const author = await (await authorResponse).json();
    assert.equal(author.author_filter, login); await page.getByRole('heading', { name: 'Complete selected window', exact: true }).waitFor();
    const clearResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200 && !new URL(response.url()).searchParams.has('author'));
    await page.getByRole('button', { name: 'Clear', exact: true }).click(); await clearResponse;
    const ninetyResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200 && new URL(response.url()).searchParams.get('days') === '90');
    await page.getByRole('button', { name: '90 days', exact: true }).click(); const ninety = await (await ninetyResponse).json();
    await page.getByRole('heading', { name: ninety.complete ? 'Complete selected window' : 'Partial selected window', exact: true }).waitFor();
    if (ninety.complete) { assert.equal(ninety.activity.length, 90); assert.equal(ninety.activity.reduce((sum, day) => sum + day.count, 0), ninety.fetched_count); } else assert.equal(ninety.activity, null);
    console.log('PASS: live 7/30/90-day selection and upstream author filtering; range completeness is explicit');
    // Restore a complete 30-day response for visual verification, without another live request.
    let mode = 'normal'; let calls = 0;
    await page.route('**/api/commits?*', async route => {
      calls++;
      if (mode === 'pending') { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'github_processing', message: 'GitHub is preparing this data. Please retry in a few seconds.' } }) }); return; }
      if (mode === 'rate') { await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'github_rate_limited', message: 'GitHub API rate limit reached.', retry_after: 2 } }) }); return; }
      await new Promise(resolve => setTimeout(resolve, 400));
      const data = structuredClone(initial);
      if (mode === 'partial') Object.assign(data, { complete: false, has_more: true, activity: null, pages_fetched: 5, coverage_note: 'Partial history. Additional pages exist; the chart is withheld.' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.getByRole('button', { name: '30 days', exact: true }).click();
    await page.getByRole('status', { name: 'Loading commit activity', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Complete selected window', exact: true }).waitFor();
    const shots = path.join(root, 'documentation/screenshots'); fs.mkdirSync(shots, { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1150 }); await page.waitForTimeout(100);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'commit page overflow ' + width);
      }
      await page.setViewportSize({ width: 1440, height: 1900 });
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(shots, 'phase-6-commits-' + theme + '.png') });
    }
    const invalidColors = await page.locator('.commit-activity-chart svg *').evaluateAll(elements => {
      const bad = new Set(); for (const el of elements) for (const key of ['fill', 'stroke']) { const color = getComputedStyle(el)[key]; const match = color.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/); if (!match) continue; const [r, g, b] = match.slice(1).map(Number); if (!(r === g && g === b) && !(r === 255 && g === 95 && b === 0) && !(r === 255 && g === 117 && b === 24)) bad.add(color); } return [...bad];
    }); assert.deepEqual(invalidColors, []);
    await page.setViewportSize({ width: 375, height: 950 }); await page.waitForTimeout(100);
    await page.getByRole('region', { name: 'Commit activity', exact: true }).screenshot({ path: path.join(shots, 'phase-6-commits-mobile-chart.png') });
    console.log('PASS: mobile charts/layout at five widths in both themes, approved SVG palette, screenshots');
    mode = 'partial'; await page.getByRole('button', { name: 'Refresh commits', exact: true }).click();
    await page.getByRole('heading', { name: 'Partial selected window', exact: true }).waitFor(); await page.getByRole('heading', { name: 'Activity chart unavailable', exact: true }).waitFor();
    assert.equal(await page.locator('.commit-activity-chart').count(), 0); assert.ok(await page.locator('.commit-list > li').count() > 0); assert.equal(await page.locator('.daily-counts').count(), 0);
    mode = 'pending'; await page.getByRole('button', { name: 'Refresh commits', exact: true }).click(); await page.getByRole('heading', { name: 'Commit activity unavailable', exact: true }).waitFor();
    mode = 'rate'; await page.getByRole('button', { name: 'Retry analytics', exact: true }).click(); await page.getByText('GitHub API rate limit reached.', { exact: true }).waitFor();
    const before = calls; await page.waitForTimeout(3100); assert.equal(calls, before);
    console.log('PASS: incomplete history keeps list but never renders chart/zero days; unavailable statistics and cooldown do not auto-retry');
    await page.unroute('**/api/commits?*');
    const limitedResponse = page.waitForResponse(response => response.url().includes('/api/commits?') && response.status() === 200);
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('octocat/Hello-World'); await page.getByRole('button', { name: 'Analyze', exact: true }).click(); const limited = await (await limitedResponse).json();
    assert.equal(limited.fetched_count, 0); assert.ok(limited.complete); await page.getByRole('heading', { name: 'No commits in this range', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('region', { name: 'Stars', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('repo'), 'octocat/Hello-World'); assert.deepEqual(errors, []);
    console.log('PASS: limited recent history, repeated repository searches, preserved overview/navigation, zero runtime errors');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
