// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({client:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {requiredSetting,supabaseUrl} from '@/lib/config/public';
import {cronSecret,pushSettings} from '@/lib/config/server';
import {GET} from '@/app/api/cron/keep-alive/route';
const secret='unit-only-cron-credential-at-least-32';
describe('Runtime settings and private cron',()=>{
  let tick=0;
  beforeEach(()=>{vi.resetAllMocks();vi.spyOn(Date,'now').mockReturnValue(1800000000000+(++tick)*61000);vi.stubEnv('CRON_SECRET',secret);mocks.limit.mockResolvedValue({data:[],error:null});mocks.client.mockReturnValue({from:()=>({select:()=>({limit:mocks.limit})})});});
  afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
  it('normalizes valid URLs and permits local HTTP only',()=>{expect(supabaseUrl('https://project.supabase.co/rest/v1/')).toBe('https://project.supabase.co');expect(supabaseUrl('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');});
  it.each(['https://user:secret@project.test','http://remote.test','https://project.test/?secret=one','https://project.test/#private','https://project.test/wrong','not-url','https://your-project-id.supabase.co'])('rejects invalid URL without exposing its value',value=>{expect(()=>supabaseUrl(value)).toThrow('Invalid NEXT_PUBLIC_SUPABASE_URL');});
  it('rejects blank/placeholder keys and missing push subject rather than using a fake identity',()=>{
    expect(()=>requiredSetting('KEY',' ')).toThrow('Missing KEY');expect(()=>requiredSetting('KEY','your_service_key')).toThrow('Invalid KEY');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY','unit-public');vi.stubEnv('VAPID_PRIVATE_KEY','unit-private');vi.stubEnv('VAPID_SUBJECT',undefined);expect(()=>pushSettings()).toThrow('Missing VAPID_SUBJECT');
  });
  it('refuses missing/short cron config before DB',async()=>{
    vi.stubEnv('CRON_SECRET',undefined);expect((await GET(new Request('http://app/api/cron/keep-alive'))).status).toBe(503);
    vi.stubEnv('CRON_SECRET','short');expect(()=>cronSecret()).toThrow();expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(['','Bearer invalid','Bearer '+secret.slice(0,-1)+'X'])('rejects missing/incorrect cron authorization',async(value)=>{expect((await GET(new Request('http://app/api/cron/keep-alive',{headers:{authorization:value}}))).status).toBe(401);expect(mocks.client).not.toHaveBeenCalled();});
  it('pings at most one row without exposing shop counts or SQL failures',async()=>{
    const req=()=>new Request('http://app/api/cron/keep-alive',{headers:{authorization:`Bearer ${secret}`}});
    const result=await GET(req());expect(await result.json()).toMatchObject({status:'alive'});expect(mocks.limit).toHaveBeenCalledWith(1);
    const repeated=await GET(req());expect(repeated.status).toBe(429);expect(mocks.limit).toHaveBeenCalledOnce();
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+61000);mocks.limit.mockResolvedValue({error:{message:'private key or SQL'}});const failed=await GET(req());expect(failed.status).toBe(503);expect(JSON.stringify(await failed.json())).not.toContain('private key');
  });
});
