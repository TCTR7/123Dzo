import { beforeEach,describe,it,expect } from 'vitest';
import { useCartStore,useTakeawayCartStore } from '@/lib/store/useCartStore';
import { migrateCartLines } from '@/lib/customer/cart-lines';
import { deriveTakeawayStatus,itemStatusLabel } from '@/lib/customer/order-status';
const item={menu_item_id:'meal',name:'Meal',category:'FOOD',station:'KITCHEN',unit_price:100,image_url:null} as const;
describe('Production line helpers and isolated persisted carts',()=>{
 beforeEach(()=>{for(const store of [useCartStore,useTakeawayCartStore])store.setState({items:[],sessionToken:null,submissionTimestamps:[],acceptedOperationIds:[]});});
 it('changes exactly one line and never changes its identity during a note edit',()=>{
  const store=useCartStore.getState();store.addItem({...item,note:'less spicy'});store.addItem({...item,note:'no onion'});
  const [a,b]=useCartStore.getState().items;store.updateNote(a.lineId,'twenty characters here');
  expect(useCartStore.getState().items.map(x=>x.lineId)).toEqual([a.lineId,b.lineId]);
  expect(useCartStore.getState().items[1].note).toBe('no onion');store.updateQuantity(a.lineId,0);
  expect(useCartStore.getState().items.map(x=>x.lineId)).toEqual([b.lineId]);
 });
 it('migrates valid old lines, rejects corrupt quantities and makes IDs unique',()=>{
  const valid={...item,quantity:2,note:'Keep me'};
  const rows=migrateCartLines([valid,{...valid,quantity:NaN},{...valid,quantity:-1},{...valid,quantity:1.5},null]);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject(valid);expect(rows[0].lineId).toMatch(/^[a-f0-9-]{36}$/);
  expect(new Set(migrateCartLines([rows[0],rows[0]]).map(x=>x.lineId)).size).toBe(2);
 });
 it('does not share dine-in and takeaway contents',()=>{
  useCartStore.getState().addItem(item);expect(useTakeawayCartStore.getState().items).toHaveLength(0);
  useTakeawayCartStore.getState().addItem({...item,quantity:2});useCartStore.getState().setSessionToken('tableA');useCartStore.getState().setSessionToken('tableB');
  expect(useCartStore.getState().items).toHaveLength(0);expect(useTakeawayCartStore.getState().items[0].quantity).toBe(2);
 });
 it('bounds persisted contents and validates every restored line before showing a price',()=>{
  expect(migrateCartLines({items:[]})).toEqual([]);
  const valid={...item,quantity:1};
  expect(migrateCartLines([{...valid,station:'UNKNOWN'},{...valid,category:'UNKNOWN'},{...valid,unit_price:Infinity},{...valid,menu_item_id:''}])).toEqual([]);
  const restored=migrateCartLines(Array.from({length:101},()=>({...valid,note:'x'.repeat(600),image_url:42})));
  expect(restored).toHaveLength(100);expect(restored[0].note).toHaveLength(500);expect(restored[0].image_url).toBeNull();
  expect(new Set(restored.map(row=>row.lineId)).size).toBe(100);
 });
});
describe('Customer status never invites pickup for a partial or empty order',()=>{
 it('handles empty, zero and all-cancelled explicitly',()=>{
  for(const items of [[],[{status:'READY' as const,quantity:0}],[{status:'CANCELLED' as const,quantity:1}]])expect(deriveTakeawayStatus('ACTIVE',items).kind).toBe('CHECK');
 });
 it('requires every valid item ready/served',()=>{
  expect(deriveTakeawayStatus('ACTIVE',[{status:'READY',quantity:1},{status:'QUEUED',quantity:1}]).kind).toBe('PREPARING');
  expect(deriveTakeawayStatus('ACTIVE',[{status:'READY',quantity:1},{status:'SERVED',quantity:1}]).kind).toBe('READY');
 });
 it('honors closed/pending/review before item states and translates labels',()=>{
  expect(deriveTakeawayStatus('CLOSED',[]).kind).toBe('COMPLETED');expect(deriveTakeawayStatus('PENDING_PAYMENT',[{status:'READY',quantity:1}]).kind).toBe('PAYMENT');
  expect(deriveTakeawayStatus('ACTIVE',[{status:'READY',quantity:1}],true).kind).toBe('CHECK');expect(deriveTakeawayStatus('REQUEST_BILL',[]).kind).toBe('CHECK');
  expect(itemStatusLabel.READY).not.toContain('đang bưng');
 });
});
