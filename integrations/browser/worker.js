/* Optional Chrome/Edge provider. One sample/second only while downloads are active. */
const active = new Map();
let port, timer, refreshing = false, failed = false;
function connect() {
  if (port || failed) return;
  try {
    port = chrome.runtime.connectNative('com.orvyn.nivo');
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = undefined; failed = true; clearInterval(timer); timer = undefined; active.clear(); });
    port.onMessage.addListener(message => { if (message?.ok && active.size === 0) { port?.disconnect(); port = undefined; } });
  } catch { failed = true; }
}
function send(item) {
  if (item.incognito) return;
  const known = active.get(item.id); const now = Date.now();
  const received = Number.isSafeInteger(item.bytesReceived) && item.bytesReceived >= 0 ? item.bytesReceived : null;
  const total = Number.isSafeInteger(item.totalBytes) && item.totalBytes > 0 ? item.totalBytes : null;
  const elapsed = known ? (now - known.time) / 1000 : 0;
  const speed = known && received !== null && known.received !== null && elapsed >= .5 && elapsed <= 5 && received >= known.received ? (received - known.received) / elapsed : null;
  const state = item.state === 'complete' ? 'complete' : item.state === 'interrupted' ? 'error' : 'active';
  if (state === 'active') active.set(item.id, { time: now, received }); else active.delete(item.id);
  connect();
  const filename = (item.filename ?? '').split(/[\\/]/).pop() || 'Archivo';
  port?.postMessage({ kind: 'download', id: `browser:${item.id}`, source: 'browser', name: filename.slice(0, 256), state, received, total, bytesPerSecond: speed });
  if (active.size && !timer && !failed) timer = setInterval(refresh, 1000);
  if (!active.size) { clearInterval(timer); timer = undefined; }
}
async function refresh() {
  if (refreshing || failed) return;
  refreshing = true;
  try { for (const item of await chrome.downloads.search({ inProgress: true })) send(item); }
  finally { refreshing = false; }
}
chrome.downloads.onCreated.addListener(item => { failed = false; send(item); });
chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state && !delta.error && !delta.paused) return;
  const [item] = await chrome.downloads.search({ id: delta.id }); if (item) send(item);
});
