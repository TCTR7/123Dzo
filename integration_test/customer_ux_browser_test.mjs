import { createServer } from 'vite';
import { chromium,webkit } from '@playwright/test';
import { access,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const engineName=process.env.UX_BROWSER??'chromium';
assert.ok(['chromium','webkit'].includes(engineName),'Unsupported UX browser');
const engine=engineName==='webkit'?webkit:chromium;
const root=resolve('.'),artifacts=resolve('automation_test/artifacts/ux',engineName==='webkit'?'webkit_'+new Date().toISOString().replaceAll(/[:.]/g,'-'):'');
const server=await createServer({configFile:false,root:resolve('automation_test/preview'),envDir:false,
 resolve:{alias:{'@':resolve('src'),'next/navigation':resolve('automation_test/preview/router.tsx'),'next/link':resolve('automation_test/preview/router.tsx'),'@clerk/nextjs':resolve('automation_test/preview/router.tsx')}},
 esbuild:{jsx:'automatic'},define:{'process.env':'{}'},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},
 plugins:[{name:'isolated-ui-api',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  if(!req.url?.startsWith('/api/'))return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/customer/snapshot')){res.statusCode=503;res.end('{"error":"UI_FIXTURE_NO_DATABASE"}');return;}
  res.statusCode=503;res.end('{"error":"UI_FIXTURE_NO_DATABASE"}');
 });}}]});
let browser;
try {
 await mkdir(artifacts,{recursive:true});await server.listen();
 const base=server.resolvedUrls.local[0];let executablePath;
 for(const path of engineName==='webkit'?[engine.executablePath()]:[engine.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await access(path);executablePath=path;break;}catch{}}
 assert.ok(executablePath,'Install '+engineName);browser=await engine.launch({executablePath,headless:true});
 const context=await browser.newContext(),page=await context.newPage();const errors=[];
 page.setDefaultNavigationTimeout(60000); // Cold Vite dependency compilation, not a product latency budget.
 page.on('pageerror',error=>errors.push(error.message));
 for(const width of [360,390,430]){
  await page.setViewportSize({width,height:844});await page.goto(base);await page.evaluate(()=>localStorage.clear());await page.reload();await page.getByRole('searchbox',{name:'Tìm món'}).waitFor();
  await page.getByRole('button',{name:/Thêm Ếch/}).click();await page.getByRole('button',{name:/Giỏ hàng đã chọn/}).click();
  const dialog=page.getByRole('dialog',{name:/Giỏ hàng/});await dialog.waitFor();
  const note=dialog.getByRole('textbox',{name:/Ghi chú/});await note.fill('Ít cay và không hành');await note.press('End');await page.keyboard.type(' thêm rau');
  assert.equal(await note.inputValue(),'Ít cay và không hành thêm rau');assert.equal(await note.evaluate(node=>node===document.activeElement),true);
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('dialog'))),true);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await dialog.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await page.getByRole('button',{name:/Giỏ hàng đã chọn/}).evaluate(node=>node===document.activeElement),true);
  await page.getByRole('button',{name:/Hiện QR bàn/}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  if(width===390){await page.screenshot({path:resolve(artifacts,'customer_menu_390.png'),fullPage:true});await page.getByRole('button',{name:/Giỏ hàng đã chọn/}).click();await page.screenshot({path:resolve(artifacts,'customer_cart_390.png')});await page.keyboard.press('Escape');}
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'?screen=progress');await page.getByRole('button',{name:'Món đã gọi',exact:true}).click();await page.getByRole('heading',{name:'Món đã gọi của cả bàn',exact:true}).waitFor();await page.screenshot({path:resolve(artifacts,'customer_progress_390.png'),fullPage:true});
 await page.goto(base+'?screen=bill');await page.getByRole('button',{name:/Hóa đơn/}).click();await page.screenshot({path:resolve(artifacts,'customer_bill_390.png'),fullPage:true});await page.setViewportSize({width:430,height:844});
 await page.getByRole('button',{name:/Bấm Gọi Tính Tiền/}).click();
 await page.getByRole('dialog',{name:'Gọi nhân viên tính tiền',exact:true}).waitFor();
 assert.ok((await page.getByRole('dialog').textContent()).includes('tạm dừng gọi thêm món'));
 assert.equal(await page.getByRole('button',{name:'Xác nhận gọi tính tiền'}).isDisabled(),true);
 await page.getByRole('checkbox',{name:/Bỏ món chưa gửi/}).check();
 assert.equal(await page.getByRole('button',{name:'Xác nhận gọi tính tiền'}).isEnabled(),true);
 await page.screenshot({path:resolve(artifacts,'customer_bill_confirmation_430.png')});
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.goto(base+'?screen=takeaway');await page.getByRole('heading',{name:'Đặt món mang về'}).waitFor();
 await page.screenshot({path:resolve(artifacts,'takeaway_menu_390.png'),fullPage:true});
 await page.getByRole('button',{name:/Thêm Ếch/}).click();await page.getByRole('button',{name:/Xem giỏ mang về/}).click();
 await page.getByRole('button',{name:'Xem lại và thông tin nhận'}).click();await page.getByRole('button',{name:'Kiểm tra thông tin nhận'}).click();
 assert.ok(await page.getByRole('alert').count()>=2);assert.equal(await page.getByRole('button',{name:'Thanh toán chưa mở'}).isDisabled(),true);
 await page.screenshot({path:resolve(artifacts,'takeaway_review_390.png')});
 await page.keyboard.press('Escape');
 const contrast=await page.evaluate(()=>{
  const parse=color=>{const values=color.match(/[\d.]+/g)?.map(Number)??[];return [values[0]??0,values[1]??0,values[2]??0,values[3]??1];};
  const blend=(fg,bg)=>[0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3]));
  const luminance=color=>color.map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
  const out=[];
  for(const node of document.querySelectorAll('.customer-app *')){
   if(node.closest('svg')||node.matches(':disabled')||!node.getClientRects().length||!Array.from(node.childNodes).some(child=>child.nodeType===3&&child.textContent.trim()))continue;
   const style=getComputedStyle(node),ancestors=[];let current=node;
   while(current){ancestors.unshift(current);current=current.parentElement;}
   let bg=[255,255,255];for(const ancestor of ancestors)bg=blend(parse(getComputedStyle(ancestor).backgroundColor),bg);
   const fg=blend(parse(style.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
   const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700),minimum=large?3:4.5;
   if(ratio<minimum)out.push({text:node.textContent.trim().slice(0,60),ratio:Math.round(ratio*100)/100,minimum});
  }
  return out;
 });
 assert.deepEqual(contrast,[],'Measured customer text contrast failures');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:780,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'200% layout zoom overflow');
 await page.evaluate(()=>document.documentElement.style.zoom='');
 for(const screen of ['staff','kitchen']){
  await page.setViewportSize({width:1194,height:834});await page.goto(base+'?screen='+screen);await page.waitForTimeout(500);
  assert.ok((await page.textContent('body')).includes('Ít cay')||screen==='staff');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(artifacts,screen+'_1194.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS '+engineName+': actual customer/staff/KDS components;360/390/430px, stable note focus, native modal trap/Escape/return focus, safe disabled checkout. Fixture-only UI; no SSR/Clerk/DB/payment or physical-device acceptance. Artifacts: '+artifacts);
}finally{await browser?.close();await server.close();}
