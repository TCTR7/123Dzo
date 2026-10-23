import {NextResponse} from 'next/server';
import {readJson,RequestBodyError} from '@/lib/api/read-json';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/server';
import {parseTakeawayRequest,parseTakeawayCreated,parseTakeawaySnapshot,TOKEN} from '@/lib/takeaway/contracts';
import {takeawaySettings} from '@/lib/takeaway/config';
import {UUID} from '@/lib/orders/contracts';
import {takeawayRequestIdentity,claimTakeawayRequest} from '@/lib/takeaway/request-limit';
function fail(status:number,code:string,message:string){return NextResponse.json({error:{code,message,retryable:status>=500}},{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
async function handle(req:Request,write:boolean){
 const token=req.headers.get('x-takeaway-token');if(!token||!TOKEN.test(token))return fail(403,'FORBIDDEN','Mã truy cập đơn không hợp lệ.');
 if(write&&req.headers.get('origin')!==new URL(req.url).origin)return fail(403,'INVALID_ORIGIN','Nguồn yêu cầu không hợp lệ.');
 if(write&&!takeawaySettings().enabled)return fail(503,'TAKEAWAY_DISABLED','Quán chưa mở nhận đơn mang về trực tuyến.');
 try{
  const params=new URL(req.url).searchParams,op=params.get('operationId');
  if(!write&&([...params.keys()].some(k=>k!=='operationId')||params.getAll('operationId').length>1||(op!==null&&!UUID.test(op))))return fail(400,'INVALID_TAKEAWAY','Mã đối soát không hợp lệ.');
  const input=write?parseTakeawayRequest(await readJson(req,32768)):null;
  if(write&&!input)return fail(400,'INVALID_TAKEAWAY','Kiểm tra người nhận, số điện thoại và món đã chọn.');
  const identity=write?takeawayRequestIdentity(req):null;
  const db=createSupabaseServiceRoleClient();
  if(identity){const gate=await claimTakeawayRequest(db,identity);if(!gate.allowed){const response=fail(429,'TAKEAWAY_REQUEST_RATE_LIMIT','Bạn đang gửi quá nhiều lượt. Vui lòng chờ rồi kiểm tra lượt vừa gửi hoặc gọi quán.');response.headers.set('Retry-After',String(gate.retryAfter));return response;}}
  const {data,error}=write?await db.rpc('fn_create_takeaway',{p_token:token,p_operation_id:input!.operationId,p_command:{...input!.command,lines:input!.command.lines.map(line=>({...line}))}}):op?await db.rpc('fn_get_takeaway_create',{p_token:token,p_operation_id:op.toLowerCase()}):await db.rpc('fn_get_takeaway_snapshot',{p_token:token});
  if(error){const map:Record<string,[number,string,string]>={P0002:[404,'ORDER_NOT_FOUND','Không tìm thấy đơn trên mã truy cập này.'],P1504:[429,'TAKEAWAY_RATE_LIMIT','Quán đang giới hạn nhận đơn. Vui lòng chờ hoặc gọi quán.'],P1002:[409,'MENU_UNAVAILABLE','Có món vừa hết. Xem lại giỏ trước khi gửi.'],P1003:[409,'PRICE_CHANGED','Giá món đã đổi. Tải lại thực đơn và xác nhận lại giỏ.'],P1005:[409,'MAPPING_INVALID','Quán cần kiểm tra món này. Vui lòng liên hệ quán.'],'22023':[400,'INVALID_TAKEAWAY','Thông tin đơn không hợp lệ.'],'22000':[409,'OPERATION_CONFLICT','Mã tạo đơn đã được sử dụng. Hãy kiểm tra đơn trước.']};return fail(...(map[error.code]??[503,'TAKEAWAY_UNAVAILABLE','Chưa xác nhận được kết quả. Kiểm tra lượt vừa gửi trước khi đặt lại.']));}
  if(!write&&op&&data===null)return NextResponse.json({data:null},{headers:{'Cache-Control':'no-store'}});
  const parsed=(write||op)?parseTakeawayCreated(data):parseTakeawaySnapshot(data);
  if(!parsed||((write||op)&&'operationId' in parsed&&parsed.operationId!==(input?.operationId??op?.toLowerCase())))return fail(503,'TAKEAWAY_UNAVAILABLE','Chưa đọc được kết quả đơn. Vui lòng kiểm tra lại.');
  return NextResponse.json({data:parsed},{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }catch(error){if(error instanceof RequestBodyError)return fail(error.status,'INVALID_REQUEST_BODY',error.message);return fail(503,'TAKEAWAY_UNAVAILABLE','Chưa xác nhận được kết quả. Kiểm tra lượt vừa gửi trước khi đặt lại.');}
}
export function GET(req:Request){return handle(req,false);}
export function POST(req:Request){return handle(req,true);}
