export type ReportPreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
const DAY=86400000, OFFSET=7*3600000;
function localDay(value:string):number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_DATE');
  const time=Date.parse(value+'T00:00:00+07:00');
  if (!Number.isFinite(time) || new Date(time+OFFSET).toISOString().slice(0,10)!==value) throw new Error('INVALID_DATE');
  return time;
}
export function reportRange(preset:ReportPreset,now=new Date(),start?:string,end?:string) {
  if (preset==='ALL') return null;
  const today=new Date(now.getTime()+OFFSET).toISOString().slice(0,10);
  let from=localDay(today), until=from+DAY;
  if (preset==='CUSTOM') { from=localDay(start??''); until=localDay(end??'')+DAY; }
  if (preset==='THIS_MONTH') from=localDay(today.slice(0,8)+'01');
  if (preset==='THIS_WEEK') from-=((new Date(from+OFFSET).getUTCDay()+6)%7)*DAY;
  if (until<=from) throw new Error('INVALID_RANGE');
  return { start:new Date(from).toISOString(),end:new Date(until).toISOString() };
}
