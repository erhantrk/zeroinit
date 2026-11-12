# docs/img

Logos (`logo-light.*`, `logo-dark.*`, `mark.*`) and dashboard images.

Real browser screenshots of the **v2** dashboard (Chrome, 2026-11-10, contract v2, `node src/cli.ts serve --port 8787`). The current dashboard has not been opened in a browser.

- `dashboard-pay.png`: the dashboard with INV-SHOT-1 selected after **Pay (one transaction)**: a 0.1 NEAR invoice paid by
  `sm1110-zi-payer.testnet`. The invoice file `INV-SHOT-1.json` lives only in the gitignored `invoices/` root, so it is not in a clone; on the machine that took the shot `zi status INV-SHOT-1` showed `status=PAID`, `paid_amount` 0.1 NEAR, `tax_amount` 0.008 NEAR.
- `dashboard-invoices.png`: the invoice list with live badges read from testnet (`PAID`, `OPEN`, `EXPIRED`,
  `NONEXISTENT`; INV-SHOT-0 was created but never paid, so its account does not exist).

An HTML render, not a screenshot:

- `dashboard-sweep-html-render.png`: produced without a browser, from the DOM/CSS of `web/index.html`
  with the real API responses of the v1 dashboard run ([SPIKES.md "Dashboard on real accounts"](../SPIKES.md#dashboard-on-real-accounts)), rasterized with ImageMagick. It is not a screen capture. The sweep flow
  (plain transfer → `UNINITIALIZED` → Sweep → `PAID`) has no real screenshot.
