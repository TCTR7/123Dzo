import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
import {NotificationJobs} from '@/components/admin/NotificationJobs';
const id='40000000-0000-4000-8000-000000000001';
const status={pending:0,failed:1,jobs:[{id,kind:'ORDER_READY',attempts:8,available_at:'2026-10-22T00:00:00Z',locked_until:null,failed_at:'2026-10-22T00:00:00Z',outcome:'FAILED',last_error:'PUSH_TRANSIENT'}]};
describe('Notification retry UI',()=>{
  let root:Root,host:HTMLDivElement;const fetchMock=vi.fn();
  beforeEach(async()=>{vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(NotificationJobs,{status})));});
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
  function retry(){return [...host.querySelectorAll('button')].find(button=>button.textContent==='Thử gửi lại')!;}
  it('locks a double click and submits only job ID plus expected attempts',async()=>{
    let resolve!:(value:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>(done=>{resolve=done;}));
    act(()=>{retry().click();retry().click();});expect(fetchMock).toHaveBeenCalledOnce();expect(retry().disabled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({id,expectedAttempts:8});
    await act(async()=>resolve(new Response('{}')));expect(host.textContent).toContain('Đã đưa thông báo về hàng chờ');expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('refreshes state and explains an unconfirmed retry without claiming success',async()=>{
    fetchMock.mockRejectedValue(new Error('lost-response'));await act(async()=>retry().click());expect(host.textContent).toContain('Chưa xác nhận được thao tác');expect(host.textContent).not.toContain('Đã đưa thông báo');expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('does not offer retry for a live pending job',async()=>{
    await act(async()=>root.render(createElement(NotificationJobs,{status:{pending:1,failed:0,jobs:[{...status.jobs[0],attempts:1,failed_at:null,outcome:null}]}})));
    expect(retry()).toBeUndefined();expect(fetchMock).not.toHaveBeenCalled();
  });
});
