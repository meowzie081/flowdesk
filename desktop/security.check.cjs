const { test } = require('node:test'), assert = require('node:assert/strict');
const { applicationUrl, internalUrl, externalUrl, windowBounds } = require('./security.cjs');
test('packaged builds allow HTTPS origins only', () => { assert.equal(applicationUrl('https://flowdesk.example').origin, 'https://flowdesk.example'); for (const value of ['http://flowdesk.example', 'http://localhost:3000', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@flowdesk.example', 'https://flowdesk.example/login', 'https://flowdesk.example?secret=x', 'https://flowdesk.example/#x'])
    assert.throws(() => applicationUrl(value)); });
test('local HTTP is limited to development loopback', () => { for (const value of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])
    assert.equal(applicationUrl(value, false).protocol, 'http:'); for (const value of ['http://localhost.evil.example', 'http://192.168.1.2:3000'])
    assert.throws(() => applicationUrl(value, false)); });
test('internal navigation checks origin, protocol and credentials', () => { const base = applicationUrl('https://flowdesk.example'); assert(internalUrl('https://flowdesk.example/d/dep/my-day', base)); for (const value of ['https://flowdesk.example.evil.test', 'https://flowdesk.example@evil.test', 'https://evil.test/?next=https://flowdesk.example', 'http://flowdesk.example', 'https://flowdesk.example:444', 'file:///tmp/a', 'data:text/html,hello', 'https://x:y@flowdesk.example'])
    assert.equal(internalUrl(value, base), false); });
test('external browser accepts credential-free HTTPS only', () => { assert.equal(externalUrl('https://example.com/file.pdf'), 'https://example.com/file.pdf'); for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'smb://server', 'mailto:test@example.com', 'http://example.com', 'https://user:pass@example.com'])
    assert.equal(externalUrl(value), null); });
test('window recovers from removed monitors and stays usable', () => { const areas = [{ x: 0, y: 0, width: 1440, height: 900 }]; assert.deepEqual(windowBounds({ x: 5000, y: 100, width: 300, height: 200 }, areas), { width: 780, height: 600 }); assert.deepEqual(windowBounds({ x: 100, y: 100, width: 1200, height: 800 }, areas), { x: 100, y: 100, width: 1200, height: 800 }); });
