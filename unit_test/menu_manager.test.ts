import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operationId, menu, item, result } from './menu_fixtures';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), from: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => ({ from: mocks.from }) }));
import { MenuManager } from '@/components/admin/MenuManager';
describe('Menu admin through production API journal', () => {
  let container: HTMLDivElement, root: Root;
  const fetchMock = vi.fn();
  async function mount() { await act(async () => root.render(createElement(MenuManager, { initialMenuItems: [menu], ingredients: [], currentStaffId: 'user_admin' }))); }
  function button(text: string) {
    const control = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text));
    if (!control) throw new Error(`Missing ${text}`); return control;
  }
  beforeEach(() => {
    vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('double click sends one narrow availability action and refreshes current server state', async () => {
    let resolve!: (value: Response) => void; fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; })); await mount();
    act(() => { button('Đang bán (Bấm để 86)').click(); button('Đang bán (Bấm để 86)').click(); }); expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'AVAILABILITY', id: menu.id, item: { is_available: false }, expected: { is_available: true } });
    await act(async () => resolve(new Response(JSON.stringify({ data: result })))); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('edit submits full expected metadata and never sends actor or snapshot prices', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { ...result, action: 'UPDATE' } }))); await mount();
    await act(async () => (container.querySelector('button[title="Chỉnh sửa món"]') as HTMLButtonElement).click());
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body); expect(body).toEqual({ operationId, action: 'UPDATE', id: menu.id, item, expected: item });
    expect(container.querySelector('form')).toBeNull(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('unknown edit closes modal for recovery and does not generate a second update', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost')); await mount();
    await act(async () => (container.querySelector('button[title="Chỉnh sửa món"]') as HTMLButtonElement).click());
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('form')).toBeNull(); expect(button('Đang bán (Bấm để 86)').disabled).toBe(true);
    expect(localStorage.getItem('123dzo-pending-menu-action:user_admin')).not.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...result, action: 'UPDATE' } })));
    await act(async () => button('Kiểm tra thay đổi thực đơn vừa gửi').click());
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].method).toBeUndefined(); expect(localStorage.getItem('123dzo-pending-menu-action:user_admin')).toBeNull();
  });
  it('shows a history rejection and retains the card rather than deleting locally', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MENU_HISTORY', message: 'Món đã có lịch sử gọi.' } }), { status: 409 })); await mount();
    await act(async () => (container.querySelector('button[title="Xóa món"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Món đã có lịch sử gọi.'); expect(container.textContent).toContain(menu.name);
    expect(localStorage.getItem('123dzo-pending-menu-action:user_admin')).toBeNull(); expect(mocks.from).not.toHaveBeenCalled();
  });
});
