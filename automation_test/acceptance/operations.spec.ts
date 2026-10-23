import { test,expect } from '@playwright/test';
import { OperationsPage } from './app.page';
for(const role of ['admin','staff','kitchen'] as const){
 test(`real ${role} reads guarded page`,async({browser,baseURL})=>{
  const state=process.env[`E2E_${role.toUpperCase()}_STORAGE_STATE`];test.skip(!state,`Missing real ${role} Clerk storageState`);
  const context=await browser.newContext({baseURL,storageState:state});try{
   const page=await context.newPage();
   if(role==='admin'){for(const route of ['/admin','/admin/menu','/admin/inventory','/admin/staff','/admin/bills','/admin/notifications','/admin/payments']){
    const response=await page.goto(route);expect(response?.status()).toBe(200);await expect(page).toHaveURL(new RegExp(route+'$'));
   }}else{const operations=new OperationsPage(page);await operations.open(role==='staff'?'/staff':'/kitchen');
    await expect(page.getByRole('button',{name:role==='staff'?'Bàn của tôi':'Gom món trùng',exact:true})).toBeVisible();
    if(role==='staff'){await page.goto('/staff/payments');await expect(page.getByRole('heading',{name:'Xác nhận thu tiền & lịch sử',exact:true})).toBeVisible();}
   }
  }finally{await context.close();}
 });
}
