import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export async function GET(){
 const access=await requireStaffApi(['admin']);if(access.response)return access.response;
 const headers={'Cache-Control':'private, no-store'};
 try{const {data,error}=await createSupabaseServiceRoleClient().rpc('fn_admin_data_health',{p_actor_id:access.staff.userId});if(error||!data)throw new Error('HEALTH_UNAVAILABLE');return NextResponse.json({data},{headers});}
 catch{return NextResponse.json({error:'HEALTH_UNAVAILABLE'},{status:503,headers});}
}
