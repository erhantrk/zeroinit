# docs/img

These two files are **HTML renders, not live screenshots**:

- `dashboard-pay-html-render.png`
- `dashboard-sweep-html-render.png`

They were produced in a headless build with no browser. The DOM/CSS of `web/index.html` and the real invoice docs and
API responses from the T15 run were rasterized with ImageMagick. They are not OS screen captures, and they must not be
shown in `README.md`, the video, or the X post as screen captures.

- [ ] live dashboard check + real screenshots: run `node src/cli.ts serve --port 8787` in a real browser,
  follow the T15 click path (create → Pay, `NONEXISTENT` → `PAID`; create → plain transfer → `UNINITIALIZED` → Sweep →
  `PAID`), and overwrite these two files with real captures (or add `dashboard-pay.png` / `dashboard-sweep.png`).
