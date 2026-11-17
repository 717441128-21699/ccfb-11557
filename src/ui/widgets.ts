import { h } from './dom';

export function toast(msg: string, isError = false): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = isError ? 'toast err' : 'toast';
  el.hidden = false;
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

export function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
  fmt: (v: number) => string = (v) => v.toFixed(2)
): HTMLElement {
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    oninput: () => {
      const v = Number((input as HTMLInputElement).value);
      val.textContent = fmt(v);
      onInput(v);
    }
  }) as HTMLInputElement;
  return h('div', { class: 'field' }, h('label', {}, document.createTextNode(label), val), input);
}

export function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void
): HTMLElement {
  const input = h('input', {
    type: 'number',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    onchange: () => onChange(Number((input as HTMLInputElement).value))
  });
  return h('div', { class: 'field' }, h('label', {}, label), input);
}

export function segmented<T extends string>(
  options: { value: T; label: string }[],
  current: T,
  onPick: (v: T) => void
): HTMLElement {
  return h(
    'div',
    { class: 'seg' },
    ...options.map((o) =>
      h(
        'button',
        {
          class: o.value === current ? 'active' : '',
          onclick: () => onPick(o.value)
        },
        o.label
      )
    )
  );
}

export function statCard(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat-card' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value));
}

export function badge(text: string, kind: 'pass' | 'fail' | 'run'): HTMLElement {
  return h('span', { class: `badge ${kind}` }, text);
}
