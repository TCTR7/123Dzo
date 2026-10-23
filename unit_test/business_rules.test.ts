import {describe,it,expect} from 'vitest';
import {effectiveQueueTime} from '@/lib/customer/queue-time';
// SQL is the authority for snapshot, inventory and state transitions; those
// scenarios are tested in integration_test. Never copy business logic here.
describe('Production effective queue clock',()=>{
 const item={created_at:'2026-10-22T00:00:00Z'};
 it('requires a known session',()=>expect(effectiveQueueTime(item,undefined)).toBeNull());
 it('uses item time for dine-in',()=>expect(effectiveQueueTime(item,{session_type:'DINE_IN'})).toBe(Date.parse(item.created_at)));
 it('does not guess missing activation evidence',()=>expect(effectiveQueueTime(item,{session_type:'TAKEAWAY'})).toBeNull());
 it('uses later payment activation without rewriting creation',()=>expect(effectiveQueueTime(item,{session_type:'TAKEAWAY',activated_at:'2026-10-22T01:00:00Z'})).toBe(Date.parse('2026-10-22T01:00:00Z')));
 it('never gives a later added item priority before its own creation',()=>expect(effectiveQueueTime(item,{session_type:'TAKEAWAY',activated_at:'2026-10-21T01:00:00Z'})).toBe(Date.parse(item.created_at)));
 it('invalid dates do not produce a fabricated duration',()=>expect(effectiveQueueTime({created_at:'bad'},{session_type:'DINE_IN'})).toBeNull());
});
