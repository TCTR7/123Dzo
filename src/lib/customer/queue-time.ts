export function effectiveQueueTime(item:{created_at:string},session:{session_type:string;activated_at?:string|null}|undefined):number|null {
 if(!session)return null;
 const created=Date.parse(item.created_at);
 if(!Number.isFinite(created))return null;
 if(session.session_type==='DINE_IN')return created;
 const activated=session.activated_at?Date.parse(session.activated_at):NaN;
 return Number.isFinite(activated)?Math.max(created,activated):null;
}
