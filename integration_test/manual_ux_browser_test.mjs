// Actual components against an isolated API peer; no bank/Clerk/SQL assertions.
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {access,mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const sid='10000000-0000-4000-8000-000000000001',code='NU123456789012345678';let lastOrder=null,posts=0;
const artifacts=resolve('automation_test/artifacts/ux');
const server=await createServer({configFile:false,root:resolve('automation_test/preview'),envDir:false,
 resolve:{alias:{'@':resolve('src'),'next/navigation':resolve('automation_test/preview/router.tsx'),'next/link':resolve('automation_test/preview/router.tsx'),'@clerk/nextjs':resolve('automation_test/preview/router.tsx')}},esbuild:{jsx:'automatic'},define:{'process.env':'{}'},server:{host:'127.0.0.1',port:0,fs:{allow:[resolve('.')]}},
 plugins:[{name:'manual-ui-peer',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/api/'))return next();res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
  if(req.url.startsWith('/api/customer/takeaway')){
   if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);posts++;lastOrder={operationId:body.operationId,sessionId:sid,paymentCode:code,totalAmount:120000,openedAt:new Date().toISOString(),status:'PENDING_PAYMENT'};res.end(JSON.stringify({data:lastOrder}));return;}
   if(req.url.includes('operationId=')){res.end(JSON.stringify({data:lastOrder}));return;}
   res.end(JSON.stringify({data:{sessionId:sid,paymentCode:code,totalAmount:120000,openedAt:new Date().toISOString(),activatedAt:null,closedAt:null,status:'PENDING_PAYMENT',items:[{id:'50000000-0000-4000-8000-000000000001',menuItemId:'20000000-0000-4000-8000-000000000001',name:'Món fixture',quantity:1,unitPrice:120000,note:'Ít cay',station:'KITCHEN',status:'QUEUED'}]}}));return;
  }
  if(req.url==='/api/staff/payments'&&req.method==='POST'){let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);res.end(JSON.stringify({data:{operationId:body.operationId,sessionId:sid,amount:body.command.expectedTotal,paymentMethod:body.command.paymentMethod,reference:body.command.reference,confirmedAt:new Date().toISOString(),confirmedBy:'user_staff',confirmedByName:'Nhân viên fixture',confirmedByRole:'staff',statusBefore:'PENDING_PAYMENT',statusAfter:'ACTIVE'}}));return;}
  res.statusCode=503;res.end('{"error":"UI_FIXTURE_NO_DATABASE"}');
 });}}]});
let browser;
try{
 await mkdir(artifacts,{recursive:true});await server.listen();const base=server.resolvedUrls.local[0];let executablePath;
 for(const path of [chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await access(path);executablePath=path;break;}catch{}}
 assert.ok(executablePath,'Install Chromium');browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});await page.goto(base+'?screen=takeaway-live');await page.getByRole('button',{name:/Thêm Ếch/}).click();await page.getByRole('button',{name:/Xem giỏ mang về/}).click();await page.getByRole('button',{name:'Xem lại và thông tin nhận'}).click();
 await page.getByRole('textbox',{name:'Tên người nhận'}).fill('Khách fixture');await page.getByRole('textbox',{name:'Số điện thoại',exact:true}).fill('0912345678');await page.getByRole('button',{name:'Tiếp tục xác nhận đơn'}).click();assert.equal(posts,0);
 await page.getByRole('button',{name:'Xác nhận gửi đơn mang về',exact:true}).click();await page.getByRole('heading',{name:'Đơn mang về của bạn'}).waitFor();await page.getByText('Chờ xác nhận thanh toán',{exact:true}).waitFor();assert.equal(posts,1);assert.equal(await page.locator('main').count(),1);
 await page.getByText('Hiện QR để quét bằng máy khác',{exact:true}).click();await page.locator('svg').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(artifacts,'takeaway_manual_payment_390.png'),fullPage:true});
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Lưu ảnh QR',exact:true}).click();const download=await downloaded;assert.equal(download.suggestedFilename(),'chuyen-khoan-'+code+'.png');const png=await readFile(await download.path());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 await page.reload();await page.getByRole('button',{name:'Mở đơn đã lưu 1',exact:true}).click();await page.getByText('Chờ xác nhận thanh toán',{exact:true}).waitFor();assert.equal(posts,1);
 await page.goto(base+'?screen=manual');await page.getByRole('button',{name:'Đối chiếu và xác nhận đã nhận tiền'}).click();const dialog=page.getByRole('dialog',{name:'Xác nhận tiền thực nhận',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Xác nhận đã nhận đủ tiền',exact:true}).isDisabled(),true);await dialog.getByRole('textbox',{name:'Mã giao dịch trên ngân hàng'}).fill('TCB-123');await dialog.getByRole('checkbox').check();await page.screenshot({path:resolve(artifacts,'staff_manual_confirmation_390.png')});
 await dialog.getByRole('button',{name:'Xác nhận đã nhận đủ tiền',exact:true}).click();await page.getByText(/Đã ghi nhận .*Nhân viên fixture/).waitFor();await dialog.waitFor({state:'hidden'});assert.deepEqual(errors,[]);await context.close();
 console.log('PASS: actual customer manual checkout/QR/history reload and staff receipt dialog. Fixture API peer only; not bank, auth or database acceptance.');
}finally{await browser?.close();await server.close();}
