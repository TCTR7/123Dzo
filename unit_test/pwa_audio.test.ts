import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundControls } from '@/components/ui/SoundControls';
import { disposeSound, enableSound, muteSound, playEnabledSound, soundStatus } from '@/lib/audio/notifications';
import { useSnapshotSound } from '@/lib/data/use-snapshot-sound';
describe('User-activated notification audio', () => {
  let root: Root, host: HTMLDivElement;
  const play = vi.fn(), pause = vi.fn(), constructor = vi.fn();
  beforeEach(() => {
    disposeSound(); vi.clearAllMocks(); play.mockReset().mockResolvedValue(undefined);
    constructor.mockImplementation(function AudioMock() { return { play, pause, load: vi.fn(), removeAttribute: vi.fn(), currentTime: 0 }; });
    vi.stubGlobal('Audio', constructor); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); disposeSound(); host.remove(); vi.unstubAllGlobals(); });
  function Snapshot({ ids }: { ids: string[] }) { useSnapshotSound(ids); return createElement(SoundControls); }
  it('is silent before opt-in; a click unlocks reusable audio for subsequent events', async () => {
    await act(async () => root.render(createElement(Snapshot, { ids: ['old'] })));
    await act(async () => root.render(createElement(Snapshot, { ids: ['old', 'new'] })));
    expect(play).not.toHaveBeenCalled(); expect(soundStatus()).toBe('OFF');
    await act(async () => host.querySelector('button')!.click()); expect(soundStatus()).toBe('ON'); expect(play).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement(Snapshot, { ids: ['old', 'new', 'newer'] })));
    expect(play).toHaveBeenCalledTimes(2); expect(constructor).toHaveBeenCalledOnce();
  });
  it('does not sound for duplicated/reordered IDs and mute stops playback', async () => {
    await enableSound(); await act(async () => root.render(createElement(Snapshot, { ids: ['a', 'b'] })));
    await act(async () => root.render(createElement(Snapshot, { ids: ['b', 'a'] })));
    expect(play).toHaveBeenCalledOnce();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Tắt âm thanh')!.click());
    await act(async () => root.render(createElement(Snapshot, { ids: ['b', 'a', 'c'] })));
    expect(soundStatus()).toBe('OFF'); expect(pause).toHaveBeenCalled(); expect(play).toHaveBeenCalledOnce();
  });
  it('shows denied autoplay honestly and allows explicit retry', async () => {
    play.mockRejectedValueOnce(new Error('NotAllowedError'));
    await act(async () => root.render(createElement(SoundControls)));
    await act(async () => host.querySelector('button')!.click());
    expect(soundStatus()).toBe('BLOCKED'); expect(host.textContent).toContain('chưa cho phát');
    await act(async () => host.querySelector('button')!.click()); expect(soundStatus()).toBe('ON');
  });
  it('locks a double click while audio playback is being accepted', async () => {
    let resolve!: () => void; play.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    await act(async () => root.render(createElement(SoundControls)));
    act(() => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
    expect(play).toHaveBeenCalledOnce(); await act(async () => resolve());
  });
  it('late playback after mute cannot re-enable the sound state', async () => {
    let resolve!: () => void; play.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    const pending = enableSound(); muteSound(); resolve(); expect(await pending).toBe(false); expect(soundStatus()).toBe('OFF');
  });
  it('unexpected playback failure blocks further automatic attempts', async () => {
    await enableSound(); play.mockRejectedValueOnce(new Error('blocked')); await playEnabledSound(); await playEnabledSound(); expect(soundStatus()).toBe('BLOCKED'); expect(play).toHaveBeenCalledTimes(2);
  });
});
