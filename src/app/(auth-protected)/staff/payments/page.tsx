import {manualPaymentsPage,type PaymentPageProps} from '@/lib/payments/page';
export const dynamic='force-dynamic';
export default function Page(props:PaymentPageProps){return manualPaymentsPage(props,false);}
