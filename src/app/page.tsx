import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getCurrentStaffProfile, OperatorRoleConstraintError } from '@/lib/auth/roles';
import { roleDestination } from '@/lib/auth/navigation';
export default async function Home({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  if (!(await auth()).userId) redirect('/customer/takeaway');
  let profile;
  try { profile = await getCurrentStaffProfile(); }
  catch (error) { redirect('/access-denied?reason=' + (error instanceof OperatorRoleConstraintError ? 'operator-role-constraint' : 'profile-setup')); }
  if (!profile?.is_active) redirect('/access-denied');
  redirect(roleDestination(profile.role, (await searchParams).returnTo));
}
