// Text of the four beats of the map story. Every sentence is a line of TRUTH.md or a value in fixtures/v33/demo-run.json.
// Live state labels (invoice + state) are computed from scroll progress in scripts/story.ts; `state` here is the
// state at the end of the beat and is what the no-JS stills show.
export const BEATS = [
  {
    state: 'NONEXISTENT',
    caption: 'The invoice has an address and no account yet.',
    detail: 'The address comes from the invoice terms and the contract hash. Asked about it, the chain answers UNKNOWN_ACCOUNT. No transaction was needed to get it.',
    settled: false,
  },
  {
    state: 'PAID',
    caption: 'The first payment creates the account.',
    detail: 'The payer sends one transaction. It installs the contract at the address, runs it, and splits the money. In the demo run, 1 NEAR came in, 0.92 went to the merchant and 0.08 to the tax vault.',
    settled: true,
  },
  {
    state: 'UNINITIALIZED',
    caption: 'A wallet can send money to the address.',
    detail: 'For a NEAR invoice a plain transfer works. The money waits in an account that has no code yet.',
    settled: false,
  },
  {
    state: 'PAID',
    caption: 'Anyone can then call sweep.',
    detail: 'sweep installs the contract and settles the waiting money with the same split. The demo run ends with result=PAID.',
    settled: true,
  },
] as const;
