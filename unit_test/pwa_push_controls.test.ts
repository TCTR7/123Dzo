import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ enable: vi.fn(), disable: vi.fn(), supports: vi.fn() }));
vi.mock('@/lib/pwa/push-device', () => ({ enableDevicePush: mocks.enable, disableDevicePush: mocks.disable, supportsDevicePush: mocks.supports }));
import { PushControls } from '@/components/ui/PushControls';
describe('Staff push controls', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(async () => { vi.resetAllMocks(); mocks.supports.mockReturnValue(true); mocks.enable.mockResolvedValue(undefined); mocks.disable.mockResolvedValue(true); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(createElement(PushControls, { userId: 'user_staff' }))); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const button = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text))!;
  it('never requests permission on mount and locks double click until confirmation', async () => {
    expect(mocks.enable).not.toHaveBeenCalled(); let resolve!: () => void;
    mocks.enable.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    act(() => { button('Bật /').click(); button('Bật /').click(); }); expect(mocks.enable).toHaveBeenCalledOnce(); expect(button('Tắt').disabled).toBe(true);
    expect(host.textContent).not.toContain('Quán đã xác nhận'); await act(async () => resolve()); expect(host.textContent).toContain('Quán đã xác nhận');
  });
  it('explains permission denial without pretending enabled', async () => {
    mocks.enable.mockRejectedValue(new Error('Chưa được cấp quyền.')); await act(async () => button('Bật /').click()); expect(host.textContent).toContain('Chưa được cấp quyền'); expect(host.textContent).not.toContain('Quán đã xác nhận'); expect(button('Bật /').disabled).toBe(false);
  });
  it('keeps uncertain server cleanup visible and permits explicit retry', async () => {
    mocks.disable.mockResolvedValueOnce(false); await act(async () => button('Tắt').click()); expect(host.textContent).toContain('chưa xác nhận gỡ');
    await act(async () => button('Tắt').click()); expect(mocks.disable).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Đã tắt thông báo');
  });
  it('describes unsupported devices and single-device replacement', async () => {
    mocks.supports.mockReturnValue(false); await act(async () => root.render(createElement(PushControls, { key: 'unsupported', userId: 'user_staff' })));
    expect(button('Bật /').disabled).toBe(true); expect(host.textContent).toContain('Màn hình chính'); expect(host.textContent).toContain('thay máy nhận trước đó'); expect(mocks.enable).not.toHaveBeenCalled();
  });
});
