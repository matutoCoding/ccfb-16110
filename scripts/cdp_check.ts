// 通过 CDP 在本机 Chrome 上执行 WGSL/GPU 检查（无需 puppeteer 依赖）
const base = 'http://127.0.0.1:9222';
const http = (url: string): Promise<any> => fetch(url).then((r) => r.json());

async function main(): Promise<void> {
  const targetPage = process.argv[2] ?? 'index.html';
  const waitMs = targetPage === 'gpu_smoke.html' ? 14000 : 5000;

  const tabs = await http(`${base}/json`);
  const tab = tabs.find((t: any) => t.type === 'page');
  if (!tab) throw new Error('没有可用的页面标签');

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (method: string, params?: any): Promise<any> =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const timer = setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), 20000);
      const onMsg = (ev: MessageEvent) => {
        const m = JSON.parse(ev.data);
        if (m.id === mid) {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          resolve(m.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:8791/${targetPage}` });
  await new Promise((r) => setTimeout(r, waitMs));
  const res = await send('Runtime.evaluate', {
    expression: 'document.title + "||" + document.getElementById("out").textContent',
    returnByValue: true,
  });
  console.log(res.result.value);
  ws.close();
}
main().catch((e) => {
  console.error('CDP 检查失败:', e.message);
  process.exit(1);
});
