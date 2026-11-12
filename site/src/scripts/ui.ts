// Small page behaviour: copy buttons, the current section in the nav, one-time heading reveal.

// copy buttons stay hidden (and the page stays complete) without the clipboard API
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => {
  if (!navigator.clipboard) return;
  b.hidden = false;
  const label = b.textContent ?? 'Copy';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy ?? '');
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => { b.textContent = label; }, 1600);
  });
});

// mark the nav link of the section in view
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.site-head nav a[href^="#"]'));
const byId = new Map(links.map((a) => [a.getAttribute('href')!.slice(1), a]));
if ('IntersectionObserver' in window && byId.size) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        byId.get(e.target.id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-35% 0px -60% 0px' },
  );
  byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

// headings rise once (translate only)
const rv = Array.from(document.querySelectorAll<HTMLElement>('.rv'));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  rv.forEach((el) => io.observe(el));
} else {
  rv.forEach((el) => el.classList.add('in'));
}
