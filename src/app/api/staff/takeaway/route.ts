import {NextResponse} from 'next/server';
import {requireStaffApi} from '@/lib/auth/staff-guard';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/server';
import {readJson,RequestBodyError} from '@/lib/api/read-json';
import {isRecord,UUID} from '@/lib/orders/contracts';
import {parsePickupResult} from '@/lib/takeaway/contracts';
import {paymentPage} from '@/lib/payments/contracts';
function fail(status:number,code:string,message:string){return NextResponse.json({error:{code,message}},{status,headers:{'Cache-Control':'no-store'}});}
async function handle(req:Request,write:boolean){
 const access=await requireStaffApi(['staff','admin']);if(access.response)return access.response;
 if(write&&req.headers.get('origin')!==new URL(req.url).origin)return fail(403,'INVALID_ORIGIN','Nguồn yêu cầu không hợp lệ.');
 try{
  const params=new URL(req.url).searchParams;
  if(!write&&!params.has('operationId')){
   const page=paymentPage(params.get('page'));if(page===null||[...params.keys()].some(k=>k!=='page')||params.getAll('page').length>1)return fail(400,'INVALID_PICKUP','Trang không hợp lệ.');
   const {data,error}=await createSupabaseServiceRoleClient().rpc('fn_takeaway_pickup_list',{p_actor_id:access.staff.userId,p_page:page});
   if(error||!isRecord(data)||!Array.isArray(data.rows)||typeof data.hasMore!=='boolean')return fail(503,'PICKUP_UNAVAILABLE','Chưa tải được đơn chờ giao.');
   const rows:{sessionId:string;paymentCode:string;customerName:string|null;totalAmount:number}[]=[];
   for(const row of data.rows){if(!isRecord(row)||typeof row.sessionId!=='string'||!UUID.test(row.sessionId)||typeof row.paymentCode!=='string'||(row.customerName!==null&&typeof row.customerName!=='string')||typeof row.totalAmount!=='number'||!Number.isFinite(row.totalAmount)||row.totalAmount<0)return fail(503,'PICKUP_UNAVAILABLE','Dữ liệu đơn chưa hợp lệ.');rows.push({sessionId:row.sessionId,paymentCode:row.paymentCode,customerName:row.customerName,totalAmount:row.totalAmount});}
   return NextResponse.json({data:{rows,hasMore:data.hasMore}},{headers:{'Cache-Control':'no-store'}});
  }
  const body=write?await readJson(req,2048):null;
  const operation=write&&isRecord(body)?body.operationId:params.get('operationId');
  if(typeof operation!=='string'||!UUID.test(operation)||(!write&&([...params.keys()].some(k=>k!=='operationId')||params.getAll('operationId').length!==1))||(write&&(!isRecord(body)||Object.keys(body).sort().join(',')!=='operationId,sessionId'||typeof body.sessionId!=='string'||!UUID.test(body.sessionId))))return fail(400,'INVALID_PICKUP','Mã giao đơn không hợp lệ.');
  const db=createSupabaseServiceRoleClient(),args={p_actor_id:access.staff.userId,p_operation_id:operation.toLowerCase()};
  const {data,error}=write?await db.rpc('fn_pickup_takeaway',{...args,p_session_id:String((body as Record<string,unknown>).sessionId).toLowerCase()}):await db.rpc('fn_get_takeaway_pickup',args);
  if(error){const map:Record<string,[number,string,string]>={'42501':[403,'FORBIDDEN','Quyền giao đơn đã thay đổi.'],P0002:[404,'ORDER_NOT_FOUND','Không tìm thấy đơn.'],P1501:[409,'PICKUP_NOT_ACTIVE','Đơn chưa xác nhận tiền hoặc đã giao.'],P1305:[409,'PICKUP_NOT_READY','Chưa chuẩn bị đủ món để giao.'],'22023':[400,'INVALID_PICKUP','Thông tin không hợp lệ.']};return fail(...(map[error.code]??[503,'PICKUP_UNAVAILABLE','Chưa xác nhận giao đơn. Hãy đối soát lượt trước.']));}
  if(!write&&data===null)return NextResponse.json({data:null},{headers:{'Cache-Control':'no-store'}});
  const result=parsePickupResult(data);if(!result||result.operationId!==operation.toLowerCase()||result.handedOverBy!==access.staff.userId||(write&&result.sessionId!==String((body as Record<string,unknown>).sessionId).toLowerCase()))return fail(503,'PICKUP_UNAVAILABLE','Chưa đối soát được kết quả giao đơn.');
  return NextResponse.json({data:result},{headers:{'Cache-Control':'no-store'}});
 }catch(e){if(e instanceof RequestBodyError)return fail(e.status,'INVALID_PICKUP',e.message);return fail(503,'PICKUP_UNAVAILABLE','Chưa đối soát được kết quả giao đơn.');}
}
export function GET(req:Request){return handle(req,false);}
export function POST(req:Request){return handle(req,true);}
