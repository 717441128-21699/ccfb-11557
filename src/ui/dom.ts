/** 轻量 DOM 构建辅助 */
export type El = HTMLElement;

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

const eventNames = new Set([
  'onclick',
  'oninput',
  'onchange',
  'ondblclick',
  'onpointerdown',
  'onpointermove',
  'onpointerup',
  'onwheel',
  'onmouseenter',
  'onmouseleave',
  'onsubmit'
]);

export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): El {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (eventNames.has(k.toLowerCase())) {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: El): void {
  el.replaceChildren();
}

export function mount(el: El, parent: El): El {
  parent.replaceChildren(el);
  return el;
}
