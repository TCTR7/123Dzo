import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {TakeawayPage} from './app.page';
import {isRecord} from '../../src/lib/orders/contracts';
import {parseTakeawayCreated,parseTakeawaySnapshot,parsePickupResult} from '../../src/lib/takeaway/contracts';
import {parseManualPaymentResult} from '../../src/lib/payments/contracts';

test('isolated manual takeaway: create/replay, receipt/audit and separate pickup',async({page,browser,baseURL})=>{
 test.skip(process.env.E2E_ALLOW_TAKEAWAY_MUTATIONS!=='true','Explicit isolated-fixture write opt-in required');
 const state=process.env.E2E_STAFF_STORAGE_STATE,phone=process.env.E2E_TAKEAWAY_PHONE,menuName=process.env.E2E_TAKEAWAY_BAR_NAME;
 if(!state||!phone||!menuName)throw new Error('Configured staff, test recipient and available BAR_INSTANT fixture are required');
 const shop=new TakeawayPage(page);let posts=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/customer/takeaway'&&request.method()==='POST')posts++;});
 await shop.review('Khách nghiệm thu riêng',phone,menuName);expect(posts).toBe(0);
 const submitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/customer/takeaway'&&response.request().method()==='POST');
 await shop.submit();const response=await submitted;expect(response.status()).toBe(200);
 const envelope:unknown=await response.json(),created=isRecord(envelope)?parseTakeawayCreated(envelope.data):null;expect(created).not.toBeNull();if(!created)throw new Error('Invalid created fixture');expect(envelope).toEqual({data:created});
 const token=response.request().headers()['x-takeaway-token'];expect(token).toMatch(/^[a-f0-9]{64}$/);
 const origin=new URL(baseURL!).origin;
 async function snapshot(){const r=await page.request.get('/api/customer/takeaway',{headers:{'x-takeaway-token':token}});expect(r.status()).toBe(200);const body:unknown=await r.json();const parsed=isRecord(body)?parseTakeawaySnapshot(body.data):null;expect(parsed).not.toBeNull();if(!parsed)throw new Error('Invalid snapshot');expect(body).toEqual({data:parsed});return parsed;}
 const pending=await snapshot();expect(pending.status).toBe('PENDING_PAYMENT');expect(pending.items.length).toBeGreaterThan(0);expect(pending.items.every(item=>item.station==='BAR_INSTANT')).toBe(true);
 const replay=await page.request.post('/api/customer/takeaway',{headers:{origin,'x-takeaway-token':token},data:response.request().postDataJSON()});expect(replay.status()).toBe(200);expect(await replay.json()).toEqual(envelope);
 await shop.reopen();await expect(page.getByText('Chờ xác nhận thanh toán',{exact:true})).toBeVisible();expect(posts).toBe(1);
 expect((await page.request.post('/api/staff/payments',{headers:{origin},data:{}})).status()).toBe(401);
 const staff=await browser.newContext({baseURL,storageState:state});
 try{
  // CASH is synthetic in the explicitly isolated fixture; never a bank transfer.
  const receiptCommand={operationId:randomUUID(),command:{sessionId:created.sessionId,expectedTotal:created.totalAmount,paymentMethod:'CASH',reference:'',confirmedReceived:true}};
  const paid=await staff.request.post('/api/staff/payments',{headers:{origin},data:receiptCommand});expect(paid.status()).toBe(200);
  const paidBody:unknown=await paid.json(),receipt=isRecord(paidBody)?parseManualPaymentResult(paidBody.data):null;expect(receipt).not.toBeNull();if(!receipt)throw new Error('Invalid receipt');
  expect(receipt.amount).toBe(created.totalAmount);expect(receipt.confirmedBy).toBeTruthy();expect(receipt.confirmedAt).toBeTruthy();
  const paidReplay=await staff.request.post('/api/staff/payments',{headers:{origin},data:receiptCommand});expect(paidReplay.status()).toBe(200);expect(await paidReplay.json()).toEqual(paidBody);
  const active=await snapshot();expect(active.status).toBe('ACTIVE');expect(active.items.every(item=>item.status==='READY')).toBe(true);
  const historyResponse=await staff.request.get('/api/staff/payments'),history:unknown=await historyResponse.json();expect(historyResponse.status()).toBe(200);
  expect(isRecord(history)&&isRecord(history.data)&&Array.isArray(history.data.history)&&history.data.history.some(row=>isRecord(row)&&row.sessionId===created.sessionId&&row.confirmedBy===receipt.confirmedBy&&row.confirmedAt===receipt.confirmedAt)).toBe(true);
  const handover={operationId:randomUUID(),sessionId:created.sessionId},pickup=await staff.request.post('/api/staff/takeaway',{headers:{origin},data:handover});expect(pickup.status()).toBe(200);
  const pickupBody:unknown=await pickup.json(),result=isRecord(pickupBody)?parsePickupResult(pickupBody.data):null;expect(result?.handedOverBy).toBe(receipt.confirmedBy);
  const pickupReplay=await staff.request.post('/api/staff/takeaway',{headers:{origin},data:handover});expect(pickupReplay.status()).toBe(200);expect(await pickupReplay.json()).toEqual(pickupBody);
  const closed=await snapshot();expect(closed.status).toBe('CLOSED');expect(closed.items.every(item=>item.status==='SERVED')).toBe(true);
  await shop.reopen();await expect(page.getByText('Đơn đã hoàn tất',{exact:true})).toBeVisible();expect(posts).toBe(1);
 }finally{await staff.close();}
});
