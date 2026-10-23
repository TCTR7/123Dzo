import {NextResponse} from 'next/server';
import {requireStaffApi} from '@/lib/auth/staff-guard';
import {readJson,RequestBodyError} from '@/lib/api/read-json';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/orders/contracts';
import {parseManualPaymentRequest,parseManualPaymentResult,paymentPage} from '@/lib/payments/contracts';
import {readManualPayments} from '@/lib/payments/read';
function fail(status:number,code:string,message:string){return NextResponse.json({error:{code,message,retryable:status>=500}},{status,headers:{'Cache-Control':'no-store'}});}
async function handle(req:Request,write:boolean){
 const access=await requireStaffApi(['staff','admin']);if(access.response)return access.response;
 if(write&&req.headers.get('origin')!==new URL(req.url).origin)return fail(403,'INVALID_ORIGIN','Nguồn yêu cầu không hợp lệ.');
 try{
  const url=new URL(req.url),params=url.searchParams;
  if(!write&&!params.has('operationId')){
   if([...params.keys()].some(k=>!['pendingPage','historyPage'].includes(k)||params.getAll(k).length!==1))return fail(400,'INVALID_PAYMENT','Trang không hợp lệ.');
   const pending=paymentPage(params.get('pendingPage')),history=paymentPage(params.get('historyPage'));if(pending===null||history===null)return fail(400,'INVALID_PAYMENT','Trang không hợp lệ.');
   return NextResponse.json({data:await readManualPayments(access.staff.userId,pending,history)},{headers:{'Cache-Control':'no-store'}});
  }
  const input=write?parseManualPaymentRequest(await readJson(req,4096)):null;
  const operationId=write?input?.operationId:params.get('operationId');
  if(!operationId||!UUID.test(operationId)||(write&&!input)||(!write&&([...params.keys()].some(k=>k!=='operationId')||params.getAll('operationId').length!==1)))return fail(400,'INVALID_PAYMENT','Kiểm tra số tiền, phương thức và mã giao dịch.');
  const db=createSupabaseServiceRoleClient(),args={p_actor_id:access.staff.userId,p_operation_id:operationId.toLowerCase()};
  const {data,error}=write?await db.rpc('fn_confirm_manual_payment',{...args,p_command:{...input!.command}}):await db.rpc('fn_get_manual_payment_operation',args);
  if(error){
   const map:Record<string,[number,string,string]>={
    '42501':[403,'FORBIDDEN','Quyền xác nhận tiền đã thay đổi.'],P0002:[404,'PAYMENT_NOT_FOUND','Không tìm thấy đơn mang về.'],
    P1501:[409,'PAYMENT_HANDLED','Đơn đã được xử lý. Tải lại và kiểm tra lịch sử xác nhận.'],
    P1503:[409,'PAYMENT_NEEDS_REVIEW','Món hoặc cấu hình đã thay đổi. Nhờ quản lý đối soát, không chuyển thêm tiền.'],
    P1306:[409,'PAYMENT_AMOUNT_CHANGED','Số tiền không khớp bill hiện tại. Tải lại và đối chiếu tiền thực nhận.'],
    P1004:[409,'OUT_OF_STOCK','Chưa đủ hàng để nhận đơn. Nhờ quản lý xử lý với khách trước khi xác nhận lại.'],
    '23505':[409,'PAYMENT_DUPLICATE','Đơn hoặc mã giao dịch này đã được xác nhận. Kiểm tra lịch sử trước khi tiếp tục.'],
    '22023':[400,'INVALID_PAYMENT','Thông tin xác nhận không hợp lệ.'],'22000':[409,'OPERATION_CONFLICT','Mã thao tác đã dùng cho nội dung khác. Hãy đối soát lượt trước.']};
   return fail(...(map[error.code]??[503,'PAYMENT_UNAVAILABLE','Chưa xác nhận kết quả. Kiểm tra thao tác vừa gửi.']));
  }
  if(!write&&data===null)return NextResponse.json({data:null},{headers:{'Cache-Control':'no-store'}});
  const result=parseManualPaymentResult(data);
  if(!result||result.operationId!==operationId.toLowerCase()||result.confirmedBy!==access.staff.userId||(input&&(result.sessionId!==input.command.sessionId||result.amount!==input.command.expectedTotal||result.paymentMethod!==input.command.paymentMethod||result.reference!==input.command.reference)))return fail(503,'PAYMENT_UNAVAILABLE','Chưa xác nhận được kết quả thu tiền.');
  return NextResponse.json({data:result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){if(error instanceof RequestBodyError)return fail(error.status,'INVALID_REQUEST_BODY',error.message);return fail(503,'PAYMENT_UNAVAILABLE','Chưa tải được kết quả thu tiền. Vui lòng kiểm tra lại.');}
}
export function GET(req:Request){return handle(req,false);}
export function POST(req:Request){return handle(req,true);}
