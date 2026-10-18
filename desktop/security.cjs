'use strict';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
function applicationUrl(value, packaged = true) { const url = new URL(value); if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw Error('Укажите адрес приложения без пути, параметров и пароля'); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !packaged && LOOPBACK.has(url.hostname)))
    throw Error('Нужен HTTPS. HTTP разрешён только для локальной разработки'); return url; }
function internalUrl(value, base) { try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === base.origin && url.protocol === base.protocol;
}
catch {
    return false;
} }
function externalUrl(value) { try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
}
catch {
    return null;
} }
function windowBounds(value, workAreas) { const width = Math.max(780, Math.min(1920, Number(value?.width) || 1280)), height = Math.max(600, Math.min(1400, Number(value?.height) || 900)), x = Number(value?.x), y = Number(value?.y); if (Number.isFinite(x) && Number.isFinite(y) && workAreas.some(a => x + 100 > a.x && y + 100 > a.y && x < a.x + a.width - 100 && y < a.y + a.height - 100))
    return { width, height, x, y }; return { width, height }; }
module.exports = { applicationUrl, internalUrl, externalUrl, windowBounds };
