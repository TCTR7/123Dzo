// Fixture data is outside src. This mounts the actual shipped components.
// It is UI evidence only, never evidence for Clerk/RLS/payment/SSR transactions.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DineInOrderView } from '../../src/components/customer/DineInOrderView';
import { TakeawayBrowseView } from '../../src/components/customer/TakeawayBrowseView';
import { AdminKpiDashboard } from '../../src/components/admin/AdminKpiDashboard';
import { KitchenKdsBoard } from '../../src/components/kitchen/KitchenKdsBoard';
import { StaffDashboard } from '../../src/components/staff/StaffDashboard';
import {ManualPayments} from '../../src/components/staff/ManualPayments';
import {TakeawayFlow} from '../../src/components/customer/TakeawayFlow';
import '../../src/app/globals.css';
import type { MenuItemRow,TableSessionRow } from '../../src/types/database.types';
const sid='10000000-0000-4000-8000-000000000001',mid='20000000-0000-4000-8000-000000000001',tid='70000000-0000-4000-8000-000000000001',zid='80000000-0000-4000-8000-000000000001';
const session:TableSessionRow={id:sid,session_token:'ui-fixture-capability',session_type:'DINE_IN',status:'ACTIVE',table_id:tid,assigned_staff_id:'user_staff',customer_name:null,customer_phone:null,payment_code:null,payment_method:null,total_amount:0,opened_at:new Date().toISOString(),closed_at:null,activated_at:null};
const menu:MenuItemRow[]=[{id:mid,name:'Ếch xào sả ớt và rau thơm — tên món dài để kiểm tra đọc trên điện thoại',category:'FOOD',station:'KITCHEN',price:120000,cost_price:40000,prep_time_minutes:15,image_url:null,is_available:true,linked_ingredient_id:null},
 {id:'20000000-0000-4000-8000-000000000002',name:'Bia lon',category:'BEER',station:'BAR_INSTANT',price:22000,cost_price:13000,prep_time_minutes:0,image_url:null,is_available:false,linked_ingredient_id:null}];
const zone={id:zid,name:'Sân vườn',created_at:new Date().toISOString()},table={id:tid,table_number:'Bàn 1',zone_id:zid,status:'OCCUPIED' as const,current_session_id:sid};
const staff={id:'user_staff',full_name:'Nhân viên kiểm thử',role:'staff' as const,assigned_zone_id:zid,is_active:true};
const order={id:'40000000-0000-4000-8000-000000000001',session_id:sid,menu_item_id:mid,quantity:1,note:'Ít cay, không hành',station:'KITCHEN' as const,status:'QUEUED' as const,batch_id:null,unit_price:120000,created_at:new Date().toISOString(),cooking_started_at:null,ready_at:null,served_at:null,cancelled_at:null,cancel_reason:null};
const screen=new URLSearchParams(location.search).get('screen');
const fixtureItems=screen==='bill'?[{...order,status:'SERVED' as const,ready_at:new Date().toISOString(),served_at:new Date().toISOString()}]:screen==='progress'?[order]:[];
const financial={gross_revenue:0,cash_revenue:0,vietqr_revenue:0,dine_in_revenue:0,takeaway_revenue:0,closed_sessions_count:0,total_cogs:0,total_wastage_cost:0,net_profit:0};
const kitchen={total_cooked_items:0,batch_cooked_items:0,avg_queue_wait_minutes:0,avg_actual_cook_minutes:0,avg_standard_prep_minutes:0,cook_time_evaluation:'NO_DATA' as const,batch_cooking_efficiency_pct:0,slow_cancelled_count:0};
createRoot(document.getElementById('root')!).render(screen==='takeaway'?<TakeawayBrowseView menu={menu} store={{name:'123Dzô',address:'',phone:'',hours:'',verified:false}}/>:
 screen==='takeaway-live'?<TakeawayFlow menu={menu} store={{name:'Nhỏ Út (UI fixture)',address:'Địa chỉ fixture',phone:'0905729459',hours:'10:00–23:30',verified:true}} settings={{enabled:true,bank:{bankId:'970407',accountNo:'1234567890',accountName:'FIXTURE ONLY'}}}/>:
 screen==='manual'?<ManualPayments actorId="user_staff" path="/staff/payments" status={{pending:[{sessionId:sid,paymentCode:'NU123456789012345678',customerName:'Khách fixture',customerPhone:'0912345678',amount:120000,openedAt:session.opened_at}],history:[],pendingHasMore:false,historyHasMore:false}}/>:
 screen==='kpi'?<AdminKpiDashboard initialFinancial={financial} initialPeakHours={[]} initialMenuAnalytics={[]} initialKitchenKpi={kitchen} initialWaitstaffKpi={[]}/>:
 screen==='kitchen'?<KitchenKdsBoard initialKitchenOrders={[order]} initialActiveSessions={[session]} tables={[table]} initialMenuItems={menu} currentStaffId="user_kitchen"/>:
 screen==='staff'?<StaffDashboard initialZones={[zone]} initialTables={[table]} initialSessions={[session]} initialOrderItems={[{...order,status:'READY',ready_at:new Date().toISOString()}]} menuItems={menu} staffProfiles={[staff]} currentStaffId="user_staff" currentStaffRole="staff"/>:
 <DineInOrderView initialSession={session} table={table} zone={zone} initialMenuItems={menu} initialSessionOrders={fixtureItems} initialQueuePositions={{}}/>);
