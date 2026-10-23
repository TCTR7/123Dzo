// Reconstruct visual baseline from pinned unchanged Git blobs, never a live app.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access,mkdir,mkdtemp,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createServer} from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import {chromium} from '@playwright/test';
import {QRCodeSVG} from 'qrcode.react';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
const root=resolve('.'),ref='9f986ac9413d89a80d7fb1668a1ce07ea1c83e05';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const hash=data=>createHash('sha256').update(data).digest('hex');
const files=['src/components/customer/DineInOrderView.tsx','src/components/customer/TakeawayOrderView.tsx','src/components/kitchen/KitchenKdsBoard.tsx','src/components/staff/StaffDashboard.tsx','src/lib/store/useCartStore.ts','src/lib/utils.ts','src/app/globals.css','package-lock.json'];
await mkdir(resolve('.temp'),{recursive:true});const workspace=await mkdtemp(resolve('.temp/git-baseline-')),sources=[];
for(const file of files){const source=git('show',ref+':'+file),target=join(workspace,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,source);sources.push({path:file,sha256:hash(source)});}
await writeFile(join(workspace,'index.html'),'<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconstructed Git baseline 9f986ac — fixtures only</title><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(join(workspace,'entry.tsx'),`import ${JSON.stringify(resolve('automation_test/baseline/main.jsx'))};`);
const server=await createServer({configFile:false,root:workspace,envDir:false,
 resolve:{alias:[{find:'baseline-dine',replacement:join(workspace,files[0])},{find:'baseline-takeaway',replacement:join(workspace,files[1])},{find:'baseline-kitchen',replacement:join(workspace,files[2])},{find:'baseline-staff',replacement:join(workspace,files[3])},{find:'baseline-css',replacement:join(workspace,files[6])},
 {find:'@/lib/supabase/client',replacement:resolve('automation_test/baseline/peer.mjs')},{find:'@/lib/store/useCartStore',replacement:join(workspace,files[4])},{find:'@/lib/utils',replacement:join(workspace,files[5])},{find:'next/link',replacement:resolve('automation_test/preview/router.tsx')},{find:'@clerk/nextjs',replacement:resolve('automation_test/preview/router.tsx')}]},
 esbuild:{jsx:'automatic'},define:{'process.env':JSON.stringify({NEXT_PUBLIC_VIETQR_BANK_ID:'970407',NEXT_PUBLIC_VIETQR_ACCOUNT_NO:'1234567890',NEXT_PUBLIC_VIETQR_ACCOUNT_NAME:'FIXTURE ONLY'})},
 css:{postcss:{plugins:[tailwindcss({content:[join(workspace,'src/**/*.tsx').replaceAll('\\','/')],darkMode:'class',theme:{extend:{}},plugins:[]}),autoprefixer()]}},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}});
let browser;const captures=[];
try{
 await server.listen();const base=server.resolvedUrls.local[0];let executablePath;
 for(const path of [chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await access(path);executablePath=path;break;}catch{}}
 assert.ok(executablePath,'Install Chromium');browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const qr=renderToStaticMarkup(createElement(QRCodeSVG,{value:'BASELINE_FIXTURE_ONLY_NOT_A_PAYMENT',size:220,xmlns:'http://www.w3.org/2000/svg'}));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===new URL(base).origin)return route.continue();if(url.hostname==='img.vietqr.io')return route.fulfill({contentType:'image/svg+xml',body:qr});return route.abort();});
 async function capture(name){const filename=name+'.png',file=join(workspace,filename);await page.screenshot({path:file,fullPage:true});captures.push({file:filename,sha256:hash(await readFile(file)),viewport:page.viewportSize()});}
 await page.goto(base);await page.getByRole('button',{name:/Thực đơn/}).waitFor();await capture('before_dine_menu_390');
 // Scope the original unnamed add button to its actual menu card, not a test UI.
 await page.getByRole('button',{name:'Chọn',exact:true}).click();
 await page.getByRole('button',{name:/Giỏ hàng đã chọn/}).click();await page.getByPlaceholder('Ghi chú cho bếp (VD: ít cay, không hành...)',{exact:true}).waitFor();await capture('before_dine_cart_390');
 await page.goto(base);await page.getByRole('button',{name:/Tiến độ Bếp/}).click();await capture('before_dine_progress_390');await page.getByRole('button',{name:/Hóa đơn/}).click();await capture('before_dine_bill_390');
 await page.goto(base+'?screen=takeaway');await page.getByRole('heading',{name:/Thanh toán VietQR/}).waitFor();await capture('before_takeaway_menu_390');
 await page.evaluate(()=>localStorage.setItem('123dzo-takeaway-orders-by-phone',JSON.stringify([{sessionId:'10000000-0000-4000-8000-000000000001',sessionToken:'baseline-fixture-only',paymentCode:'BASELINE_FIXTURE_ONLY',customerName:'Khách fixture',customerPhone:'0912345678',totalAmount:120000,openedAt:new Date().toISOString()}])));
 await page.reload();await page.getByRole('button',{name:/Tra cứu đơn bằng SĐT/}).click();await page.getByRole('button',{name:'Xem tiến độ',exact:true}).click();await page.getByText('BASELINE_FIXTURE_ONLY',{exact:true}).first().waitFor();await page.getByRole('img',{name:'Mã thanh toán VietQR động',exact:true}).evaluate(image=>image.decode());await capture('before_takeaway_payment_390');
 for(const screen of ['kitchen','staff']){await page.setViewportSize({width:1194,height:834});await page.goto(base+'?screen='+screen);await page.getByRole('heading',{level:1}).waitFor();await capture('before_'+screen+'_1194');}
 assert.deepEqual(errors,[]);await context.close();
 const destination=resolve('automation_test/artifacts/ux/git_baseline_'+ref.slice(0,7)+'_'+new Date().toISOString().replaceAll(/[:.]/g,'-'));await mkdir(destination,{recursive:true});
 for(const item of captures)await copyFile(join(workspace,item.file),join(destination,item.file));
 const manifest={kind:'reconstructed Git visual baseline',ref,capturedAt:new Date().toISOString(),sources,toolchainLockSha256:hash(await readFile(resolve('package-lock.json'))),screenshots:captures,limitations:['Display fixtures only; no historical deployment or real banking/auth/database evidence.','Original components/store/utils/CSS unchanged; current installed dependencies render the pinned sources.','Legacy data peer denies mutations; non-loopback traffic blocked, QR is a non-payment fixture.']};
 await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));console.log('PASS: 8 original Git UI captures; manifest '+join(destination,'manifest.json'));
}finally{await browser?.close();await server.close();}
