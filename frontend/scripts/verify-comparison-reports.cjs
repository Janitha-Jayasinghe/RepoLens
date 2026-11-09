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
    await page.goto('http://127.0.0.1:5178/comparison');
    await page.getByLabel('First repository', {exact:true}).fill('https://example.com/bad');
    await page.getByLabel('Second repository', {exact:true}).fill('octocat/Hello-World');
    await page.getByRole('button',{name:'Compare repositories',exact:true}).click();
    await page.getByRole('alert').waitFor();
    await page.getByLabel('First repository', {exact:true}).fill('https://github.com/vuejs/core');
    await page.getByRole('button',{name:'7 days',exact:true}).click();
    const snapshots=[];
    page.on('response',async response=>{if(response.url().includes('/api/snapshot?')){const data=await response.json(); snapshots.push(data); console.log('SNAPSHOT',response.status(),data.overview?.repository.full_name,data.collection_complete,data.detail||'');}});
    await page.getByRole('button',{name:'Compare repositories',exact:true}).click();
    await page.getByRole('region',{name:'First repository snapshot',exact:true}).waitFor({timeout:75000});
    await page.getByRole('region',{name:'Second repository snapshot',exact:true}).waitFor({timeout:75000});
    assert.equal(snapshots.length,2);
    for(const data of snapshots){const index=data.overview.repository.full_name==='vuejs/core'?'First':'Second';const card=page.getByRole('region',{name:index+' repository snapshot',exact:true});for(const count of [data.overview.repository.stargazers_count,data.overview.repository.forks_count])assert.ok((await card.textContent()).includes(count.toLocaleString('en-US')));}
    const shots=path.join(root,'documentation/screenshots');fs.mkdirSync(shots,{recursive:true});
    for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1900});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);}await page.screenshot({path:path.join(shots,'phase-9-comparison-'+theme+'.png')});}
    await page.getByRole('link',{name:'Prepare PDF report',exact:true}).first().click();
    await page.getByRole('button',{name:'Prepare report snapshot',exact:true}).waitFor();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Prepare report snapshot')?.disabled);
    await page.getByRole('button',{name:'Prepare report snapshot',exact:true}).click();
    await page.getByRole('region',{name:'Report snapshot coverage',exact:true}).waitFor({timeout:75000});
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download PDF report',exact:true}).click();
    const download=await downloadPromise;const dir=path.join(root,'documentation/reports');fs.mkdirSync(dir,{recursive:true});await download.saveAs(path.join(dir,'phase-9-vuejs-core.pdf'));
    await page.getByText('PDF ready. Your browser download has started.',{exact:true}).waitFor();
    await page.screenshot({path:path.join(shots,'phase-9-reports.png')});
    fs.writeFileSync(path.join(dir,'phase-9-live-verification.json'),JSON.stringify(snapshots.map(s=>({repository:s.overview.repository.full_name,id:s.id,analyzed_at:s.analyzed_at,stars:s.overview.repository.stargazers_count,forks:s.overview.repository.forks_count,collection_complete:s.collection_complete,commits:s.commits.status==='available'?{complete:s.commits.data.complete,count:s.commits.data.returned_count}:s.commits.error,health:s.health.status==='available'?s.health.data.score:s.health.error})),null,2));
    assert.deepEqual(errors,[]);console.log('PASS: invalid URL, two live repository snapshots, exact statistics, five widths in both themes, report coverage and actual PDF browser download');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
