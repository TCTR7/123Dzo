// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth/staff-guard',()=>({requireStaffPage:mocks.guard}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
vi.mock('@/components/staff/StaffDashboard',()=>({StaffDashboard:()=>null}));
vi.mock('@/components/kitchen/KitchenKdsBoard',()=>({KitchenKdsBoard:()=>null}));
vi.mock('@/components/admin/StaffAndTableManager',()=>({StaffAndTableManager:()=>null}));
vi.mock('@/components/admin/MenuManager',()=>({MenuManager:()=>null}));
import StaffPage from '@/app/(auth-protected)/staff/page';
import KitchenPage from '@/app/(auth-protected)/kitchen/page';
import AdminStaffPage from '@/app/(auth-protected)/admin/staff/page';
import MenuPage from '@/app/(auth-protected)/admin/menu/page';
type Row=Record<string,unknown>;
describe('Server pages project exactly the data needed by each role',()=>{
 let data:Record<string,Row[]>,failure:string|null;
 beforeEach(()=>{
  vi.resetAllMocks();failure=null;mocks.guard.mockResolvedValue({userId:'fixture-actor',role:'staff'});
  data={zones:[{id:'a',name:'A',created_at:'2026-10-22'},{id:'b',name:'B',created_at:'2026-10-23'}],tables:[{id:'a',table_number:'Bàn 10'},{id:'b',table_number:'Bàn 2'}],
   table_sessions:[{id:'a',status:'ACTIVE',session_token:'private-capability',customer_name:'Recipient',customer_phone:'private-phone',payment_code:'private-payment',activated_at:null},{id:'b',status:'PENDING_PAYMENT'}],
   order_items:[{id:'a',session_id:'a',station:'KITCHEN',status:'QUEUED',unit_cost_price:40,created_at:'2026-10-22'},{id:'b',session_id:'b',station:'KITCHEN',status:'QUEUED',created_at:'2026-10-22'},{id:'c',session_id:'a',station:'BAR_INSTANT',status:'READY',created_at:'2026-10-22'}],
   menu_items:[{id:'a',name:'Zebra',cost_price:40,linked_ingredient_id:'private-stock'},{id:'b',name:'An',cost_price:12}],
   staff_profiles:[{id:'a',full_name:'Z',role:'staff',assigned_zone_id:null,is_active:true,push_subscription:{endpoint:'https://private-provider',keys:{auth:'private-auth',p256dh:'private-key'}}},{id:'b',full_name:'A',role:'staff',assigned_zone_id:null,is_active:true,push_subscription:null}],
   ingredients:[{id:'a',name:'Z'},{id:'b',name:'A'}]};
  mocks.client.mockReturnValue({from:(table:string)=>{
   let rows=[...(data[table]??[])],fields:string[]=[];
   const query={select:(value:string)=>{fields=value.split(',').map(field=>field.trim()).filter(field=>!field.includes('!'));return query;},order:()=>query,limit:()=>query,
    gt:(field:string,cursor:string)=>{rows=rows.filter(row=>String(row[field])>cursor);return query;},
    eq:(field:string,value:unknown)=>{rows=rows.filter(row=>row[field]===value);return query;},
    in:(field:string,values:unknown[])=>{rows=rows.filter(row=>values.includes(field==='table_sessions.status'?data.table_sessions.find(session=>session.id===row.session_id)?.status:row[field]));return query;},
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:failure===table?null:rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]]))),error:failure===table?{message:'private SQL'}:null}))};
   return query;
  }});
 });
 it('Staff receives only live work, public menu prices and a safe staff directory',async()=>{
  const result=await StaffPage();expect(result.props.currentStaffId).toBe('fixture-actor');expect(result.props.initialSessions).toHaveLength(1);expect(result.props.initialOrderItems).toHaveLength(2);
  const serialized=JSON.stringify(result.props);for(const secret of ['private-phone','private-payment','private-auth','private-key','unit_cost_price','cost_price','linked_ingredient_id','push_subscription'])expect(serialized).not.toContain(secret);
  expect(result.props.initialTables.map((row:{table_number:string})=>row.table_number)).toEqual(['Bàn 2','Bàn 10']);
 });
 it('KDS excludes unpaid/bar work and receives no capability, phone, cost or subscription',async()=>{
  const result=await KitchenPage();expect(result.props.initialKitchenOrders.map((row:{id:string})=>row.id)).toEqual(['a']);
  const serialized=JSON.stringify(result.props);for(const secret of ['private-capability','private-phone','private-payment','unit_cost_price','cost_price','push_subscription'])expect(serialized).not.toContain(secret);
 });
 it('admin staff directory exposes a registration flag instead of push endpoints or keys',async()=>{
  const result=await AdminStaffPage();const staff=result.props.initialStaff;
  expect(staff.find((row:{id:string})=>row.id==='a')).toMatchObject({has_push_subscription:true});expect(staff.find((row:{id:string})=>row.id==='b')).toMatchObject({has_push_subscription:false});
  for(const row of staff)expect(row).not.toHaveProperty('push_subscription');
  expect(JSON.stringify(staff)).not.toContain('private-provider');expect(JSON.stringify(staff)).not.toContain('private-key');
 });
 it('only the guarded menu administration projection retains cost and ingredient mapping',async()=>{
  const result=await MenuPage();expect(mocks.guard).toHaveBeenCalledWith(['admin']);expect(result.props.initialMenuItems.map((row:{name:string})=>row.name)).toEqual(['An','Zebra']);
  expect(result.props.initialMenuItems.find((row:{id:string})=>row.id==='a')).toMatchObject({cost_price:40,linked_ingredient_id:'private-stock'});
 });
 it.each([StaffPage,KitchenPage,AdminStaffPage,MenuPage])('never turns a partial catalog read into successful empty props',async page=>{
  failure='menu_items';if(page===AdminStaffPage)failure='staff_profiles';await expect(page()).rejects.toThrow('Không tải được danh sách đầy đủ');
 });
});
