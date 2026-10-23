// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactNode} from 'react';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn()}));
vi.mock('@/lib/auth/staff-guard',()=>({requireStaffPage:mocks.guard}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
vi.mock('@/components/admin/BillsManager',()=>({BillsManager:()=>null}));
vi.mock('@/components/admin/InventoryManager',()=>({InventoryManager:()=>null}));
import BillsPage from '@/app/(auth-protected)/admin/bills/page';
import InventoryPage from '@/app/(auth-protected)/admin/inventory/page';
import {BillsManager} from '@/components/admin/BillsManager';
import {InventoryManager} from '@/components/admin/InventoryManager';
function props(node:ReactNode,type:unknown):Record<string,unknown>|null{
  if(Array.isArray(node)){for(const child of node){const found=props(child,type);if(found)return found;}return null;}
  if(!isValidElement<Record<string,unknown>>(node))return null;
  if(node.type===type)return node.props;return props(node.props.children as ReactNode,type);
}
type Row=Record<string,unknown>;
describe('Paged server lists',()=>{
  let data:Record<string,Row[]>,failed:string|null,queries:string[];
  beforeEach(()=>{
    vi.resetAllMocks();failed=null;queries=[];data={table_sessions:Array.from({length:80},(_,index)=>({id:String(index).padStart(4,'0'),status:index<60?'CLOSED':'ACTIVE',activated_at: null, opened_at:'2026-10-22'})),inventory_logs:Array.from({length:70},(_,index)=>({id:String(index).padStart(4,'0'),type:index<55?'WASTAGE':'IMPORT',created_at:'2026-10-22'}))};
    mocks.guard.mockResolvedValue({userId:'user_admin'});
    mocks.client.mockResolvedValue({from:(table:string)=>{
      queries.push(table);let rows=[...(data[table]??[])],start=0,end=Number.MAX_SAFE_INTEGER,limit=Number.MAX_SAFE_INTEGER;
      const q={select:()=>q,order:()=>q,eq:(field:string,value:unknown)=>{rows=rows.filter(row=>row[field]===value);return q;},
        in:(field:string,values:unknown[])=>{rows=rows.filter(row=>values.includes(row[field]));return q;},
        gt:(field:string,value:string)=>{rows=rows.filter(row=>String(row[field])>value);return q;},limit:(size:number)=>{limit=size;return q;},range:(first:number,last:number)=>{start=first;end=last;return q;},
        then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:failed===table?null:rows.slice(start,end+1).slice(0,limit),error:failed===table?{message:'private SQL'}:null}))};return q;
    }});
  });
  it('filters CLOSED before page2 and loads details lazily instead of scanning order history',async()=>{
    const result=await BillsPage({searchParams:Promise.resolve({page:'2',status:'CLOSED'})});const child=props(result,BillsManager)!;
    expect(child.initialSessions).toHaveLength(25);expect((child.initialSessions as Row[])[0].id).toBe('0025');expect(child.listStatus).toBe('CLOSED');expect(child.initialOrderItems).toEqual([]);expect(queries).not.toContain('order_items');
  });
  it('OPEN excludes unpaid and historical sessions before pagination',async()=>{
    data.table_sessions.push({id:'9999',status:'PENDING_PAYMENT'});const child=props(await BillsPage({}),BillsManager)!;expect(child.initialSessions).toHaveLength(20);
    expect((child.initialSessions as Row[]).every(row=>row.status==='ACTIVE')).toBe(true);
  });
  it('filters stock history before range and passes the remote filter to UI',async()=>{
    const child=props(await InventoryPage({searchParams:Promise.resolve({page:'3',type:'WASTAGE'})}),InventoryManager)!;
    expect(child.initialLogs).toHaveLength(5);expect(child.initialLogType).toBe('WASTAGE');expect(child.remoteLogs).toBe(true);
  });
  it('does not hide failures behind empty bills or logs',async()=>{
    failed='table_sessions';await expect(BillsPage({})).rejects.toThrow('danh sách');failed='inventory_logs';await expect(InventoryPage({})).rejects.toThrow('lịch sử');
  });
  it('preserves numeric table display order after keyset loading by ID',async()=>{
    data.tables=[{id:'a',table_number:'Bàn 10'},{id:'b',table_number:'Bàn 2'}];
    const child=props(await BillsPage({}),BillsManager)!;expect((child.tables as Row[]).map(row=>row.table_number)).toEqual(['Bàn 2','Bàn 10']);
  });
});
