// Optional visual QA tool: needs Playwright and a Chrome executable.
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
(async()=>{
  const root = resolve(__dirname,'..');
  const output = resolve(root,'artifacts'); mkdirSync(output,{recursive:true});
  const { connectionCard } = await import(pathToFileURL(resolve(root,'public/connection-card.js')).href);
  const css = readFileSync(resolve(root,'public/style.css'),'utf8');
  writeFileSync(resolve(output,'connection-card.html'),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Как подключить VPN через Incy</title><style>${css}</style></head><body class="connection-page"><div id="connection-root">${connectionCard({standalone:true})}</div></body></html>`);
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  try {
    const page = await browser.newPage({viewport:{width:760,height:1400},deviceScaleFactor:2});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8787/connect');
    await page.locator('.connection-steps li').last().waitFor();
    if(await page.locator('.connection-steps li').count()!==5)throw Error('Expected five steps');
    if(await page.locator('.connection-downloads').count()!==0)throw Error('Download block should be absent');
    if(await page.locator('.connection-brand').textContent()!=='Colors VPN')throw Error('Brand mismatch');
    if(await page.locator('.connection-compensation h3').textContent()!=='Бесплатно до 31 октября')throw Error('Compensation title mismatch');
    await page.locator('.connection-card').screenshot({path:resolve(output,'connection-card.png')});
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Mobile horizontal overflow');
    await page.locator('.connection-card').screenshot({path:resolve(output,'connection-card-mobile.png')});
    await page.goto('http://127.0.0.1:8787/connect');
    await page.locator('.connection-steps li').last().waitFor();
    if(await page.locator('.connection-limit').textContent()!=='◉ Доступ на 2 устройства')throw Error('Device limit missing');
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,steps:5,downloadBlock:false,brand:'Colors VPN',mobileOverflow:false,browserErrors:errors,output},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
