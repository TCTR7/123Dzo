import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { canManageRole, getCurrentStaffProfile, getHomeByRole, isConfiguredOperator, isManager, isStaffRole } from '@/lib/auth/roles';
import { normalizePhoneUsername, PHONE_USERNAME_ERROR } from '@/lib/auth/phone-username';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
export async function POST(req: Request) {
  try {
    const actor=await getCurrentStaffProfile();
    if(!actor?.is_active || !isManager(actor.role)) return NextResponse.json({error:'Không có quyền tạo tài khoản.'},{status:403});
    if(req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Yêu cầu không hợp lệ.'},{status:403});
    const body: unknown=await req.json().catch(()=>null);
    if(!body || typeof body!=='object')return NextResponse.json({error:'Thông tin không hợp lệ.'},{status:400});
    const v=body as Record<string,unknown>, role=v.role;
    const fullName=typeof v.fullName==='string'?v.fullName.trim():'', password=typeof v.password==='string'?v.password:'';
    const username=normalizePhoneUsername(typeof v.phoneNumber==='string'?v.phoneNumber:typeof v.username==='string'?v.username:'');
    if(!username || !fullName || fullName.length>200 || password.length<8 || password.length>128 || !isStaffRole(role))return NextResponse.json({error:PHONE_USERNAME_ERROR+' Điền họ tên, mật khẩu 8–128 ký tự và công việc.'},{status:400});
    if(!canManageRole(actor.role,role))return NextResponse.json({error:'Chỉ người bàn giao được tạo tài khoản chủ quán.'},{status:403});
    const db=createSupabaseServiceRoleClient(),client=await clerkClient();
    const matches=await client.users.getUserList({username:[username],limit:2});
    if(matches.data.length>1)return NextResponse.json({error:'Tài khoản bị trùng. Hãy liên hệ người bàn giao.'},{status:409});
    let user=matches.data[0],created=false;
    if(user){
      const existing=await db.from('staff_profiles').select('role').eq('id',user.id).maybeSingle();
      if(existing.error)throw Error('Chưa kiểm tra được tài khoản.');
      if(user.id===actor.id || isConfiguredOperator(user) || existing.data && !canManageRole(actor.role,existing.data.role) || !existing.data && actor.role!=='operator')return NextResponse.json({error:'Không có quyền thay đổi tài khoản này.'},{status:403});
      if(user.username!==username)return NextResponse.json({error:'Thông tin đăng nhập không khớp.'},{status:409});
      user=await client.users.updateUser(user.id,{password,firstName:fullName,skipPasswordChecks:true});
    }else{
      user=await client.users.createUser({username,password,firstName:fullName,skipPasswordChecks:true});created=true;
    }
    const r=await db.from('staff_profiles').upsert({id:user.id,full_name:fullName,role,assigned_zone_id:null,is_active:true},{onConflict:'id'}).select('*').single();
    if(r.error || !r.data){if(created)await client.users.deleteUser(user.id).catch(()=>undefined);return NextResponse.json({error:'Chưa lưu được nhân viên. Vui lòng thử lại.'},{status:502});}
    const origin=new URL(process.env.NEXT_PUBLIC_APP_URL || req.url).origin;
    return NextResponse.json({success:true,profile:r.data,credentials:{loginIdentifier:username,password,loginUrl:origin+getHomeByRole(role)}},{headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({error:'Chưa tạo được tài khoản. Kiểm tra số điện thoại, mật khẩu và kết nối rồi thử lại.'},{status:500});
  }
}
