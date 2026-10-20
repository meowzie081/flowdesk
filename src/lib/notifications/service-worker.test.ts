import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe, it, expect, vi} from 'vitest';

describe('Web Push service worker', () => {
  it('never displays private payload content or follows caller-supplied external links', async () => {
    const handlers: Record<string, any> = {}, show = vi.fn(), open = vi.fn();
    const self = {addEventListener: (type: string, cb: any) => {handlers[type] = cb;}, registration: {showNotification: show}, location: {origin: 'https://flowdesk.example'}, clients: {matchAll: async () => [], openWindow: open}};
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {self, URL});
    let pending: Promise<unknown> | undefined;
    handlers.push({data: {json: () => ({title: 'Private task', body: 'Secret message', url: 'https://evil.test', tag: 'notice'})}, waitUntil: (p: Promise<unknown>) => {pending = p;}});
    await pending;
    expect(show.mock.calls[0][0]).toBe('FlowDesk'); expect(JSON.stringify(show.mock.calls)).not.toContain('Secret message');
    handlers.notificationclick({notification: {close: vi.fn(), data: {url: 'https://evil.test'}}, waitUntil: (p: Promise<unknown>) => {pending = p;}});
    await pending; expect(open).toHaveBeenCalledWith('/');
  });
});
