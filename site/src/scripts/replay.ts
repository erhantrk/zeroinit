// Step-through for the recorded demo run. Without JS every step stays open (static HTML).
// Read-only: it only chooses which recorded step is shown. No network, no wallet.
// Wide screens: terminal on the left, detail panel on the right.
// Narrow screens: the panel opens directly under the chosen line.
const root = document.querySelector<HTMLElement>('[data-replay]');
if (root) {
  const items = Array.from(root.querySelectorAll<HTMLLIElement>('.replay-list > li'));
  const pane = root.querySelector<HTMLElement>('.replay-panels')!;
  const panels = Array.from(pane.querySelectorAll<HTMLElement>('.rp-panel'));
  const ctl = root.querySelector<HTMLElement>('.replay-ctl')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
  const count = root.querySelector<HTMLElement>('[data-count]')!;
  const narrow = matchMedia('(max-width: 59.99rem)');
  let current = 0;

  const buttons = items.map((li, i) => {
    const line = li.querySelector<HTMLElement>('.replay-line')!;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'replay-line';
    b.setAttribute('aria-controls', `rp-${i}`);
    b.append(...Array.from(line.childNodes));
    line.replaceWith(b);
    b.addEventListener('click', () => show(i));
    return b;
  });

  function place() {
    panels.forEach((p, i) => (narrow.matches ? items[i].append(p) : pane.append(p)));
  }

  function show(i: number) {
    current = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((li, k) => {
      const open = k === current;
      li.classList.toggle('open', open);
      buttons[k].setAttribute('aria-expanded', String(open));
      panels[k].hidden = !open;
    });
    prev.disabled = current === 0;
    next.disabled = current === items.length - 1;
    count.textContent = `Step ${current + 1} of ${items.length}`;
  }

  prev.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  narrow.addEventListener('change', place);
  ctl.hidden = false;
  root.classList.add('replay-live');
  place();
  show(0);
}
