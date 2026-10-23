import {customerStoreConfig} from '@/lib/customer/customer-config';
import {takeawayRequestGateConfigured} from './request-limit';
export function takeawaySettings(){
 const store=customerStoreConfig(),bankId=process.env.NEXT_PUBLIC_VIETQR_BANK_ID?.trim()??'',accountNo=process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO?.trim()??'',accountName=process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME?.trim()??'';
 const ready=process.env.NEXT_PUBLIC_BANK_INFO_VERIFIED==='true'&&bankId==='970407'&&/^\d{6,19}$/.test(accountNo)&&Boolean(accountName)&&accountName.length<=100;
 return {enabled:process.env.NEXT_PUBLIC_MANUAL_TAKEAWAY_ENABLED==='true'&&store.verified&&ready&&takeawayRequestGateConfigured(),bank:ready?{bankId,accountNo,accountName}:null};
}
