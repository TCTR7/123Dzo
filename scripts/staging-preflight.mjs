// Read-only network acceptance preparation. Never loads .env or uses service keys.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
function origin(value){
 const url=new URL(value);if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||
  (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('INVALID_CONFIG');return url.origin;
}
function anonKey(value){
 if(typeof value!=='string'||value.length>4096||value.split('.').length!==3)throw new Error('INVALID_CONFIG');
 const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString());
 if(claims.role!=='anon'||typeof claims.exp!=='number'||claims.exp<=Date.now()/1000)throw new Error('INVALID_CONFIG');return value;
}
export async function runPreflight(env,fetcher=fetch){
 const report={kind:'read-only staging preflight',checkedAt:new Date().toISOString(),outcome:'NOT_RUN',releaseApproved:false,checks:[],missing:[]};
 for(const key of ['E2E_BASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'])if(!env[key])report.missing.push(key);
 if(env.STAGING_PREFLIGHT_CONFIRMED_ISOLATED!=='true')report.missing.push('STAGING_PREFLIGHT_CONFIRMED_ISOLATED');
 if(report.missing.length)return report;
 let app,database,key;
 try{app=origin(env.E2E_BASE_URL);database=origin(env.NEXT_PUBLIC_SUPABASE_URL);key=anonKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);}catch{report.checks.push({id:'configuration',outcome:'FAIL',code:'INVALID_OR_UNSUPPORTED_PUBLIC_CONFIG'});report.outcome='FAIL';return report;}
 const authHeaders={apikey:key,authorization:'Bearer '+key};
 async function probe(id,url,init,accept){
  try{const response=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(5000)});const status=response.status,ok=accept(response);await response.body?.cancel();const result={id,outcome:ok?'PASS':'FAIL',status};report.checks.push(result);return ok;}
  catch{report.checks.push({id,outcome:'FAIL',code:'NETWORK_OR_TIMEOUT'});return false;}
 }
 // A bogus/expired key yielding 401 everywhere must never prove safe permissions.
 if(!await probe('public-key-positive-control',database+'/auth/v1/settings',{headers:authHeaders},r=>r.status===200)){report.outcome='FAIL';return report;}
 const denied=r=>[401,403].includes(r.status);
 const tables=['zones','tables','staff_profiles','ingredients','inventory_logs','menu_items','table_sessions','order_items'];
 const views=['vw_kpi_financial_summary','vw_kpi_peak_hours','vw_kpi_menu_analytics','vw_kpi_kitchen_performance','vw_kpi_waitstaff_performance'];
 const tasks=[
  ...[...tables,...views].map(table=>()=>probe('public-read:'+table,database+'/rest/v1/'+table+'?select=*&limit=0',{headers:authHeaders},denied)),
  ()=>probe('public-rpc:admin-health',database+'/rest/v1/rpc/fn_admin_data_health',{method:'POST',headers:{...authHeaders,'content-type':'application/json'},body:JSON.stringify({p_actor_id:'preflight-no-actor'})},denied),
  ...['/admin','/staff','/kitchen','/admin/payments'].map(path=>()=>probe('anonymous-page:'+path,app+path,{},r=>{
   if(![302,303,307,308].includes(r.status))return false;try{const location=new URL(r.headers.get('location')??'',app);return location.origin===app&&/^\/sign-in(?:\/|$)/.test(location.pathname);}catch{return false;}
  })),
  ...['/api/admin/data-health','/api/staff/payments','/api/staff/takeaway'].map(path=>()=>probe('anonymous-api:'+path,app+path,{},r=>r.status===401)),
  ()=>probe('invalid-capability',app+'/api/customer/takeaway',{},r=>r.status===403&&Boolean(r.headers.get('cache-control')?.includes('no-store'))),
 ];
 // Three requests at a time, bounded per-request time; never follow key redirects.
 let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<tasks.length){const task=tasks[next++];await task();}}));
 report.checks.sort((a,b)=>a.id.localeCompare(b.id));report.outcome=report.checks.every(check=>check.outcome==='PASS')?'PASS':'FAIL';return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 let report;try{report=await runPreflight(process.env);}catch{report={kind:'read-only staging preflight',outcome:'FAIL',releaseApproved:false,checks:[{id:'runner',outcome:'FAIL',code:'PREFLIGHT_INTERNAL_ERROR'}]};}
 const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../.temp');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'staging-preflight.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));process.exitCode=report.outcome==='PASS'?0:report.outcome==='NOT_RUN'?2:1;
}
