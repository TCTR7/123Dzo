import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingredientId, journal, operationId, result } from './inventory_fixtures';
import type { IngredientRow } from '@/types/database.types';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), from: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => ({ from: mocks.from }) }));
import { InventoryManager } from '@/components/admin/InventoryManager';
const ingredient: IngredientRow = { id: ingredientId, name: 'Bia kiểm thử', unit: 'lon', stock_quantity: 10, unit_cost: 12, min_threshold: 2 };
const key = '123dzo-pending-inventory:user_admin';

describe('Inventory UI confirmation and recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();
  async function mount() {
    await act(async () => root.render(createElement(InventoryManager, {
      initialIngredients: [ingredient], initialLogs: [], staffProfiles: [], currentStaffId: 'user_admin',
    })));
  }
  function button(text: string) {
    const found = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
    if (!found) throw new Error(`Missing control: ${text}`);
    return found;
  }
  function submit() { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  beforeEach(() => {
    fetchMock.mockReset(); mocks.from.mockReset(); mocks.refresh.mockReset();
    vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('prevents a double submit and refreshes current stock only after confirmation', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    await mount();
    act(() => button('Nhập kho / Hủy hỏng').click());
    expect(container.querySelector('form')?.checkValidity()).toBe(true);
    act(() => { submit(); submit(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    await act(async () => resolve(new Response(JSON.stringify({ data: result }))));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
    expect(container.textContent).toContain('Đã ghi phiếu kho +1');
    // Confirmation returns no stale stock row; SSR refresh supplies the current value.
    expect(container.textContent).not.toContain('11 lon');
  });
  it('keeps pending journal and provides an accessible recovery button after network loss', async () => {
    fetchMock.mockRejectedValue(new Error('lost response'));
    await mount(); act(() => button('Nhập kho / Hủy hỏng').click());
    await act(async () => submit());
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Chưa xác nhận');
    expect(button('Nhập kho / Hủy hỏng').disabled).toBe(true);
    expect(button('Kiểm tra phiếu vừa gửi').disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(journal);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('restores after reload, looks up first, and never writes browser stock/logs', async () => {
    localStorage.setItem(key, JSON.stringify(journal));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: result })));
    await mount(); await act(async () => button('Kiểm tra phiếu vừa gửi').click());
    expect(fetchMock.mock.calls[0][0]).toContain('?operationId=');
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('does not offer manual sale/beer returns or a stock override', async () => {
    await mount(); act(() => button('Nhập kho / Hủy hỏng').click());
    const form = container.querySelector('form')!;
    expect(form.textContent).not.toContain('Xuất bán');
    expect(form.textContent).not.toContain('Khách trả bia');
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Đóng phiếu kho"]')!.click());
    await act(async () => root.render(createElement(InventoryManager, {
      key: 'metadata', initialIngredients: [ingredient], initialLogs: [], staffProfiles: [], currentStaffId: 'user_admin',
    })));
    act(() => button('Thêm nguyên liệu mới').click());
    expect(container.querySelector('form')?.textContent).not.toContain('Số lượng tồn ban đầu');
    const cost = container.querySelector<HTMLInputElement>('input[value="0"]');
    expect(cost?.disabled).toBe(true);
    expect(container.textContent).toContain('Nguyên liệu mới có tồn và giá vốn bằng 0');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('blocks new actions if journal is corrupt, without silently discarding it', async () => {
    localStorage.setItem(key, '{'); await mount();
    expect(button('Nhập kho / Hủy hỏng').disabled).toBe(true);
    expect(button('Thêm nguyên liệu mới').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không đọc được');
    expect(localStorage.getItem(key)).toBe('{');
  });
});
