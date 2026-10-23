// No live Supabase/Clerk. Reads return explicit display fixtures; writes throw.
const now=new Date().toISOString();
export const session={id:'10000000-0000-4000-8000-000000000001',session_token:'baseline-fixture-only',session_type:'DINE_IN',status:'ACTIVE',table_id:'70000000-0000-4000-8000-000000000001',assigned_staff_id:'user_staff',customer_name:null,customer_phone:null,payment_code:null,payment_method:null,total_amount:120000,opened_at:now,closed_at:null};
export const menu=[{id:'20000000-0000-4000-8000-000000000001',name:'Ếch xào sả ớt và rau thơm — tên món dài để kiểm tra xuống dòng',category:'FOOD',station:'KITCHEN',price:120000,cost_price:50000,prep_time_minutes:15,image_url:null,is_available:true,linked_ingredient_id:null},
 {id:'20000000-0000-4000-8000-000000000002',name:'Bia lon',category:'BEER',station:'BAR_INSTANT',price:22000,cost_price:13000,prep_time_minutes:0,image_url:null,is_available:false,linked_ingredient_id:null}];
export const order={id:'40000000-0000-4000-8000-000000000001',session_id:session.id,menu_item_id:menu[0].id,quantity:1,note:'Ít cay, không hành',station:'KITCHEN',status:'QUEUED',batch_id:null,unit_price:120000,unit_cost_price:50000,served_by_staff_id:null,created_at:now,cooking_started_at:null,ready_at:null,served_at:null,cancelled_at:null,cancelled_by:null,cancel_reason:null};
export const zone={id:'80000000-0000-4000-8000-000000000001',name:'Sân vườn',created_at:now};
export const table={id:session.table_id,table_number:'Bàn 1',zone_id:zone.id,status:'OCCUPIED',current_session_id:session.id};
export const staff={id:'user_staff',full_name:'Nhân viên kiểm thử',role:'staff',assigned_zone_id:zone.id,is_active:true,push_subscription:null};
const takeaway={...session,session_type:'TAKEAWAY',table_id:null,status:'PENDING_PAYMENT',customer_name:'Khách fixture',customer_phone:'0912345678',payment_code:'BASELINE_FIXTURE_ONLY'};
export const saved=[{sessionId:takeaway.id,sessionToken:takeaway.session_token,paymentCode:takeaway.payment_code,customerName:takeaway.customer_name,customerPhone:takeaway.customer_phone,totalAmount:takeaway.total_amount,openedAt:now}];
const channel={on(){return channel;},subscribe(){return channel;}};
const deny=()=>{throw new Error('Historical baseline forbids mutations');};
const client={channel:()=>channel,removeChannel:()=>Promise.resolve(),from(tableName){
 let single=false;const query={select(){return query;},eq(){return query;},or(){return query;},order(){return query;},limit(){return query;},single(){single=true;return query;},
 insert:deny,update:deny,delete:deny,upsert:deny,
 then(resolve,reject){const data=tableName==='table_sessions'?(single?takeaway:[takeaway]):tableName==='order_items'?[order]:[];return Promise.resolve({data,error:null}).then(resolve,reject);}};return query;
}};
export const createSupabaseBrowserClient=()=>client;
