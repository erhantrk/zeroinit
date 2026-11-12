# docs/img

Logos (`logo-light.*`, `logo-dark.*`, `mark.*`) and dashboard images.

Real browser screenshot of the **current** dashboard (Chrome, 2026-11-12, contract v3.2r, `npm run zi -- serve --port 8787`):

- `dashboard-v32r.png`: three 0.1 NEAR invoices created from the page; `DASH-53NMD-A` paid with **Pay (one transaction)** ([`BKKA7RZ7…`](https://testnet.nearblocks.io/txns/BKKA7RZ7S279y87FQqsGrvMrNeQsHLw4abvKV6GvGtxa)), `DASH-53NMD-B` paid by a plain transfer ([`3ZXKEeGh…`](https://testnet.nearblocks.io/txns/3ZXKEeGhhPMjspK1inNyqfWqC3J5DYyATFVF2DyXrqxd)) and swept ([`FofRUtoY…`](https://testnet.nearblocks.io/txns/FofRUtoYFmvRwtmxGWpLEt9FpXYtcMCC72M1PHZbn7yy)), `DASH-53NMD-C` left unpaid. Badges as read from testnet: A and B `PAID`, C `NONEXISTENT` (never paid, so its account does not exist). Invoice files: `invoices/demo/`. Only NEAR invoices were tried; token invoices, the `SETTLING`/`REFUNDED` badges and Refund payer were not.

Real browser screenshots of the **v2** dashboard (history; Chrome, 2026-11-10, contract v2, `node src/cli.ts serve --port 8787`):

- `dashboard-pay.png`: the dashboard with INV-SHOT-1 selected after **Pay (one transaction)**: a 0.1 NEAR invoice paid by
  `sm1110-zi-payer.testnet`. The invoice file `INV-SHOT-1.json` lives only in the gitignored `invoices/` root, so it is not in a clone; on the machine that took the shot `zi status INV-SHOT-1` showed `status=PAID`, `paid_amount` 0.1 NEAR, `tax_amount` 0.008 NEAR.
- `dashboard-invoices.png`: the invoice list with live badges read from testnet (`PAID`, `OPEN`, `EXPIRED`,
  `NONEXISTENT`; INV-SHOT-0 was created but never paid, so its account does not exist).

An HTML render, not a screenshot:

- `dashboard-sweep-html-render.png`: produced without a browser, from the DOM/CSS of `web/index.html`
  with the real API responses of the v1 dashboard run ([SPIKES.md "Dashboard on real accounts"](../SPIKES.md#dashboard-on-real-accounts)), rasterized with ImageMagick. It is not a screen capture. The sweep flow
  (plain transfer → `UNINITIALIZED` → Sweep → `PAID`) has no real screenshot.
