// 主应用端到端冒烟：真实加载 dist 预览，确认启动、WebGPU、首帧渲染无错误
async function main(): Promise<void> {
  const base = 'http://127.0.0.1:9222';
  const tabs = await fetch(`${base}/json`).then((r) => r.json());
  const tab = tabs.find((t: any) => t.type === 'page');
  if (!tab) throw new Error('无页面标签');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const errors: string[] = [];
  const send = (method: string, params?: any): Promise<any> =>
    new Promise((resolve) => {
      const mid = ++id;
      const onMsg = (ev: MessageEvent) => {
        const m = JSON.parse(ev.data);
        if (m.id === mid) {
          ws.removeEventListener('message', onMsg);
          resolve(m.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8792/' });
  await new Promise((r) => setTimeout(r, 9000));
  const res = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      shell: !!document.querySelector('.app-shell'),
      nav: document.querySelectorAll('.nav-item').length,
      canvas: !!document.querySelector('canvas'),
      fps: document.getElementById('hud-fps')?.textContent ?? 'n/a',
      status: document.getElementById('topbar-status')?.textContent ?? 'n/a'
    })`,
    returnByValue: true,
  });
  console.log(res.result.value);
  console.log(errors.length ? 'APP_ERRORS ' + JSON.stringify(errors) : 'APP_CLEAN');
  ws.close();
  if (errors.length) process.exit(1);
}
main().catch((e) => {
  console.error('APP_FATAL', e.message);
  process.exit(1);
});
