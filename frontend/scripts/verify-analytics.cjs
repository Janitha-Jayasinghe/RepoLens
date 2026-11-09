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
const clean = value => value.replace(/ \(opens in a new tab\)/g, '').trim();
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
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5178/languages');
    await page.getByRole('heading', { name: 'Select a repository to begin', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('vuejs/core');
    const langResponse = page.waitForResponse(response => response.url().includes('/api/languages?') && response.status() === 200);
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const languages = await (await langResponse).json();
    await page.getByRole('region', { name: 'Language breakdown', exact: true }).waitFor();
    assert.equal(await page.getByTestId('language-total').textContent(), count(languages.total_bytes) + ' bytes');
    const rows = Object.entries(languages.languages).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const table = await page.locator('.analytics-table tbody tr').allTextContents();
    assert.equal(table.length, rows.length);
    for (const [index, [name, bytes]] of rows.entries()) { assert.ok(table[index].includes(name)); assert.ok(table[index].includes(count(bytes))); }
    await page.locator('.donut-chart .recharts-sector').first().waitFor();
    assert.equal(await page.locator('.donut-chart .recharts-sector').count(), rows.length);
    await page.locator('.language-legend button').first().click();
    assert.equal(await page.locator('.language-legend button').first().getAttribute('aria-pressed'), 'true');
    await page.locator('.horizontal-chart .recharts-rectangle').first().hover();
    await page.locator('.chart-tooltip').filter({ hasText: 'bytes' }).first().waitFor();
    await page.locator('.language-legend button').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.language-legend button').first().getAttribute('aria-pressed'), 'false');
    console.log('PASS: live language bytes/total, doughnut, bars, tooltips, and keyboard legend selection');
    const shots = path.join(root, 'documentation/screenshots'); fs.mkdirSync(shots, { recursive: true });
    await page.mouse.move(0, 0);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.waitForTimeout(80);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'languages overflow ' + width);
        for (const box of await page.locator('.recharts-responsive-container').evaluateAll(elements => elements.map(e => ({ width: e.getBoundingClientRect().width, parent: e.parentElement.getBoundingClientRect().width })))) assert.ok(box.width > 0 && box.width <= box.parent + 1);
      }
      const invalid = await page.locator('.recharts-wrapper svg *').evaluateAll(elements => {
        const bad = new Set();
        for (const el of elements) for (const key of ['fill', 'stroke']) {
          const color = getComputedStyle(el)[key]; const match = color.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
          if (!match) continue; const [r, g, b] = match.slice(1).map(Number);
          if (!(r === g && g === b) && !(r === 255 && g === 95 && b === 0) && !(r === 255 && g === 117 && b === 24)) bad.add(color);
        }
        return [...bad];
      });
      assert.deepEqual(invalid, []);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(shots, 'phase-5-languages-' + theme + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(shots, 'phase-5-languages-mobile.png'), fullPage: true });
    const contributorResponse = page.waitForResponse(response => response.url().includes('/api/contributors?') && response.status() === 200);
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Contributors', exact: true }).click();
    const contributors = await (await contributorResponse).json();
    await page.getByRole('region', { name: 'Contributor leaderboard', exact: true }).waitFor();
    assert.equal(await page.locator('.contributor-list li').count(), contributors.returned_count);
    for (const [index, item] of contributors.contributors.entries()) {
      const row = page.locator('.contributor-list li').nth(index);
      assert.equal(clean(await row.locator('.contributor-person a').textContent()), item.login);
      assert.equal(await row.locator('.contributor-person a').getAttribute('href'), item.html_url);
      assert.ok((await row.locator('.contributor-count').textContent()).startsWith(count(item.contributions)));
      assert.equal(await row.locator('.contributor-rank').getAttribute('aria-label'), 'Rank ' + (index + 1));
    }
    assert.ok(await page.getByText('This is not the total contributor population.', { exact: false }).isVisible());
    await page.locator('.contributor-count').first().click();
    assert.equal(await page.locator('.contributor-count').first().getAttribute('aria-pressed'), 'true');
    await page.locator('.horizontal-chart .recharts-rectangle').first().hover();
    await page.locator('.chart-tooltip').filter({ hasText: 'contributions' }).first().waitFor();
    console.log('PASS: live top contributor ranks/counts/profiles, sample disclosure, bar highlights, and tooltips');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(100);
        const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', right: el.getBoundingClientRect().right, text: el.textContent?.slice(0, 60) })).slice(0, 12));
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log('Overflow details', overflow);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'contributors overflow ' + width);
      }
      assert.equal(await page.locator('.contributor-list .owner-avatar').first().evaluate(el => getComputedStyle(el).filter), 'grayscale(1)');
      await page.mouse.move(0, 0);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(shots, 'phase-5-contributors-' + theme + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 }); await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.screenshot({ path: path.join(shots, 'phase-5-contributors-mobile.png'), fullPage: true });
    console.log('PASS: both chart pages resize on mobile in both themes; chart colors remain approved');
    await page.setViewportSize({ width: 1440, height: 1100 });
    const otherResponse = page.waitForResponse(response => response.url().includes('/api/contributors?') && response.status() === 200);
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('facebook/react');
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const other = await (await otherResponse).json();
    await page.waitForFunction(login => document.querySelector('.contributor-person a')?.textContent?.startsWith(login), other.contributors[0].login);
    assert.equal(await page.locator('.contributor-list li').count(), other.returned_count);
    assert.equal(new URL(page.url()).searchParams.get('repo'), other.repository);
    const restore = page.waitForResponse(response => response.url().includes('/api/contributors?') && response.status() === 200);
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('vuejs/core');
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await restore; await page.waitForFunction(login => document.querySelector('.contributor-person a')?.textContent?.startsWith(login), contributors.contributors[0].login);
    await page.setViewportSize({ width: 375, height: 812 });
    console.log('PASS: repeated repository searches replace contributor data and canonical URL without reload');
    // Replay only the analytics endpoints to exercise empty/error/loading states.
    let mode = 'empty'; let calls = 0;
    await page.route('**/api/contributors?*', async route => {
      calls++;
      if (mode === 'rate') { await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'github_rate_limited', message: 'GitHub API rate limit reached.', retry_after: 2 } }) }); return; }
      await new Promise(resolve => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...contributors, contributors: [], returned_count: 0, has_more: false }) });
    });
    await page.getByRole('button', { name: 'Refresh contributors', exact: true }).click();
    await page.getByRole('status', { name: 'Loading contributor analytics', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'No contributor data returned', exact: true }).waitFor();
    mode = 'rate'; await page.getByRole('button', { name: 'Refresh contributors', exact: true }).click();
    await page.getByRole('heading', { name: 'Contributor analytics unavailable', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled());
    const before = calls; await page.waitForTimeout(3100); assert.equal(calls, before);
    mode = 'empty'; await page.getByRole('button', { name: 'Retry analytics', exact: true }).click();
    await page.getByRole('heading', { name: 'No contributor data returned', exact: true }).waitFor();
    await page.route('**/api/languages?*', async route => { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...languages, languages: {}, total_bytes: 0 }) }); });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Languages', exact: true }).click();
    await page.getByRole('heading', { name: 'No language bytes detected', exact: true }).waitFor();
    console.log('PASS: empty language/contributor states, loading skeletons, shared rate-limit cooldown, no automatic retries');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('region', { name: 'Stars', exact: true }).waitFor(); assert.equal(new URL(page.url()).searchParams.get('repo'), 'vuejs/core');
    assert.deepEqual(errors, []); console.log('PASS: overview and selected repository preserved; no browser runtime errors');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
