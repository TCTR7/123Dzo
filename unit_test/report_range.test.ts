import { describe,it,expect } from 'vitest';
import { reportRange } from '@/lib/data/report-range';
describe('Vietnam reporting days independent of device timezone',()=>{
 it('uses tomorrow local after 17:00 UTC and exclusive next midnight',()=>{
  expect(reportRange('TODAY',new Date('2026-10-22T18:00:00Z'))).toEqual({start:'2026-10-22T17:00:00.000Z',end:'2026-10-23T17:00:00.000Z'});
 });
 it('uses Monday and month boundaries',()=>{
  expect(reportRange('THIS_WEEK',new Date('2026-10-22T10:00Z'))?.start).toBe('2026-10-18T17:00:00.000Z');
  expect(reportRange('THIS_MONTH',new Date('2026-10-22T10:00Z'))?.start).toBe('2026-09-30T17:00:00.000Z');
 });
 it('includes the whole final selected date including milliseconds',()=>{
  expect(reportRange('CUSTOM',new Date(),'2026-10-22','2026-10-22')).toEqual({start:'2026-10-21T17:00:00.000Z',end:'2026-10-22T17:00:00.000Z'});
 });
 it('rejects impossible/reversed dates rather than normalizing silently',()=>{
  expect(()=>reportRange('CUSTOM',new Date(),'2026-02-30','2026-03-01')).toThrow();
  expect(()=>reportRange('CUSTOM',new Date(),'2026-10-23','2026-10-22')).toThrow();
  expect(reportRange('ALL')).toBeNull();
 });
});
