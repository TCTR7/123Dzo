import 'server-only';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { parseDineInSnapshot } from './read-contracts';

export class SnapshotUnavailable extends Error {}
export async function readDineInSnapshot(token: string) {
  if (!token || token.length > 256 || /\s/.test(token)) return null;
  const { data, error } = await createSupabaseServiceRoleClient().rpc('fn_get_dine_in_snapshot', { p_token: token });
  if (error) {
    if (error.code === 'P0002') return null;
    throw new SnapshotUnavailable('SNAPSHOT_UNAVAILABLE');
  }
  const snapshot = parseDineInSnapshot(data, token);
  if (!snapshot) throw new SnapshotUnavailable('SNAPSHOT_UNAVAILABLE');
  return snapshot;
}
