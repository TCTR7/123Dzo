// Real Chromium, disposable loopback server. No app env, Clerk, DB or push provider.
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = ['/sw.js', '/offline.html', '/icon-192x192.png', '/icon-512x512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/sounds/ting-ting.wav'];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (assets.includes(path)) {
      res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.html') ? 'text/html; charset=utf-8' : path.endsWith('.wav') ? 'audio/wav' : 'image/png');
      res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(resolve(root, 'public' + path))); return;
    }
    if (path === '/api/private') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ private: 'unit-session-secret' })); return; }
    res.setHeader('Content-Type', 'text/html'); res.setHeader('Cache-Control', 'no-store'); res.end('<!doctype html><title>PWA local fixture</title><p>unit-session-secret</p>');
  } catch { res.statusCode = 500; res.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let executablePath;
  for (const path of [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    try { await access(path); executablePath = path; break; } catch { /* next local browser */ }
  }
  assert.ok(executablePath, 'Install Chromium or configure a supported local browser');
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + '/fixture');
  await page.evaluate(async () => {
    await (await caches.open('123dzo-static-old')).put('/old-secret', new Response('legacy-private'));
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.goto(base + '/customer/order/unit-secret');
  assert.ok((await page.textContent('body')).includes('unit-session-secret'));
  assert.equal(await page.evaluate(async () => (await fetch('/api/private')).status), 200);
  assert.equal(await page.evaluate(async () => (await fetch('/api/private', { method: 'POST', body: '{}' })).status), 200);
  const cached = await page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map(req => new URL(req.url).pathname);
    return out;
  });
  assert.deepEqual(Object.keys(cached), ['123dzo-static-v1']);
  assert.deepEqual(cached['123dzo-static-v1'].sort(), assets.filter(path => path !== '/sw.js').sort());
  const decoded = await page.evaluate(async () => {
    const response = await fetch('/sounds/ting-ting.wav'); const context = new AudioContext();
    try { const audio = await context.decodeAudioData(await response.arrayBuffer()); return { duration: audio.duration, channels: audio.numberOfChannels }; }
    finally { await context.close(); }
  });
  assert.ok(decoded.duration > 0.6 && decoded.duration < 1); assert.equal(decoded.channels, 1);
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/private', { method: 'POST', body: '{}' }); return 'wrong-success'; } catch { return 'network-failure'; } }), 'network-failure');
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/private', { headers: { RSC: '1' } }); return 'wrong-success'; } catch { return 'network-failure'; } }), 'network-failure');
  await page.goto(base + '/staff'); assert.ok((await page.textContent('body')).includes('Chưa kết nối được với quán')); assert.ok(!(await page.textContent('body')).includes('unit-session-secret'));
  assert.equal(await page.evaluate(async () => (await fetch('/icon-192x192.png')).status), 200);
  await context.setOffline(false); await page.reload(); assert.ok((await page.textContent('body')).includes('unit-session-secret'));
  await context.close();
  // Exercise push/click handlers without permission dialogs or actual provider calls.
  const handlers = {}, shown = [], opened = []; let customerFocused = false, staffFocused = false;
  const self = { location: { origin: base }, addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (...args) => { shown.push(args); } },
    clients: { matchAll: async () => [{ url: base + '/customer/order/private', focus: async () => { customerFocused = true; } }], openWindow: async url => { opened.push(url); } } };
  vm.runInNewContext(await readFile(resolve(root, 'public/sw.js'), 'utf8'), { self, URL, Response });
  let work; const waitUntil = promise => { work = promise; };
  handlers.push({ data: { json: () => ({ title: 'private-name', body: 'private-phone', url: 'https://attacker.test/', tag: 'notification-40000000-0000-4000-8000-000000000001' }) }, waitUntil }); await work;
  assert.equal(shown[0][1].data.url, '/staff'); assert.ok(!JSON.stringify(shown).includes('private-phone'));
  handlers.notificationclick({ notification: { close() {}, data: { url: 'https://attacker.test/' } }, waitUntil }); await work;
  assert.equal(opened[0], base + '/staff'); assert.equal(customerFocused, false);
  self.clients.matchAll = async () => [{ url: base + '/staff', focus: async () => { staffFocused = true; } }];
  handlers.notificationclick({ notification: { close() {} }, waitUntil }); await work; assert.equal(staffFocused, true); assert.equal(opened.length, 1);
  console.log('PASS: real Chromium SW install/cache migration, network-only QR/API/RSC/mutations, offline/reconnect, static icons and WAV decode; push/click isolated handlers.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
