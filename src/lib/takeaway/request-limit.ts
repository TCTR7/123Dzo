import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/types/database.types';
import {isRecord} from '@/lib/orders/contracts';

function secret(value:string|undefined):string {
 if(!value||Buffer.byteLength(value)<32||Buffer.byteLength(value)>256)throw new Error('Request gate unavailable');
 return value;
}
function limit(value:string|undefined,fallback:number){
 if(value===undefined||value==='')return fallback;
 if(!/^[1-9]\d{0,5}$/.test(value)||Number(value)>100000)throw new Error('Request gate unavailable');
 return Number(value);
}
function network(value:string|null){
 if(!value||value.length>64||value!==value.trim()||value.includes('%'))throw new Error('Request gate unavailable');
 const version=isIP(value);if(version===4)return value;
 if(version!==6)throw new Error('Request gate unavailable');
 // URL canonicalizes IPv6, including dotted IPv4-mapped notation; reject zones.
 const canonical=new URL('http://['+value+']/').hostname.slice(1,-1);
 const sides=canonical.split('::'),left=sides[0]?sides[0].split(':'):[],right=sides.length===2&&sides[1]?sides[1].split(':'):[];
 const words=(sides.length===2?[...left,...Array.from({length:8-left.length-right.length},()=> '0'),...right]:left).map(word=>parseInt(word,16));
 if(words.length!==8||words.some(word=>!Number.isInteger(word)))throw new Error('Request gate unavailable');
 if(words.slice(0,5).every(word=>word===0)&&words[5]===65535)return [words[6]>>8,words[6]&255,words[7]>>8,words[7]&255].join('.');
 return words.slice(0,4).map(word=>word.toString(16)).join(':')+'::/64';
}
export function takeawayRequestIdentity(req:Request){
 const hashSecret=secret(process.env.TAKEAWAY_RATE_LIMIT_SECRET);let ip:string|null;
 if(process.env.TAKEAWAY_REQUEST_SOURCE==='vercel'&&process.env.VERCEL==='1')ip=req.headers.get('x-vercel-forwarded-for');
 else if(process.env.TAKEAWAY_REQUEST_SOURCE==='proxy'){
  const expected=Buffer.from(secret(process.env.TAKEAWAY_PROXY_SECRET)),supplied=Buffer.from(req.headers.get('x-dzo-proxy-secret')??'');
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new Error('Request gate unavailable');
  ip=req.headers.get('x-dzo-client-ip');
 }else throw new Error('Request gate unavailable');
 const fingerprint=createHmac('sha256',hashSecret).update('takeaway:'+new Date().toISOString().slice(0,10)+':'+network(ip)).digest('hex');
 return {p_fingerprint:fingerprint,
  p_network_minute:limit(process.env.TAKEAWAY_RATE_NETWORK_MINUTE,10),p_network_hour:limit(process.env.TAKEAWAY_RATE_NETWORK_HOUR,120),
  p_global_minute:limit(process.env.TAKEAWAY_RATE_GLOBAL_MINUTE,60),p_global_hour:limit(process.env.TAKEAWAY_RATE_GLOBAL_HOUR,600)};
}
export function takeawayRequestGateConfigured(){
 try{
  secret(process.env.TAKEAWAY_RATE_LIMIT_SECRET);
  if(process.env.TAKEAWAY_REQUEST_SOURCE==='proxy')secret(process.env.TAKEAWAY_PROXY_SECRET);
  else if(process.env.TAKEAWAY_REQUEST_SOURCE!=='vercel'||process.env.VERCEL!=='1')return false;
  limit(process.env.TAKEAWAY_RATE_NETWORK_MINUTE,10);limit(process.env.TAKEAWAY_RATE_NETWORK_HOUR,120);
  limit(process.env.TAKEAWAY_RATE_GLOBAL_MINUTE,60);limit(process.env.TAKEAWAY_RATE_GLOBAL_HOUR,600);return true;
 }catch{return false;}
}
export async function claimTakeawayRequest(db:SupabaseClient<Database>,identity:ReturnType<typeof takeawayRequestIdentity>){
 const {data,error}=await db.rpc('fn_takeaway_request_gate',identity);
 if(error||!isRecord(data)||typeof data.allowed!=='boolean'||typeof data.retryAfter!=='number'||!Number.isInteger(data.retryAfter)||data.retryAfter<0||data.retryAfter>3600||(data.allowed?data.retryAfter!==0:data.retryAfter===0))throw new Error('Request gate unavailable');
 return {allowed:data.allowed,retryAfter:data.retryAfter};
}
