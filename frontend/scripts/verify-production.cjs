// Optional live browser verification; see README for temporary Playwright setup.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const python = path.join(root, 'backend/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const servers = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5178'], { cwd: path.join(root, 'frontend'), stdio: 'ignore', windowsHide: true, env: { ...process.env, VITE_API_BASE_URL: 'http://127.0.0.1:8000' } }),
  spawn(python, ['-B', '-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000'], { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, CORS_ORIGINS: 'http://127.0.0.1:5178,http://127.0.0.1:5173,http://localhost:5173' } }),
];
(async () => {
  let browser;
  try {
    for (const base of ['http://127.0.0.1:5178', 'http://127.0.0.1:8000']) { let ready = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); } assert.ok(ready, base); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1900 }, colorScheme: 'dark' }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const routes=['/','/languages','/contributors','/commits','/issues','/health','/comparison','/reports','/settings','/missing-page'];
    const shots=path.join(root,'documentation/screenshots');fs.mkdirSync(shots,{recursive:true});
    for(const route of routes){
      await page.goto('http://127.0.0.1:5178'+route);await page.locator('main h1').first().waitFor();
      assert.equal(await page.locator('main h1').count(),1,'page heading '+route);
      for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(30);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+route+' '+theme+' '+width);}
        const invalid=await page.locator('body *').evaluateAll(elements=>{const bad=new Set();for(const e of elements){if(!e.getClientRects().length)continue;for(const prop of ['color','backgroundColor','borderTopColor','outlineColor','fill','stroke']){const value=getComputedStyle(e)[prop],m=value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);if(!m)continue;const [r,g,b]=m.slice(1).map(Number);if(!(r===g&&g===b)&&!(r===255&&g===95&&b===0)&&!(r===255&&g===117&&b===24))bad.add(value);}}return [...bad];});assert.deepEqual(invalid,[],'palette '+route+' '+theme);
      }
    }
    await page.goto('http://127.0.0.1:5178/settings');await page.setViewportSize({width:375,height:950});
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open navigation');
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('link',{name:'Reports',exact:true}).click();
    await page.getByRole('heading',{name:'PDF Reports',exact:true}).waitFor();
    assert.ok(!(await page.getByRole('dialog').isVisible()));
    await page.screenshot({path:path.join(shots,'phase-10-reports-mobile.png')});
    await page.route('**/api/analyze?*',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:{code:'repository_not_found',message:'Repository not found or not public. Check the owner and repository name.'}})}));
    await page.getByRole('textbox',{name:'GitHub repository',exact:true}).fill('missing/repository');await page.getByRole('button',{name:'Analyze',exact:true}).click();
    await page.getByRole('heading',{name:'Unable to load repository',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: production build, all nine pages and 404 route, five widths, both themes, computed palette, mobile Escape focus return, navigation, and controlled missing-repository error');
  } finally { if (browser) await browser.close(); for (const server of servers) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
