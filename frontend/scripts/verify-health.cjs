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
(async () => {
  let browser;
  try {
    for (const base of ['http://127.0.0.1:5178', 'http://127.0.0.1:8000']) { let ready = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); } assert.ok(ready, base); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1900 }, colorScheme: 'dark' }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5178/health'); await page.getByRole('heading', { name: 'Select a repository to begin', exact: true }).waitFor();
    const liveResponse = page.waitForResponse(response => response.url().includes('/api/health?'));
    await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('vuejs/core'); await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const raw = await liveResponse; const result = await raw.json(); assert.equal(raw.status(), 200, JSON.stringify(result));
    await page.getByRole('region', { name: 'Maintenance assessment', exact: true }).waitFor();
    assert.equal(result.factors.length, 6); assert.equal(result.factors.reduce((sum, factor) => sum + factor.weight, 0), 100);
    const known = result.factors.filter(factor => factor.score !== null); const earned = known.reduce((sum, factor) => sum + factor.score, 0);
    assert.equal(result.observed_points, earned);
    if (result.status === 'complete') { assert.equal(result.score, earned); await page.getByRole('img', { name: 'Maintenance-signal score ' + result.score + ' out of 100', exact: true }).waitFor(); }
    else { assert.equal(result.score, null); await page.getByRole('heading', { name: 'Assessment incomplete', exact: true }).waitFor(); }
    for (const factor of result.factors) { const card = page.getByRole('region', { name: factor.label, exact: true }); assert.equal(await card.locator('.health-factor-points strong').textContent(), factor.score === null ? 'Unscored' : factor.score + ' / ' + factor.weight); await card.getByText('Scoring rule', { exact: true }).click(); assert.ok((await card.textContent()).includes(factor.rule)); }
    console.log('PASS: live maintenance assessment matches backend factor points, weights, explanations, and missing-data status:', result.status, result.score);
    for (const factor of result.factors) { const details = page.getByRole('region', { name: factor.label, exact: true }).locator('details'); if (await details.getAttribute('open') !== null) await details.locator('summary').click(); }
    const shots = path.join(root, 'documentation/screenshots'); fs.mkdirSync(shots, { recursive: true });
    for (const theme of ['dark', 'light']) { await page.evaluate(value => document.documentElement.dataset.theme = value, theme); for (const width of [320, 375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1900 }); await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(100); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'health overflow ' + width); }
      const invalid = await page.locator('.health-gauge svg *').evaluateAll(elements => { const bad = new Set(); for (const el of elements) for (const key of ['fill', 'stroke']) { const value = getComputedStyle(el)[key], m = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/); if (!m) continue; const [r, g, b] = m.slice(1).map(Number); if (!(r === g && g === b) && !(r === 255 && g === 95 && b === 0) && !(r === 255 && g === 117 && b === 24)) bad.add(value); } return [...bad]; }); assert.deepEqual(invalid, []);
      await page.screenshot({ path: path.join(shots, 'phase-8-health-' + theme + '.png') });
    }
    await page.setViewportSize({ width: 375, height: 950 }); await page.getByRole('region', { name: 'Maintenance assessment', exact: true }).screenshot({ path: path.join(shots, 'phase-8-health-mobile.png') });
    console.log('PASS: Health layout at five widths in both themes; circular gauge uses only the approved palette');
    // Controlled response variants are test-only; normal application data always comes from FastAPI/GitHub.
    let mode = 'incomplete', calls = 0;
    await page.route('**/api/health?*', async route => {
      calls++; await new Promise(resolve => setTimeout(resolve, 300));
      const data = structuredClone(result); data.cached = false; data.cache_expires_at = null; data.rate_limited = false; data.retry_after = null;
      if (mode === 'zero') {
        data.factors.forEach(factor => { factor.score = 0; factor.status = 'assessed'; }); Object.assign(data, { status: 'complete', score: 0, observed_points: 0, available_weight: 100, lower_bound: 0, upper_bound: 0, cache_expires_at: new Date(Date.now() + 120000).toISOString(), data_suggestions: [] });
      } else {
        data.factors[0].score = null; data.factors[0].status = 'unavailable'; data.factors[0].explanation = 'Test-only missing commit evidence.';
        const assessed = data.factors.filter(factor => factor.score !== null), weight = assessed.reduce((sum, factor) => sum + factor.weight, 0), points = assessed.reduce((sum, factor) => sum + factor.score, 0);
        Object.assign(data, { status: 'incomplete', score: null, available_weight: weight, observed_points: points, lower_bound: points, upper_bound: points + 100 - weight, data_suggestions: ['Retry missing evidence.'] });
        if (mode === 'rate') { data.rate_limited = true; data.retry_after = 2; }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.getByRole('button', { name: 'Refresh assessment', exact: true }).click(); await page.getByRole('status', { name: 'Loading maintenance assessment', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Assessment incomplete', exact: true }).waitFor(); await page.getByRole('img', { name: 'Maintenance assessment incomplete; overall score unavailable', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: result.factors[0].label, exact: true }).locator('.health-factor-points strong').textContent(), 'Unscored');
    assert.ok(await page.getByText('Bounds are mathematical possibilities, not a predicted or normalized score.', { exact: false }).isVisible());
    mode = 'zero'; await page.getByRole('button', { name: 'Refresh assessment', exact: true }).click(); await page.getByRole('img', { name: 'Maintenance-signal score 0 out of 100', exact: true }).waitFor();
    console.log('PASS: loading, incomplete assessment stays unscored, bounds are disclosed, and a complete zero remains a real zero');
    mode = 'rate'; await page.getByRole('button', { name: 'Refresh assessment', exact: true }).click(); await page.getByRole('heading', { name: 'Assessment incomplete', exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled()); const before = calls; await page.waitForTimeout(3100); assert.equal(calls, before);
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('region', { name: 'Stars', exact: true }).waitFor(); assert.equal(new URL(page.url()).searchParams.get('repo'), result.repository); assert.deepEqual(errors, []);
    console.log('PASS: partial rate-limit evidence is preserved, cooldown does not auto-retry, and overview/navigation remain functional');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
