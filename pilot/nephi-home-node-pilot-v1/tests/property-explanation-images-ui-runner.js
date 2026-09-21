'use strict';
// BROWSER_RENDER: actual image card component at desktop/390/360; local API doubles.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const component=path.resolve(__dirname,'../public/assets/property-images.js');assert.ok(fs.existsSync(component),'image card controls required');
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [1280,390,360]){
   const page=await browser.newPage({viewport:{width,height:850}});let uploads=0,deletes=0;
   await page.route('https://ui.example.test/**',async route=>{
    const request=route.request();
    if(request.url().includes('/api/property-images')){
     if(request.method()==='PUT'){uploads++;assert.equal(request.headers()['content-type'],'image/png');return route.fulfill({json:{data:{sourceId:'parking',previewImageUrl:'https://ui.example.test/preview.jpg',originalContentUrl:'https://ui.example.test/original.jpg'}}});}
     if(request.method()==='DELETE'){deletes++;return route.fulfill({json:{data:{deleted:true}}});}
     return route.fulfill({json:{data:{items:[]}}});
    }
    if(request.url().endsWith('.jpg'))return route.fulfill({contentType:'image/png',body:require('./property-explanation-images-runner').PNG});
    await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="max-width:550px;margin:auto;padding:16px"><article><h4>停車說明</h4><p>請將車輛停在指定停車區。</p><div id="card"></div></article></main></body></html>'});
   });
   await page.goto('https://ui.example.test/');await page.addStyleTag({path:path.resolve(__dirname,'../public/assets/styles.css')});await page.addStyleTag({path:path.resolve(__dirname,'../public/assets/property-images.css')});await page.addScriptTag({path:component});
   await page.evaluate(()=>document.getElementById('card').append(PropertyImages.create('parking','image_a')));
   await page.locator('button').filter({hasText:'上傳圖片'}).waitFor();
   await page.locator('input[type=file]').setInputFiles({name:'parking.png',mimeType:'image/png',buffer:require('./property-explanation-images-runner').PNG});
   await page.getByText('圖片已儲存').waitFor();assert.equal(uploads,1);await page.locator('img').waitFor({state:'visible'});await page.locator('img').evaluate(image=>image.decode());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.ok(await page.locator('img').isVisible());
   if(process.env.IMAGE_BROWSER_EVIDENCE)await page.screenshot({path:path.join(process.env.IMAGE_BROWSER_EVIDENCE,'diagnostic-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].filter(x=>x.scrollWidth>x.clientWidth||x.getBoundingClientRect().right>innerWidth).map(x=>({tag:x.tagName,cls:x.className,rect:x.getBoundingClientRect().toJSON(),scroll:x.scrollWidth,client:x.clientWidth,css:getComputedStyle(x).overflow,position:getComputedStyle(x).position}))}))));
   for(const button of await page.locator('button:visible').all())assert.ok((await button.boundingBox()).height>=44);
   await page.locator('input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:require('./property-explanation-images-runner').PNG});
   await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='圖片已儲存');assert.equal(uploads,2);
   if(process.env.IMAGE_BROWSER_EVIDENCE)await page.screenshot({path:path.join(process.env.IMAGE_BROWSER_EVIDENCE,'card-'+width+'.png'),fullPage:true});
   await page.getByRole('button',{name:'刪除圖片'}).click();await page.getByText('圖片已刪除').waitFor();assert.equal(deletes,1);assert.equal(await page.locator('img').isVisible(),false);
   await page.close();
  }
  console.log('PASS browser image upload/preview/replace/delete, desktop/390/360, touch/no overflow; BROWSER_RENDER_WITH_API_DOUBLES; OPENAI_CALLS=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
