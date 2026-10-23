import { test,expect } from '@playwright/test';
test.describe('Real Clerk/DB authorization — no route mocks',()=>{
 test.use({storageState:{cookies:[],origins:[]}});
 test('anonymous is redirected, not allowed to see internal content',async({page,request})=>{
  for(const route of ['/admin','/admin/menu','/admin/inventory','/admin/payments','/staff','/staff/payments','/kitchen']){
   const response=await page.goto(route);expect(response?.status()).toBeLessThan(500);
   await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);
  }
  for(const route of ['/api/staff/item-actions','/api/push/subscribe','/api/staff/realtime-ticket','/api/staff/payments','/api/staff/takeaway'])expect((await request.post(route,{data:{}})).status()).toBe(401);
 });
 test('customer routes expose no internal navigation or fabricated checkout',async({page})=>{
  await page.goto('/');await expect(page.getByRole('link',{name:'Đăng nhập nhân viên'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Xem thực đơn mang về'})).toBeVisible();
  await page.goto('/customer/takeaway');await expect(page.getByRole('heading',{name:'Đặt món mang về'})).toBeVisible();
  await page.goto('/customer/order/not-a-valid-capability');await expect(page.getByRole('heading',{name:'Mã QR không hợp lệ hoặc bàn đã đóng'})).toBeVisible();
 });
});
for(const [role,path] of [['staff','/admin'],['kitchen','/staff'],['inactive','/admin']] as const){
 test(`${role} cannot enter ${path}`,async({browser,baseURL})=>{
  const state=process.env[`E2E_${role.toUpperCase()}_STORAGE_STATE`];test.skip(!state,`Missing real ${role} Clerk storageState`);
  const context=await browser.newContext({baseURL,storageState:state});try{const page=await context.newPage();const response=await page.goto(path);
   expect(response?.status()).toBe(200);
   await expect(page).toHaveURL(new RegExp(role==='inactive'?'/access-denied(?:[?]|$)':`/${role}$`));await expect(page.getByRole('heading',{name:/Dashboard|Quản trị/})).toHaveCount(0);
  }finally{await context.close();}
 });
}
