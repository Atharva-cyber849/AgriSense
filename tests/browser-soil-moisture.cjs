const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.csv':'text/csv','.md':'text/plain'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep))throw Error('path');
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
(async()=>{
  let browser;
  try{
    let base=process.env.SOIL_TEST_BASE_URL;
    if(!base){await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1050}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/soil-moisture.html');
    await page.locator('#soil-dashboard').waitFor();
    assert.equal(await page.locator('#noaa-bars .bar-row').count(),10);
    assert.match(await page.locator('#noaa-finding').textContent(),/Persistence.*0.01942/);
    assert.match(await page.locator('#scan-finding').textContent(),/Kalman LDS.*0.01979/);
    assert.match(await page.locator('#bootstrap-results').textContent(),/interval includes zero/);
    await fs.mkdir(path.join(root,'test-output'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-output/soil-desktop.png'),fullPage:true});
    for(const h of ['1','3','7']){
      await page.locator('#forecast-horizon').selectOption(h);
      assert.match(await page.locator('#noaa-finding').textContent(),new RegExp(h+'-day'));
      assert.equal(await page.locator('#interval-table tbody tr').count(),20);
    }
    await page.locator('#forecast-metric').selectOption('MAE');
    assert.match(await page.locator('#noaa-finding').textContent(),/7-day MAE/);
    const dl=page.waitForEvent('download');await page.locator('#export-forecasts').click();const download=await dl;
    assert.equal(download.suggestedFilename(),'soil-moisture-7-day-scores.csv');
    const content=await fs.readFile(await download.path(),'utf8');
    assert.equal(content.split('\r\n').length,21);
    assert.ok(content.split('\r\n').slice(1).every(line=>line.split(',')[1]==='"7"'));
    await page.locator('[data-view=resilience]').click();
    await page.locator('#robust-network').selectOption('SCAN');
    assert.equal(await page.locator('#robust-table tbody tr').count(),10);
    assert.equal(await page.locator('#climate-bars .paired-row').count(),10);
    await page.screenshot({path:path.join(root,'test-output/soil-resilience.png'),fullPage:true});
    await page.locator('[data-view=field]').click();
    assert.match(await page.locator('#event-support').textContent(),/8 of 10/);
    await page.locator('#event-horizon').selectOption('7');
    assert.match(await page.locator('#event-support').textContent(),/at 7 days/);
    await page.locator('#sunflower-year').selectOption('2015');
    assert.match(await page.locator('#sunflower-count').textContent(),/12 treatment/);
    await page.locator('#sunflower-year').selectOption('all');
    assert.match(await page.locator('#sunflower-count').textContent(),/24 treatment/);
    await page.screenshot({path:path.join(root,'test-output/soil-field.png'),fullPage:true});
    await page.locator('[data-view=sources]').click();
    assert.match(await page.locator('#validation-summary').textContent(),/4,26,752/);
    for(const name of ['Persistence','Logit-normal HMM','Nonlinear beta CPD']){await page.locator('#model-family').selectOption(name);assert.equal(await page.locator('#model-name').textContent(),name);}
    // Every shipped internal download must load without a SPA fallback.
    const links=await page.locator('a[download]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.href))]);
    for(const url of links){const r=await page.request.get(url);assert.equal(r.status(),200,url);assert.ok(!(await r.text()).startsWith('<!doctype'),url);}
    await page.locator('#language-select').selectOption('hi');
    assert.match(await page.locator('#research-scope').textContent(),/ऐतिहासिक/);
    await page.reload();await page.locator('#soil-dashboard').waitFor();
    assert.equal(await page.locator('#language-select').inputValue(),'hi');
    await page.locator('#language-select').selectOption('ta');
    assert.match(await page.locator('#research-scope').textContent(),/ஆய்வு/);
    await page.locator('#language-select').selectOption('en');
    await page.setViewportSize({width:390,height:844});
    for(const view of ['forecasts','resilience','field','sources']){
      await page.locator(`[data-view=${view}]`).click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Mobile overflow: ${view}`);
    }
    await page.locator('[data-view=forecasts]').click();
    await page.screenshot({path:path.join(root,'test-output/soil-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    await page.route('**/data/soil-moisture/dashboard.json',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();await page.locator('#retry-soil').waitFor();
    assert.ok(await page.locator('#soil-dashboard').isHidden());
    await page.unroute('**/data/soil-moisture/dashboard.json');
    await page.locator('#retry-soil').click();await page.locator('#soil-dashboard').waitFor();
    console.log('Soil moisture browser checks passed: filters, uncertainty, export, sources, languages, mobile and failure/retry.');
  }finally{if(browser)await browser.close();if(server.listening)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
