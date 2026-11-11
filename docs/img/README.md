# docs/img

Real browser screenshots of the **v2** dashboard (Chrome, 2026-11-10, contract v2, not v3.2: the v3.2 dashboard has not been opened in a browser; `node src/cli.ts serve --port 8787`):

- `dashboard-pay.png`: the dashboard with INV-SHOT-1 selected after **Pay (one transaction)**: a 0.1 NEAR invoice paid by
  `sm1110-zi-payer.testnet`; the invoice file `INV-SHOT-1.json` lives only in the gitignored `invoices/` root, so it is not in a clone; on the machine that took the shot `zi status INV-SHOT-1` showed `status=PAID`, `paid_amount` 0.1 NEAR, `tax_amount` 0.008 NEAR.
- `dashboard-invoices.png`: the invoice list with live badges read from testnet (`PAID`, `OPEN`, `EXPIRED`,
  `NONEXISTENT`; INV-SHOT-0 was created but never paid, so its account does not exist).

Still an HTML render, not a screenshot:

- `dashboard-sweep-html-render.png`: produced in the headless T15 build (no browser): the DOM/CSS of `web/index.html`
  with the real T15 API responses, rasterized with ImageMagick. Do not present it as a screen capture. The sweep flow
  (plain transfer → `UNINITIALIZED` → Sweep → `PAID`) has no real screenshot yet.
