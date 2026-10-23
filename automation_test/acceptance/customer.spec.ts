import { test,expect } from '@playwright/test';
import { CustomerPage } from './app.page';
import {parseOrderResult,isRecord} from '../../src/lib/orders/contracts';
test('real seeded session: UI cart changes, stable notes and persistence',async({page})=>{
 const token=process.env.E2E_SESSION_TOKEN;test.skip(!token,'Missing isolated live session capability');
 const customer=new CustomerPage(page);await customer.openTable(token!);await customer.chooseFirstAvailable();await customer.openCart();
 await customer.note('Ít cay và không hành');await expect(page.getByRole('dialog').getByRole('textbox',{name:/Ghi chú/}).first()).toBeFocused();
 await page.getByRole('dialog').getByRole('button',{name:'Đóng',exact:true}).click();await page.reload();await customer.openCart();
 await expect(page.getByRole('dialog').getByRole('textbox',{name:/Ghi chú/}).first()).toHaveValue('Ít cay và không hành');
 // No localStorage injection or business-data route mocks. DB mutation scenarios
 // run against the disposable PostgreSQL suite; actual stage order opt-in below.
});
test('real order acknowledgment: one explicit submit and server-visible outcome',async({page})=>{
 test.skip(process.env.E2E_ALLOW_ORDER_MUTATIONS!=='true','Operator has not enabled writes to the isolated test fixture');
 const token=process.env.E2E_SESSION_TOKEN;test.skip(!token,'Missing isolated live session');
 const customer=new CustomerPage(page);await customer.openTable(token!);await customer.chooseFirstAvailable();await customer.openCart();
 const submitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/customer/orders'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Xác nhận Đặt món ngay',exact:true}).click();
 const response=await submitted;expect(response.status()).toBe(200);
 const envelope:unknown=await response.json();const result=isRecord(envelope)?parseOrderResult(envelope.data):null;expect(result).not.toBeNull();
 await expect(page.getByText('Quán đã nhận lượt gọi món của bạn.')).toBeVisible();
 const read=async()=>{
  const snapshot=await page.request.get('/api/customer/snapshot',{headers:{'x-session-token':token!}});expect(snapshot.status()).toBe(200);
  const payload:unknown=await snapshot.json();expect(isRecord(payload)&&isRecord(payload.data)&&Array.isArray(payload.data.items)).toBe(true);
  if(!isRecord(payload)||!isRecord(payload.data)||!Array.isArray(payload.data.items))throw new Error('Invalid isolated snapshot');
  return payload.data.items.filter(isRecord);
 };
 const beforeReplay=await read();
 for(const item of result!.items)expect(beforeReplay.find(row=>row.id===item.id)).toMatchObject({session_id:result!.sessionId,menu_item_id:item.menu_item_id,quantity:item.quantity,unit_price:item.unit_price});
 // Send the same real request identity again, as after a lost response. No mocks.
 const replay=await page.request.post('/api/customer/orders',{headers:{'x-session-token':token!,origin:new URL(page.url()).origin},data:response.request().postDataJSON()});
 expect(replay.status()).toBe(200);const replayEnvelope:unknown=await replay.json();expect(isRecord(replayEnvelope)?parseOrderResult(replayEnvelope.data):null).toEqual(result);
 const afterReplay=await read();expect(afterReplay).toHaveLength(beforeReplay.length);
 for(const item of result!.items)expect(afterReplay.find(row=>row.id===item.id)?.quantity).toBe(item.quantity);
 await page.reload();await page.getByRole('button',{name:'Món đã gọi',exact:true}).click();await expect(page.getByRole('heading',{name:'Món đã gọi của cả bàn'})).toBeVisible();
});
