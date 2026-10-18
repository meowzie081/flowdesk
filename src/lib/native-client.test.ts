import { describe, it, expect, vi, afterEach } from 'vitest';
import { telegramBackTarget, safeInset, nativeClient } from './native-client';
afterEach(() => vi.unstubAllGlobals());
describe('native client presentation', () => {
    it('maps Telegram back button to a safe local parent', () => { expect(telegramBackTarget('/')).toBeNull(); expect(telegramBackTarget('/telegram')).toBeNull(); expect(telegramBackTarget('/login')).toBe('/telegram'); expect(telegramBackTarget('/d/department/board')).toBe('/d/department/my-day'); expect(telegramBackTarget('/d/department/my-day')).toBe('/'); expect(telegramBackTarget('//evil.example')).toBe('/'); });
    it('clamps invalid SDK insets', () => { expect(safeInset(24)).toBe(24); expect(safeInset(-1)).toBe(0); expect(safeInset(Infinity)).toBe(0); expect(safeInset(NaN)).toBe(0); expect(safeInset('20')).toBe(0); expect(safeInset(900)).toBe(200); });
    it('detects desktop UI and handles blocked browser storage', () => { vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { userAgent: 'Browser FlowDeskDesktop/0.2.0' }); expect(nativeClient()).toBe('desktop'); vi.stubGlobal('navigator', { userAgent: 'Browser' }); vi.stubGlobal('sessionStorage', { getItem: () => { throw Error('blocked'); } }); expect(nativeClient()).toBeNull(); vi.stubGlobal('sessionStorage', { getItem: () => '1' }); expect(nativeClient()).toBe('telegram'); });
});
