// Optional live browser verification. Install Playwright separately or set PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const python = path.join(root, 'backend/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const options = { stdio: 'ignore', windowsHide: true };
const servers = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5178'], { ...options, cwd: path.join(root, 'frontend'), env: { ...process.env, VITE_API_BASE_URL: 'http://127.0.0.1:8000' } }),
  spawn(python, ['-B', '-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000'], { ...options, cwd: root, env: { ...process.env, CORS_ORIGINS: 'http://127.0.0.1:5178,http://127.0.0.1:5173,http://localhost:5173' } }),
];
const clean = text => text.replace(/ \(opens in a new tab\)/g, '').trim();
const count = number => number === null ? 'Not reported' : new Intl.NumberFormat('en-US').format(number);
const date = value => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'Not reported';
(async () => {
  let browser;
  try {
    for (const base of ['http://127.0.0.1:5178', 'http://127.0.0.1:8000']) {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(ready, base + ' readiness');
    }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined);
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1150 }, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5178');
    await page.getByRole('heading', { name: 'Every repository has a story.', exact: true }).waitFor();
    assert.equal(await page.locator('.stat-card').count(), 0);
    const input = page.getByRole('textbox', { name: 'GitHub repository', exact: true });
    async function search(value) { await input.fill(value); await page.getByRole('button', { name: 'Analyze', exact: true }).click(); }
    let react, vue;
    for (const name of ['facebook/react', 'vuejs/core', 'octocat/Hello-World']) {
      const response = page.waitForResponse(r => r.url().includes('/api/analyze?') && r.status() === 200);
      await search(name);
      const data = await (await response).json();
      const repo = data.repository;
      if (name === 'facebook/react') react = data;
      if (name === 'vuejs/core') vue = data;
      await page.locator('.canonical-name').filter({ hasText: repo.full_name }).waitFor();
      assert.equal(await page.locator('.repository-description').textContent(), repo.description || 'No description provided by this repository.');
      for (const [label, key] of [['Stars', 'stargazers_count'], ['Forks', 'forks_count'], ['Open issues + pull requests', 'open_issues_count'], ['Subscribers', 'subscribers_count']]) {
        assert.equal(await page.getByRole('region', { name: label, exact: true }).locator('.stat-value').textContent(), count(repo[key]));
      }
      const license = repo.license ? (repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : repo.license.name) : 'No license detected';
      const expected = [repo.language || 'Not reported', license, repo.default_branch, repo.size === null ? 'Not reported' : count(repo.size) + ' KB', date(repo.created_at), date(repo.pushed_at)];
      assert.deepEqual((await page.getByRole('region', { name: 'Repository details', exact: true }).locator('dd').allTextContents()).map(clean), expected);
      assert.deepEqual((await page.locator('.topic-link').allTextContents()).map(clean), repo.topics || []);
      assert.equal(clean(await page.locator('.owner-link').textContent()), repo.owner.login);
      assert.equal(await page.locator('.avatar-link').getAttribute('href'), repo.owner.html_url || 'https://github.com/' + repo.owner.login);
      assert.equal(await page.locator('.detail-link').getAttribute('href'), repo.html_url + '/tree/' + encodeURIComponent(repo.default_branch));
      const image = page.getByRole('img', { name: repo.owner.login + ' avatar', exact: true });
      if (await image.count()) assert.equal(await image.getAttribute('src'), repo.owner.avatar_url);
      for (const href of await page.locator('.overview-dashboard a').evaluateAll(elements => elements.map(e => e.href))) {
        assert.equal(new URL(href).hostname, 'github.com'); assert.equal(new URL(href).protocol, 'https:');
      }
      console.log('PASS: all live overview fields update to match', repo.full_name);
    }
    // Controlled replays use real response shapes to exercise loading and unavailable data.
    let replay = react;
    let delay = 700;
    await page.route('**/api/analyze?*', async route => { await new Promise(resolve => setTimeout(resolve, delay)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replay) }); });
    await search('facebook/react');
    await page.getByRole('status', { name: 'Loading repository overview', exact: true }).waitFor();
    assert.equal(await page.locator('.stat-value').count(), 0);
    await page.locator('.canonical-name').filter({ hasText: react.repository.full_name }).waitFor();
    console.log('PASS: empty state and loading skeleton, with old values removed');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'View on GitHub', exact: false }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).hostname, 'github.com');
    await popup.close();
    console.log('PASS: functional GitHub repository link; owner, branch, topic, and source hrefs');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), theme + ' overflow ' + width);
      }
      assert.equal(await page.locator('.owner-avatar').evaluate(e => getComputedStyle(e).filter), 'grayscale(1)');
    }
    const shots = path.join(root, 'documentation/screenshots'); fs.mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1150 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await page.screenshot({ path: path.join(shots, 'phase-4-overview-' + theme + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: path.join(shots, 'phase-4-overview-mobile.png'), fullPage: true });
    console.log('PASS: five responsive widths, both themes, grayscale avatars; screenshots saved');
    replay = structuredClone(vue);
    Object.assign(replay.repository, { description: null, language: null, license: null, topics: [], size: null, subscribers_count: null, pushed_at: null });
    replay.repository.owner.avatar_url = null; delay = 100;
    await search('vuejs/core');
    await page.locator('.canonical-name').filter({ hasText: 'vuejs/core' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Subscribers', exact: true }).locator('.stat-value').textContent(), 'Not reported');
    await page.getByText('No license detected', { exact: true }).waitFor();
    await page.getByText('This repository has no topics.', { exact: true }).waitFor();
    assert.ok(await page.getByRole('img', { name: 'vuejs avatar unavailable', exact: true }).isVisible());
    Object.assign(replay.repository, { size: 0, subscribers_count: 0 });
    await page.getByRole('button', { name: 'Refresh repository' }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Subscribers"] .stat-value')?.textContent === '0');
    assert.ok((await page.getByRole('region', { name: 'Repository details', exact: true }).locator('dd').allTextContents()).includes('0 KB'));
    console.log('PASS: unavailable metadata, empty topics, avatar fallback, and reported zero values');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Languages', exact: true }).click();
    await page.getByRole('heading', { name: 'Languages', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('repo'), 'vuejs/core');
    assert.equal(await page.locator('.stats-grid').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: navigation preserves selected repository; other pages stay coming soon; no runtime errors');
  } finally {
    if (browser) await browser.close();
    for (const server of servers) server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
