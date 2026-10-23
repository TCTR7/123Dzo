import 'server-only';
import {requireStaffPage} from '@/lib/auth/staff-guard';
import {readManualPayments} from './read';
import {paymentPage} from './contracts';
import {ManualPayments} from '@/components/staff/ManualPayments';
import {TakeawayPickups} from '@/components/staff/TakeawayPickups';
export type PaymentPageProps={searchParams?:Promise<Record<string,string|string[]|undefined>>};
export async function manualPaymentsPage(props:PaymentPageProps,admin:boolean){
 const actor=await requireStaffPage(admin?['admin']:['staff','admin']);
 const params=await props.searchParams??{};
 if(Array.isArray(params.pendingPage)||Array.isArray(params.historyPage))throw new Error('Trang thu tiền không hợp lệ.');
 const pending=paymentPage(params.pendingPage),history=paymentPage(params.historyPage);
 if(pending===null||history===null)throw new Error('Trang thu tiền không hợp lệ.');
 const status=await readManualPayments(actor.userId,pending,history);
 return <><ManualPayments status={status} actorId={actor.userId} path={admin?'/admin/payments':'/staff/payments'} pendingPage={pending} historyPage={history}/><TakeawayPickups actorId={actor.userId}/></>;
}
