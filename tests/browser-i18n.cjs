// Run with PLAYWRIGHT_MODULE pointing to Playwright if it is not installed locally.
// Uses the repository's real data; no pipeline or model-training endpoint is invoked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  let name=url.pathname;
  if(name==='/api/data')name='/data/karnal_master_demo_output.json';
  else if(name.startsWith('/api/period/'))name='/data/periods/'+name.slice('/api/period/'.length)+'.json';
  else if(name.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Test: inference deliberately offline'}));return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep))throw Error('path');
  const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 let browser;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#persona-select').selectOption('farmer');
  await page.locator('[data-farmer-field]').first().waitFor({timeout:45000});
  assert.equal(await page.locator('html').getAttribute('lang'),'hi');
  assert.match(await page.locator('#persona-view-container').textContent(),/मेरे खेत/);
  assert.equal(await page.locator('[data-farmer-field]').count(),2);
  assert.match(await page.locator('[data-layer=advisory]').textContent(),/सिंचाई सलाह/);
  await page.locator('[data-farmer-field]').first().click();
  await page.locator('#live-inference-card .live-inference-error').waitFor();
  assert.match(await page.locator('#live-inference-card').textContent(),/AI आकलन उपलब्ध नहीं/);
  assert.match(await page.locator('#m-advisory-text').textContent(),/प्रायोगिक/);
  const snapshot=await page.evaluate(()=>({role:currentPersonaRole,index:currentPeriodIndex,id:activeField.field_id,water:JSON.stringify(currentRecord(activeField.field_id).water_balance)}));
  await page.locator('#btn-close-field-modal').click();
  const centerBefore=await page.evaluate(()=>{map.stop();map.setView([29.7,76.9],12,{animate:false});return map.getCenter();});
  await page.locator('#language-select').selectOption('ta');
  assert.deepEqual(await page.evaluate(()=>map.getCenter()),centerBefore);
  assert.match(await page.locator('#persona-view-container').textContent(),/எனது வயல்கள்/);
  assert.match(await page.locator('#panel-title').textContent(),/விவசாயி/);
  assert.match(await page.locator('[data-layer=advisory]').textContent(),/பாசன ஆலோசனை/);
  assert.equal(await page.locator('#persona-select').inputValue(),'farmer');
  await page.locator('[data-farmer-field]').first().click();
  assert.match(await page.locator('#m-advisory-text').textContent(),/சோதனை/);
  const after=await page.evaluate(()=>({role:currentPersonaRole,index:currentPeriodIndex,id:activeField.field_id,water:JSON.stringify(currentRecord(activeField.field_id).water_balance)}));
  assert.deepEqual(after,snapshot,'language switch must preserve records, period, role and viewport');
  await page.locator('#btn-close-field-modal').click();
  await fs.mkdir(path.join(root,'test-output'),{recursive:true});
  for(const lang of ['ta','hi','en']){
   await page.locator('#language-select').selectOption(lang);
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:path.join(root,`test-output/farmer-${lang}.png`),fullPage:true});
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))console.log(await page.locator('body *').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().right>390&&getComputedStyle(n).display!=='none').slice(0,18).map(n=>({tag:n.tagName,cls:n.className,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width}))));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${lang} mobile width`);
   await page.screenshot({path:path.join(root,`test-output/farmer-${lang}.png`),fullPage:true});
  }
  assert.match(await page.locator('#persona-view-container').textContent(),/My Farms/);
  assert.match(await page.locator('[data-layer=advisory]').textContent(),/Irrigation Advisory/);
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#language-select').inputValue(),'en');
  await page.locator('#language-select').selectOption('ta');
  await page.goto(base+'/haridwar.html',{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#language-select').inputValue(),'ta');
  await page.locator('#language-select').selectOption('auto');
  assert.equal(await page.locator('html').getAttribute('lang'),'hi');
  await page.goto(base+'/agrifieldnet.html',{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.locator('#language-select').selectOption('hi');
  assert.equal(await page.locator('#language-select').inputValue(),'hi');
  const blocked=await browser.newPage();
  await blocked.addInitScript(()=>{Storage.prototype.getItem=function(){throw Error('blocked');};Storage.prototype.setItem=function(){throw Error('blocked');};});
  await blocked.goto(base+'/agrifieldnet.html',{waitUntil:'domcontentloaded'});
  await blocked.locator('#language-select').selectOption('hi');
  assert.match(await blocked.locator('#language-status').textContent(),/सहेजी नहीं/);
  assert.deepEqual(errors,[]);
  console.log('Passed: real farmer records, Hindi/Tamil/English, legends, prototype advisories, offline messages, unchanged records/viewport/role, cross-page persistence, mobile and blocked storage.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
