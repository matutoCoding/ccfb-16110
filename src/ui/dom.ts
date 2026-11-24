// DOM 辅助
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = v as string;
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

const toastLayer = (): HTMLElement => {
  let layer = document.querySelector('.toast-layer') as HTMLElement | null;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'toast-layer';
    document.body.append(layer);
  }
  return layer;
};

export function toast(msg: string, ms = 3200): void {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toastLayer().append(t);
  setTimeout(() => t.remove(), ms);
}

export function modal(title: string, body: HTMLElement, onOk?: () => void): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const box = document.createElement('div');
  box.className = 'modal';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = '关闭';
  cancel.onclick = () => mask.remove();
  foot.append(cancel);
  if (onOk) {
    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.textContent = '应用';
    ok.onclick = () => {
      onOk();
      mask.remove();
    };
    foot.append(ok);
  }
  box.append(h3, body, foot);
  mask.append(box);
  document.body.append(mask);
}
