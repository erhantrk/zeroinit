//! ZeroInit invoice contract v3. One instance = one invoice = one `0u` universal account.
//! The instance never has an init method: its whole state (key "STATE") is written by the
//! protocol's UniversalStateInit action from the invoice terms. See docs/STABLECOIN.md.
//!
//! v3 adds NEP-141 invoices (one token per invoice, named in the terms), a settlement batch
//! whose private callback `on_settled` is the only place that emits `invoice_paid`, an owed
//! ledger that retries failed payouts to their own recipient, and a payout lock.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_PAID: u8 = 1;
pub const STATUS_EXPIRED: u8 = 2;
pub const STATUS_SETTLING: u8 = 3;
pub const STATUS_REFUNDED: u8 = 4;
pub const ZBA_LIMIT_BYTES: u64 = 770;

pub const ROLE_MERCHANT: u8 = 0;
pub const ROLE_TAX: u8 = 1;
pub const ROLE_PAYER: u8 = 2;

pub const KIND_PAY: u8 = 0;
pub const KIND_TRANSFER: u8 = 1;
pub const KIND_EXTRA: u8 = 2;
pub const KIND_RESEND: u8 = 3;
pub const KIND_RECLAIM: u8 = 4;
pub const KIND_REFUND: u8 = 5;

/// Payouts hold the lock for five minutes: one NEAR block is not enough for a cross-contract
/// token transfer, and a callback that never runs must not freeze the invoice forever.
pub const BUSY_MS: u64 = 300_000;
const FT_TRANSFER_GAS_TGAS: u64 = 15;
const ON_SETTLED_GAS_TGAS: u64 = 20;
const FT_BALANCE_OF_GAS_TGAS: u64 = 5;
const MIN_TOKEN_SWEEP_GAS_TGAS: u64 = 150;
const MIN_FT_ACCEPT_GAS_TGAS: u64 = 90;

/// Borsh layout is FROZEN for v3 (docs/STABLECOIN.md section 3). Field order matters.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Invoice {
    pub v: u8,
    pub invoice_id: String,
    pub merchant: AccountId,
    pub tax_vault: AccountId,
    pub tax_bps: u16,
    pub amount: u128,
    pub expires_at_ms: u64,
    pub salt: u64,
    pub grace_ms: u64,
    pub token: Option<AccountId>,
    pub status: u8,
    pub paid_by: Option<AccountId>,
    pub paid_at_ms: u64,
    pub paid_amount: u128,
    pub tax_amount: u128,
    pub owed_merchant: u128,
    pub owed_tax: u128,
    pub owed_payer: u128,
    pub refund_to: Option<AccountId>,
    pub busy_until_ms: u64,
}

#[near(serializers = [json])]
pub struct InvoiceView {
    pub v: u8,
    pub account_id: AccountId,
    pub invoice_id: String,
    pub merchant: AccountId,
    pub tax_vault: AccountId,
    pub tax_bps: u16,
    pub amount: U128,
    pub expires_at_ms: U64,
    pub salt: U64,
    pub grace_ms: U64,
    pub token: Option<AccountId>,
    pub status: String,
    pub paid_by: Option<AccountId>,
    pub paid_at_ms: U64,
    pub paid_amount: U128,
    pub tax_amount: U128,
    pub owed_merchant: U128,
    pub owed_tax: U128,
    pub owed_payer: U128,
    pub refund_to: Option<AccountId>,
    pub busy_until_ms: U64,
}

/// One transfer of a settlement batch. `from_owed` marks a retry of an amount that was already
/// in the owed ledger: only those emit `tax_resent` / `owed_resent`, and only they were debited
/// when the batch was scheduled.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payout {
    pub role: u8,
    pub to: AccountId,
    pub amount: u128,
    pub from_owed: bool,
    /// true: pay in NEAR even on a token invoice (a refund of an attached NEAR deposit).
    pub near: bool,
}

/// The batch a private `on_settled` callback settles. `merchant_part` / `tax_part` are only used
/// by `owed_reclaimed`; `lock` says whether this batch owns the payout lock (a rejected `pay`
/// only refunds the deposit and must not clear a lock it did not take).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub kind: u8,
    pub result: String,
    pub late: bool,
    pub excess: u128,
    pub refund_reason: String,
    pub merchant_part: u128,
    pub tax_part: u128,
    pub lock: bool,
    pub payouts: Vec<Payout>,
}

#[near(serializers = [json])]
struct FtTransferArgs {
    receiver_id: AccountId,
    amount: U128,
}

#[near(serializers = [json])]
struct FtBalanceArgs {
    account_id: AccountId,
}

/// Strict `ft_transfer_call` msg: `{"action":"pay"}` or `{"action":"pay","invoice_id":"<id>"}`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PayMsg {
    action: String,
    invoice_id: Option<String>,
}

fn status_name(s: u8) -> &'static str {
    match s {
        STATUS_OPEN => "OPEN",
        STATUS_PAID => "PAID",
        STATUS_EXPIRED => "EXPIRED",
        STATUS_SETTLING => "SETTLING",
        STATUS_REFUNDED => "REFUNDED",
        _ => "UNKNOWN",
    }
}

fn role_name(role: u8) -> &'static str {
    match role {
        ROLE_MERCHANT => "merchant",
        ROLE_TAX => "tax",
        _ => "payer",
    }
}

/// What a sweep would do, computed before any state changes so a token sweep can refuse a
/// missing yocto float without debiting the owed ledger first.
struct SweepState {
    owed_tax: u128,
    owed_merchant: u128,
    owed_payer: u128,
    status: u8,
    paid_by: Option<AccountId>,
    paid_at_ms: u64,
    paid_amount: u128,
    tax_amount: u128,
    lock_until: Option<u64>,
}

enum SweepOutcome {
    /// A no-op case: NEAR panics with this string, a token callback returns it as the value.
    Panic(String),
    Pay(Batch, SweepState),
}

impl Invoice {
    fn emit_event(&self, event: &str, mut data: serde_json::Value) {
        if let Some(obj) = data.as_object_mut() {
            obj.insert("token".to_string(), serde_json::to_value(&self.token).unwrap());
        }
        let ev = serde_json::json!({
            "standard": "zeroinit",
            "version": "3.0.0",
            "event": event,
            "data": [data],
        });
        env::log_str(&format!("EVENT_JSON:{}", ev));
    }

    fn split_of(&self, x: u128) -> (u128, u128) {
        // floor(x * bps / 10000) without the x * bps product, which overflows for balances above
        // u128::MAX / 10000 (a callback must never panic). Identical result: x = 10000q + r.
        let bps = self.tax_bps as u128;
        let tax = (x / 10_000u128) * bps + (x % 10_000u128) * bps / 10_000u128;
        (x - tax, tax)
    }

    fn split(&self) -> (u128, u128) {
        self.split_of(self.amount)
    }

    fn owed_total(&self) -> u128 {
        self.owed_merchant + self.owed_tax + self.owed_payer
    }

    fn free_balance() -> u128 {
        let bal = env::account_balance().as_yoctonear();
        let usage = env::storage_usage();
        let reserve = if usage <= ZBA_LIMIT_BYTES {
            0
        } else {
            env::storage_byte_cost().as_yoctonear() * (usage as u128)
        };
        bal.saturating_sub(reserve)
    }

    /// Payouts with amount 0 are not created and not part of the batch.
    fn payout(&self, role: u8, to: AccountId, amount: u128, from_owed: bool, near: bool) -> Option<Payout> {
        if amount == 0 {
            None
        } else {
            Some(Payout { role, to, amount, from_owed, near })
        }
    }

    fn create_payout(&self, p: &Payout) -> Promise {
        match &self.token {
            _ if p.near => Promise::new(p.to.clone()).transfer(NearToken::from_yoctonear(p.amount)),
            None => Promise::new(p.to.clone()).transfer(NearToken::from_yoctonear(p.amount)),
            Some(token) => {
                let args = serde_json::to_vec(&FtTransferArgs { receiver_id: p.to.clone(), amount: U128(p.amount) })
                    .expect("ft_transfer args");
                Promise::new(token.clone()).function_call(
                    "ft_transfer".to_string(),
                    args,
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(FT_TRANSFER_GAS_TGAS),
                )
            }
        }
    }

    /// Join every payout and end with the private `on_settled` callback. The callback's return
    /// value is the transaction's final value when the flow returns this promise.
    fn dispatch(&self, batch: Batch) -> PromiseOrValue<String> {
        let mut it = batch.payouts.iter();
        let first = self.create_payout(it.next().expect("batch without payouts"));
        let all = it.fold(first, |acc, p| acc.and(self.create_payout(p)));
        PromiseOrValue::Promise(
            all.then(
                Invoice::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(ON_SETTLED_GAS_TGAS))
                    .on_settled(batch),
            ),
        )
    }

    fn apply(&mut self, st: SweepState) {
        self.owed_tax = st.owed_tax;
        self.owed_merchant = st.owed_merchant;
        self.owed_payer = st.owed_payer;
        self.status = st.status;
        self.paid_by = st.paid_by;
        self.paid_at_ms = st.paid_at_ms;
        self.paid_amount = st.paid_amount;
        self.tax_amount = st.tax_amount;
        if let Some(t) = st.lock_until {
            self.busy_until_ms = t;
        }
    }

    /// A refund of the attached deposit. Zero deposits emit the event at once and return the
    /// value directly (v2 contract-1 shape); otherwise the event comes from the callback.
    fn refund(&mut self, d: u128, payer: &AccountId, reason: &str, result: &str) -> PromiseOrValue<String> {
        if d == 0 {
            self.emit_event("payment_refunded", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": env::current_account_id(),
                "payer": payer, "amount": "0", "reason": reason,
            }));
            return PromiseOrValue::Value(result.to_string());
        }
        let p = Payout { role: ROLE_PAYER, to: payer.clone(), amount: d, from_owed: false, near: true };
        let batch = Batch { kind: KIND_REFUND, result: result.to_string(), late: false, excess: 0, refund_reason: reason.to_string(),
            merchant_part: 0, tax_part: 0, lock: false, payouts: vec![p] };
        self.dispatch(batch)
    }

    fn resend_result(payouts: &[Payout]) -> String {
        if payouts.iter().all(|p| p.role == ROLE_TAX) { "TAX_RESENT".to_string() } else { "OWED_RESENT".to_string() }
    }

    /// The sweep plan. Reads only; `apply` performs the state changes and `dispatch` the payouts.
    fn plan_sweep(&self, bal: u128, now: u64) -> SweepOutcome {
        let mut st = SweepState {
            owed_tax: self.owed_tax,
            owed_merchant: self.owed_merchant,
            owed_payer: self.owed_payer,
            status: self.status,
            paid_by: self.paid_by.clone(),
            paid_at_ms: self.paid_at_ms,
            paid_amount: self.paid_amount,
            tax_amount: self.tax_amount,
            lock_until: None,
        };
        let mut payouts: Vec<Payout> = vec![];
        let mut left = bal;
        // 1. Owed first, each limited to what is left of the balance.
        if st.owed_tax > 0 {
            let take = st.owed_tax.min(left);
            if take > 0 {
                payouts.push(Payout { role: ROLE_TAX, to: self.tax_vault.clone(), amount: take, from_owed: true, near: false });
                st.owed_tax -= take;
                left -= take;
            }
        }
        if st.owed_merchant > 0 {
            let take = st.owed_merchant.min(left);
            if take > 0 {
                payouts.push(Payout { role: ROLE_MERCHANT, to: self.merchant.clone(), amount: take, from_owed: true, near: false });
                st.owed_merchant -= take;
                left -= take;
            }
        }
        if st.owed_payer > 0 {
            if let Some(to) = self.refund_to.clone() {
                let take = st.owed_payer.min(left);
                if take > 0 {
                    payouts.push(Payout { role: ROLE_PAYER, to, amount: take, from_owed: true, near: false });
                    st.owed_payer -= take;
                    left -= take;
                }
            }
        }
        let owed_paid = !payouts.is_empty();
        let resend = Self::resend_result(&payouts);
        let owed_left = st.owed_tax + st.owed_merchant + st.owed_payer;
        let avail = left.saturating_sub(owed_left);

        // 2. SETTLING: only the owed ledger may move; extra funds wait for PAID.
        if self.status == STATUS_SETTLING {
            if !owed_paid {
                return SweepOutcome::Panic("NOTHING_TO_SWEEP".to_string());
            }
            st.lock_until = Some(now + BUSY_MS);
            let batch = Batch { kind: KIND_RESEND, result: resend, late: false, excess: 0, refund_reason: String::new(),
                merchant_part: 0, tax_part: 0, lock: true, payouts };
            return SweepOutcome::Pay(batch, st);
        }

        // contract-4: an OPEN invoice past its expiry is EXPIRED, whether or not anyone has called
        // pay()/ft_on_transfer to flag it. One permissionless sweep both flags and releases.
        let lapsed_open = self.status == STATUS_OPEN && now > self.expires_at_ms;
        let eff_status = if lapsed_open { STATUS_EXPIRED } else { self.status };
        // contract-2: "never settled" is `paid_at_ms == 0` (set only by a settlement). `paid_amount`
        // also grows on pro-rata releases after expiry, so it cannot be the marker.
        let open_or_unpaid_expired = eff_status == STATUS_OPEN
            || (eff_status == STATUS_EXPIRED && self.paid_at_ms == 0);

        if open_or_unpaid_expired {
            if lapsed_open {
                st.status = STATUS_EXPIRED;
            }
            if avail >= self.amount {
                let (net, tax) = self.split_of(avail);
                if net > 0 { payouts.push(Payout { role: ROLE_MERCHANT, to: self.merchant.clone(), amount: net, from_owed: false, near: false }); }
                if tax > 0 { payouts.push(Payout { role: ROLE_TAX, to: self.tax_vault.clone(), amount: tax, from_owed: false, near: false }); }
                st.status = STATUS_SETTLING;
                st.paid_by = None;
                st.paid_at_ms = now;
                // Running totals: pro-rata releases made while EXPIRED were already delivered.
                st.paid_amount += avail;
                st.tax_amount += tax;
                st.lock_until = Some(now + BUSY_MS);
                let batch = Batch { kind: KIND_TRANSFER, result: "PAID".to_string(), late: now > self.expires_at_ms, excess: 0,
                    refund_reason: String::new(), merchant_part: 0, tax_part: 0, lock: true, payouts };
                return SweepOutcome::Pay(batch, st);
            }
            if eff_status == STATUS_OPEN {
                if owed_paid {
                    st.lock_until = Some(now + BUSY_MS);
                    let batch = Batch { kind: KIND_RESEND, result: resend, late: false, excess: 0, refund_reason: String::new(),
                        merchant_part: 0, tax_part: 0, lock: true, payouts };
                    return SweepOutcome::Pay(batch, st);
                }
                return SweepOutcome::Panic(format!("UNDERPAID: available {} < amount {}", avail, self.amount));
            }
            // EXPIRED and never paid: release what is parked, pro rata, and stay EXPIRED.
            if avail == 0 {
                if owed_paid {
                    st.lock_until = Some(now + BUSY_MS);
                    let batch = Batch { kind: KIND_RESEND, result: resend, late: false, excess: 0, refund_reason: String::new(),
                        merchant_part: 0, tax_part: 0, lock: true, payouts };
                    return SweepOutcome::Pay(batch, st);
                }
                return SweepOutcome::Panic("NOTHING_TO_SWEEP".to_string());
            }
            let (net, tax) = self.split_of(avail);
            if net > 0 { payouts.push(Payout { role: ROLE_MERCHANT, to: self.merchant.clone(), amount: net, from_owed: false, near: false }); }
            if tax > 0 { payouts.push(Payout { role: ROLE_TAX, to: self.tax_vault.clone(), amount: tax, from_owed: false, near: false }); }
            st.paid_amount += avail;
            st.tax_amount += tax;
            st.lock_until = Some(now + BUSY_MS);
            let batch = Batch { kind: KIND_EXTRA, result: "EXTRA_SWEPT".to_string(), late: true, excess: 0,
                refund_reason: String::new(), merchant_part: 0, tax_part: 0, lock: true, payouts };
            return SweepOutcome::Pay(batch, st);
        }

        // 4. PAID / REFUNDED / EXPIRED after a payment: extra funds are taxed too (fix 3).
        if avail == 0 {
            if owed_paid {
                st.lock_until = Some(now + BUSY_MS);
                let batch = Batch { kind: KIND_RESEND, result: resend, late: false, excess: 0, refund_reason: String::new(),
                    merchant_part: 0, tax_part: 0, lock: true, payouts };
                return SweepOutcome::Pay(batch, st);
            }
            return SweepOutcome::Panic("NOTHING_TO_SWEEP".to_string());
        }
        let (net, tax) = self.split_of(avail);
        if net > 0 { payouts.push(Payout { role: ROLE_MERCHANT, to: self.merchant.clone(), amount: net, from_owed: false, near: false }); }
        if tax > 0 { payouts.push(Payout { role: ROLE_TAX, to: self.tax_vault.clone(), amount: tax, from_owed: false, near: false }); }
        st.paid_amount += avail;
        st.tax_amount += tax;
        st.lock_until = Some(now + BUSY_MS);
        let batch = Batch { kind: KIND_EXTRA, result: "EXTRA_SWEPT".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part: 0, tax_part: 0, lock: true, payouts };
        SweepOutcome::Pay(batch, st)
    }
}

#[near]
impl Invoice {
    /// Pay with an attached deposit (NEAR invoices only). Never panics on business rules: it
    /// refunds instead, so the account still materializes and the refund is auditable on-chain.
    #[payable]
    pub fn pay(&mut self) -> PromiseOrValue<String> {
        let d = env::attached_deposit().as_yoctonear();
        let payer = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        if self.token.is_some() {
            return self.refund(d, &payer, "wrong_asset", "REFUNDED_WRONG_ASSET");
        }
        if self.status != STATUS_OPEN {
            return self.refund(d, &payer, "not_open", "REFUNDED_NOT_OPEN");
        }
        if now > self.expires_at_ms {
            self.status = STATUS_EXPIRED;
            return self.refund(d, &payer, "expired", "REFUNDED_EXPIRED");
        }
        if now < self.busy_until_ms {
            return self.refund(d, &payer, "busy", "REFUNDED_BUSY");
        }
        let parked = Self::free_balance().saturating_sub(d).saturating_sub(self.owed_total());
        if parked >= self.amount {
            // contract-3: parked funds cover the invoice. Settle them like sweep() and refund
            // the whole deposit in the same batch (taxed: paid_by stays None, via "transfer").
            let (net, tax) = self.split_of(parked);
            let mut payouts = vec![];
            if let Some(p) = self.payout(ROLE_MERCHANT, self.merchant.clone(), net, false, false) { payouts.push(p); }
            if let Some(p) = self.payout(ROLE_TAX, self.tax_vault.clone(), tax, false, false) { payouts.push(p); }
            if let Some(p) = self.payout(ROLE_PAYER, payer, d, false, true) { payouts.push(p); }
            self.status = STATUS_SETTLING;
            self.paid_by = None;
            self.paid_at_ms = now;
            self.paid_amount = parked;
            self.tax_amount = tax;
            self.busy_until_ms = now + BUSY_MS;
            let batch = Batch { kind: KIND_TRANSFER, result: "PAID".to_string(), late: now > self.expires_at_ms, excess: d,
                refund_reason: "already_funded".to_string(), merchant_part: 0, tax_part: 0, lock: true, payouts };
            return self.dispatch(batch);
        }
        if d < self.amount {
            return self.refund(d, &payer, "underpaid", "REFUNDED_UNDERPAID");
        }
        let (net, tax) = self.split();
        let excess = d - self.amount;
        let mut payouts = vec![];
        if let Some(p) = self.payout(ROLE_MERCHANT, self.merchant.clone(), net, false, false) { payouts.push(p); }
        if let Some(p) = self.payout(ROLE_TAX, self.tax_vault.clone(), tax, false, false) { payouts.push(p); }
        if let Some(p) = self.payout(ROLE_PAYER, payer.clone(), excess, false, true) { payouts.push(p); }
        self.status = STATUS_SETTLING;
        self.paid_by = Some(payer);
        self.paid_at_ms = now;
        self.paid_amount = self.amount;
        self.tax_amount = tax;
        self.busy_until_ms = now + BUSY_MS;
        let batch = Batch { kind: KIND_PAY, result: "PAID".to_string(), late: false, excess,
            refund_reason: String::new(), merchant_part: 0, tax_part: 0, lock: true, payouts };
        self.dispatch(batch)
    }

    /// NEP-141 hook: the token contract already credited `amount` to this invoice. Returns the
    /// unused amount (the token refunds it to `sender_id`); on acceptance the payouts run in a
    /// detached batch and `on_settled` records what was delivered.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let amount = amount.0;
        let predecessor = env::predecessor_account_id();
        let reject = |inv: &Invoice, reason: &str| {
            inv.emit_event("payment_rejected", serde_json::json!({
                "invoice_id": inv.invoice_id, "account_id": env::current_account_id(),
                "sender": sender_id, "amount": amount.to_string(), "reason": reason,
                "predecessor": predecessor,
            }));
            PromiseOrValue::Value(U128(amount))
        };
        if self.token.as_ref() != Some(&predecessor) {
            return reject(self, "wrong_token");
        }
        // contract-1: any call from the invoice's own token while a lock is held may carry a credit
        // that a pending token sweep's balance read already includes, and the token takes that
        // credit back whenever this hook returns it (every rejection below). Change the lock value
        // first, for every status and every rejection reason, so `on_token_balance` plans nothing.
        if env::block_timestamp_ms() < self.busy_until_ms {
            self.busy_until_ms += 1;
        }
        let parsed = serde_json::from_str::<PayMsg>(&msg);
        let ok_msg = match &parsed {
            Ok(m) => m.action == "pay" && m.invoice_id.as_ref().map_or(true, |id| *id == self.invoice_id),
            Err(_) => false,
        };
        if !ok_msg {
            return reject(self, "bad_msg");
        }
        let now = env::block_timestamp_ms();
        if self.status != STATUS_OPEN {
            return reject(self, "not_open");
        }
        if now > self.expires_at_ms {
            self.status = STATUS_EXPIRED;
            return reject(self, "expired");
        }
        if now < self.busy_until_ms {
            // The lock value was already changed above (contract-1), so a pending token sweep
            // plans nothing; the token refunds this transfer in full.
            return reject(self, "busy");
        }
        let (net, tax) = self.split();
        let payouts_len = (net > 0) as u128 + (tax > 0) as u128;
        if env::account_balance().as_yoctonear() < payouts_len {
            return reject(self, "no_yocto");
        }
        let remaining = env::prepaid_gas().as_gas().saturating_sub(env::used_gas().as_gas());
        if remaining < MIN_FT_ACCEPT_GAS_TGAS * 1_000_000_000_000 {
            return reject(self, "low_gas");
        }
        if amount < self.amount {
            return reject(self, "underpaid");
        }
        let excess = amount - self.amount;
        let mut payouts = vec![];
        if let Some(p) = self.payout(ROLE_MERCHANT, self.merchant.clone(), net, false, false) { payouts.push(p); }
        if let Some(p) = self.payout(ROLE_TAX, self.tax_vault.clone(), tax, false, false) { payouts.push(p); }
        self.status = STATUS_SETTLING;
        self.paid_by = Some(sender_id);
        self.paid_at_ms = now;
        self.paid_amount = self.amount;
        self.tax_amount = tax;
        self.busy_until_ms = now + BUSY_MS;
        let batch = Batch { kind: KIND_PAY, result: "PAID".to_string(), late: false, excess,
            refund_reason: String::new(), merchant_part: 0, tax_part: 0, lock: true, payouts };
        if let PromiseOrValue::Promise(p) = self.dispatch(batch) {
            p.detach();
        }
        PromiseOrValue::Value(U128(excess))
    }

    /// Settle funds that arrived without a call (plain transfer). Anyone may call.
    pub fn sweep(&mut self) -> PromiseOrValue<String> {
        let now = env::block_timestamp_ms();
        if self.token.is_some() {
            if env::prepaid_gas().as_gas() < MIN_TOKEN_SWEEP_GAS_TGAS * 1_000_000_000_000 {
                env::panic_str("NEEDS_GAS");
            }
            if now < self.busy_until_ms {
                env::panic_str("PAYOUT_IN_FLIGHT");
            }
            let lock = now + BUSY_MS;
            self.busy_until_ms = lock;
            let token = self.token.clone().expect("token");
            let args = serde_json::to_vec(&FtBalanceArgs { account_id: env::current_account_id() }).expect("ft_balance_of args");
            return PromiseOrValue::Promise(
                Promise::new(token)
                    .function_call("ft_balance_of".to_string(), args, NearToken::from_yoctonear(0), Gas::from_tgas(FT_BALANCE_OF_GAS_TGAS))
                    .then(
                        Invoice::ext(env::current_account_id())
                            .with_unused_gas_weight(1)
                            .on_token_balance(U64(lock)),
                    ),
            );
        }
        if now < self.busy_until_ms {
            env::panic_str("PAYOUT_IN_FLIGHT");
        }
        match self.plan_sweep(Self::free_balance(), now) {
            SweepOutcome::Panic(s) => env::panic_str(&s),
            SweepOutcome::Pay(batch, st) => {
                self.apply(st);
                self.dispatch(batch)
            }
        }
    }

    /// The `ft_balance_of` callback of a token sweep: runs the same plan with the reported
    /// balance. Never panics (a callback must not lose the lock release).
    #[private]
    pub fn on_token_balance(&mut self, lock: U64) -> PromiseOrValue<String> {
        let now = env::block_timestamp_ms();
        // `lock` is the value `sweep` stored in `busy_until_ms`. If it changed, an `ft_transfer_call`
        // was rejected as busy while the balance was being read, so the balance may hold that
        // transfer's credit and the token is about to return it. Plan nothing.
        if self.busy_until_ms != lock.0 {
            self.busy_until_ms = 0;
            return PromiseOrValue::Value("CONCURRENT_PAYMENT".to_string());
        }
        let bal = match env::promise_result_checked(0, 128) {
            Ok(bytes) => match serde_json::from_slice::<U128>(&bytes) {
                Ok(v) => v.0,
                Err(_) => {
                    self.busy_until_ms = 0;
                    return PromiseOrValue::Value("BALANCE_UNAVAILABLE".to_string());
                }
            },
            Err(_) => {
                self.busy_until_ms = 0;
                return PromiseOrValue::Value("BALANCE_UNAVAILABLE".to_string());
            }
        };
        match self.plan_sweep(bal, now) {
            SweepOutcome::Panic(s) => {
                self.busy_until_ms = 0;
                // A callback must not panic; token callers get the short result value.
                PromiseOrValue::Value(if s.starts_with("UNDERPAID") { "UNDERPAID".to_string() } else { s })
            }
            SweepOutcome::Pay(batch, st) => {
                if env::account_balance().as_yoctonear() < batch.payouts.len() as u128 {
                    self.busy_until_ms = 0;
                    return PromiseOrValue::Value("NEEDS_YOCTO".to_string());
                }
                self.apply(st);
                self.dispatch(batch)
            }
        }
    }

    /// After the invoice's grace period, return the undelivered shares to the payer (`paid_by`)
    /// and to nobody else. Only a SETTLING invoice has undelivered settlement shares.
    pub fn refund_payer(&mut self) -> PromiseOrValue<String> {
        let now = env::block_timestamp_ms();
        let deadline = self.expires_at_ms.max(self.paid_at_ms) + self.grace_ms;
        if now <= deadline {
            env::panic_str(&format!("NOT_YET: refundable after {}", deadline));
        }
        let payer = match self.paid_by.clone() {
            Some(p) => p,
            None => env::panic_str("NO_PAYER"),
        };
        let amount = self.owed_merchant + self.owed_tax;
        if amount == 0 {
            env::panic_str("NOTHING_OWED");
        }
        if self.status != STATUS_SETTLING {
            env::panic_str("NOT_SETTLING");
        }
        if now < self.busy_until_ms {
            env::panic_str("PAYOUT_IN_FLIGHT");
        }
        let merchant_part = self.owed_merchant;
        let tax_part = self.owed_tax;
        self.owed_merchant = 0;
        self.owed_tax = 0;
        // RECLAIM is a payout from the owed ledger. The ledger is already debited (owed_merchant
        // and owed_tax are 0 above); on_settled credits owed_payer back if the payout fails, and
        // a later sweep retries it to refund_to.
        // Never redirect an owed_payer that already belongs to another account: that amount is paid
        // to its own refund_to only. A failed reclaim then reports refund_failed (unrecorded) instead.
        if self.owed_payer == 0 || self.refund_to.is_none() {
            self.refund_to = Some(payer.clone());
        }
        self.busy_until_ms = now + BUSY_MS;
        let batch = Batch { kind: KIND_RECLAIM, result: "REFUNDED".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part, tax_part, lock: true,
            payouts: vec![Payout { role: ROLE_PAYER, to: payer, amount, from_owed: true, near: false }] };
        self.dispatch(batch)
    }

    /// Accept NEAR into a token invoice so it can attach 1 yocto to every `ft_transfer`.
    #[payable]
    pub fn fund(&mut self) {
        if self.token.is_none() {
            env::panic_str("NOT_A_TOKEN_INVOICE");
        }
        if env::attached_deposit().as_yoctonear() == 0 {
            env::panic_str("NEEDS_DEPOSIT");
        }
    }

    /// The only place `invoice_paid` is emitted, after every settlement payout has been checked.
    #[private]
    pub fn on_settled(&mut self, #[serializer(borsh)] batch: Batch) -> String {
        let me = env::current_account_id();
        if batch.lock {
            self.busy_until_ms = 0;
        }
        let mut results: Vec<bool> = Vec::with_capacity(batch.payouts.len());
        for i in 0..batch.payouts.len() {
            // contract-3: success is the promise status only. A token may return a body from
            // ft_transfer (longer than any cap); `TooLong` still means the call succeeded.
            results.push(matches!(
                env::promise_result_checked(i as u64, 64),
                Ok(_) | Err(near_sdk::PromiseError::TooLong(_))
            ));
        }
        let all_ok = results.iter().all(|ok| *ok);

        // Failed payouts are credited back to their own ledger slot.
        for (p, ok) in batch.payouts.iter().zip(results.iter()) {
            if *ok {
                continue;
            }
            match p.role {
                ROLE_MERCHANT => self.owed_merchant += p.amount,
                ROLE_TAX => self.owed_tax += p.amount,
                _ => {
                    let same = self.refund_to.as_ref() == Some(&p.to);
                    if p.near && self.token.is_some() {
                        // A refund of an attached NEAR deposit on a token invoice. The owed ledger of a
                        // token invoice counts token units: recording NEAR yocto there would later be paid
                        // out as tokens (other people's parked tokens). The NEAR stays on the account.
                        self.emit_event("refund_failed", serde_json::json!({
                            "invoice_id": self.invoice_id, "account_id": me,
                            "to": p.to, "amount": p.amount.to_string(), "recorded": false,
                        }));
                    } else if self.refund_to.is_none() || same {
                        self.refund_to = Some(p.to.clone());
                        self.owed_payer += p.amount;
                    } else {
                        self.emit_event("refund_failed", serde_json::json!({
                            "invoice_id": self.invoice_id, "account_id": me,
                            "to": p.to, "amount": p.amount.to_string(), "recorded": false,
                        }));
                    }
                }
            }
            self.emit_event("transfer_failed", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me, "role": role_name(p.role),
                "to": p.to, "amount": p.amount.to_string(),
            }));
        }

        // Events of successful single-purpose payouts (and resends inside a settlement batch).
        for (p, ok) in batch.payouts.iter().zip(results.iter()) {
            if !*ok {
                continue;
            }
            if batch.kind == KIND_RECLAIM {
                self.emit_event("owed_reclaimed", serde_json::json!({
                    "invoice_id": self.invoice_id, "account_id": me, "payer": p.to, "amount": p.amount.to_string(),
                    "merchant_part": batch.merchant_part.to_string(), "tax_part": batch.tax_part.to_string(),
                }));
            } else if p.from_owed {
                let name = if p.role == ROLE_TAX { "tax_resent" } else { "owed_resent" };
                self.emit_event(name, serde_json::json!({
                    "invoice_id": self.invoice_id, "account_id": me, "amount": p.amount.to_string(), "to": p.to,
                }));
            } else if batch.kind == KIND_REFUND
                || (batch.kind == KIND_TRANSFER && batch.refund_reason == "already_funded" && p.role == ROLE_PAYER)
            {
                self.emit_event("payment_refunded", serde_json::json!({
                    "invoice_id": self.invoice_id, "account_id": me, "payer": p.to,
                    "amount": p.amount.to_string(), "reason": batch.refund_reason,
                }));
            }
        }
        if batch.kind == KIND_EXTRA && all_ok {
            let net: u128 = batch.payouts.iter().filter(|p| !p.from_owed && p.role == ROLE_MERCHANT).map(|p| p.amount).sum();
            let tax: u128 = batch.payouts.iter().filter(|p| !p.from_owed && p.role == ROLE_TAX).map(|p| p.amount).sum();
            self.emit_event("extra_swept", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me, "amount": net.to_string(), "to": self.merchant,
                "tax_amount": tax.to_string(), "tax_to": self.tax_vault,
            }));
        }

        // A settlement is PAID only once every merchant/tax share was delivered.
        let settlement_batch = batch.kind == KIND_PAY || batch.kind == KIND_TRANSFER
            || (batch.kind == KIND_RESEND && batch.payouts.iter().any(|p| p.role != ROLE_PAYER));
        if settlement_batch && self.status == STATUS_SETTLING && self.owed_merchant == 0 && self.owed_tax == 0 {
            self.status = STATUS_PAID;
            let late = env::block_timestamp_ms() > self.expires_at_ms;
            self.emit_event("invoice_paid", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me,
                "via": if self.paid_by.is_some() { "pay" } else { "transfer" },
                "payer": self.paid_by, "amount": self.paid_amount.to_string(),
                "merchant_amount": (self.paid_amount - self.tax_amount).to_string(),
                "tax_amount": self.tax_amount.to_string(),
                "excess_refunded": batch.excess.to_string(),
                "late": late, "retried": batch.kind == KIND_RESEND,
            }));
            return "PAID".to_string();
        }
        if batch.kind == KIND_RECLAIM && all_ok {
            self.status = STATUS_REFUNDED;
            return "REFUNDED".to_string();
        }
        // A retried payer refund that completes means the settlement went back to the payer.
        if batch.kind == KIND_RESEND && all_ok && self.status == STATUS_SETTLING
            && self.owed_merchant == 0 && self.owed_tax == 0 && self.owed_payer == 0
            && batch.payouts.iter().all(|p| p.role == ROLE_PAYER)
        {
            self.status = STATUS_REFUNDED;
            return "REFUNDED".to_string();
        }
        if all_ok {
            return batch.result;
        }
        match batch.kind {
            KIND_REFUND => "REFUND_FAILED".to_string(),
            KIND_RECLAIM => "RECLAIM_FAILED".to_string(),
            _ => "PAYOUT_PENDING".to_string(),
        }
    }

    /// Tax share not yet confirmed delivered to the vault.
    pub fn get_owed_tax(&self) -> U128 {
        U128(self.owed_tax)
    }

    pub fn get_invoice(&self) -> InvoiceView {
        InvoiceView {
            v: self.v,
            account_id: env::current_account_id(),
            invoice_id: self.invoice_id.clone(),
            merchant: self.merchant.clone(),
            tax_vault: self.tax_vault.clone(),
            tax_bps: self.tax_bps,
            amount: U128(self.amount),
            expires_at_ms: U64(self.expires_at_ms),
            salt: U64(self.salt),
            grace_ms: U64(self.grace_ms),
            token: self.token.clone(),
            status: status_name(self.status).to_string(),
            paid_by: self.paid_by.clone(),
            paid_at_ms: U64(self.paid_at_ms),
            paid_amount: U128(self.paid_amount),
            tax_amount: U128(self.tax_amount),
            owed_merchant: U128(self.owed_merchant),
            owed_tax: U128(self.owed_tax),
            owed_payer: U128(self.owed_payer),
            refund_to: self.refund_to.clone(),
            busy_until_ms: U64(self.busy_until_ms),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;
    use near_sdk::PromiseResult;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const SELF: &str = "0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0";
    const TOKEN: &str = "tusdc.example.testnet";
    const PAYER: &str = "payer.testnet";
    const MERCHANT: &str = "zi-merchant.testnet";
    const VAULT: &str = "zi-taxvault.testnet";
    const NOW: u64 = 1_794_000_000_000;
    const EXPIRES: u64 = 1_794_700_800_000;
    const GRACE: u64 = 604_800_000;

    const NEAR_STATE_HEX: &str = "0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a0000000000000000840c240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const TOKEN_STATE_HEX: &str = "0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e6574200340420f0000000000000000000000000000f080dca10100002a0000000000000000840c2400000000011500000074757364632e6578616d706c652e746573746e6574000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    fn example(token: Option<&str>) -> Invoice {
        Invoice {
            v: 3,
            invoice_id: "INV-0001".into(),
            merchant: MERCHANT.parse().unwrap(),
            tax_vault: VAULT.parse().unwrap(),
            tax_bps: 800,
            amount: if token.is_some() { 1_000_000 } else { ONE_NEAR },
            expires_at_ms: EXPIRES,
            salt: 42,
            grace_ms: GRACE,
            token: token.map(|t| t.parse().unwrap()),
            status: STATUS_OPEN,
            paid_by: None,
            paid_at_ms: 0,
            paid_amount: 0,
            tax_amount: 0,
            owed_merchant: 0,
            owed_tax: 0,
            owed_payer: 0,
            refund_to: None,
            busy_until_ms: 0,
        }
    }
    fn near_invoice() -> Invoice {
        example(None)
    }
    fn token_invoice() -> Invoice {
        example(Some(TOKEN))
    }

    fn ctx_at(predecessor: &str, deposit: u128, now_ms: u64, balance: u128, gas_tgas: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(SELF.parse().unwrap())
            .predecessor_account_id(predecessor.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_yoctonear(balance.saturating_sub(deposit)))
            .block_timestamp(now_ms * 1_000_000)
            .storage_usage(330)
            .prepaid_gas(Gas::from_tgas(gas_tgas));
        testing_env!(b.build());
    }
    /// `balance` is what the contract sees DURING the call: the mock's account_balance is the
    /// balance BEFORE the attached deposit, hence the subtraction (same as the v2 tests).
    fn ctx(deposit: u128, now_ms: u64, balance: u128) {
        ctx_at(PAYER, deposit, now_ms, balance, 300);
    }
    fn ctx_cb(results: Vec<PromiseResult>, now_ms: u64, balance: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(SELF.parse().unwrap())
            .predecessor_account_id(SELF.parse().unwrap())
            .account_balance(NearToken::from_yoctonear(balance))
            .block_timestamp(now_ms * 1_000_000)
            .storage_usage(330)
            .prepaid_gas(Gas::from_tgas(300));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            results
        );
    }
    fn ok() -> PromiseResult {
        PromiseResult::Successful(vec![])
    }
    /// The panic payload of a contract panic, as a string (the mock wraps it in a HostError).
    fn panic_message<F: FnOnce()>(f: F) -> String {
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).expect_err("must panic");
        if let Some(s) = err.downcast_ref::<String>() {
            s.clone()
        } else if let Some(s) = err.downcast_ref::<&str>() {
            (*s).to_string()
        } else {
            "<non-string panic>".to_string()
        }
    }

    fn transfers() -> Vec<(String, u128)> {
        let mut out = vec![];
        for r in get_created_receipts() {
            for a in r.actions {
                if let MockAction::Transfer { deposit, .. } = a {
                    out.push((r.receiver_id.to_string(), deposit.as_yoctonear()));
                }
            }
        }
        out
    }
    fn sent_to(who: &str) -> u128 {
        transfers().iter().filter(|(r, _)| r == who).map(|(_, a)| *a).sum()
    }
    fn ft_calls() -> Vec<(String, String, serde_json::Value, u128, u64)> {
        let mut out = vec![];
        for r in get_created_receipts() {
            for a in r.actions {
                if let MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, .. } = a {
                    out.push((
                        r.receiver_id.to_string(),
                        String::from_utf8(method_name).unwrap(),
                        serde_json::from_slice(&args).unwrap_or(serde_json::Value::Null),
                        attached_deposit.as_yoctonear(),
                        prepaid_gas.as_gas(),
                    ));
                }
            }
        }
        out
    }
    fn callback_calls() -> Vec<String> {
        get_created_receipts()
            .iter()
            .filter(|r| r.receiver_id.to_string() == SELF)
            .flat_map(|r| {
                r.actions.iter().filter_map(|a| match a {
                    MockAction::FunctionCallWeight { method_name, .. } => Some(String::from_utf8(method_name.clone()).unwrap()),
                    _ => None,
                })
            })
            .collect()
    }
    fn logs_with(needle: &str) -> Vec<String> {
        get_logs().into_iter().filter(|l| l.contains(needle)).collect()
    }
    fn role_of(to: &str) -> u8 {
        if to == MERCHANT {
            ROLE_MERCHANT
        } else if to == VAULT {
            ROLE_TAX
        } else {
            ROLE_PAYER
        }
    }
    fn payouts_from_transfers(from_owed: bool) -> Vec<Payout> {
        transfers()
            .into_iter()
            .map(|(to, amount)| Payout { role: role_of(&to), to: to.parse().unwrap(), amount, from_owed, near: true })
            .collect()
    }
    fn payouts_from_ft(from_owed: bool) -> Vec<Payout> {
        ft_calls()
            .into_iter()
            .filter(|(_, method, _, _, _)| method == "ft_transfer")
            .map(|(_, _, args, _, _)| {
                let to = args["receiver_id"].as_str().unwrap().to_string();
                let amount: u128 = args["amount"].as_str().unwrap().parse().unwrap();
                Payout { role: role_of(&to), to: to.parse().unwrap(), amount, from_owed, near: false }
            })
            .collect()
    }
    fn batch(kind: u8, result: &str, payouts: Vec<Payout>) -> Batch {
        Batch { kind, result: result.to_string(), late: false, excess: 0, refund_reason: String::new(),
            merchant_part: 0, tax_part: 0, lock: true, payouts }
    }
    fn refund_batch(result: &str, reason: &str, payouts: Vec<Payout>) -> Batch {
        Batch { kind: KIND_REFUND, result: result.to_string(), late: false, excess: 0, refund_reason: reason.to_string(),
            merchant_part: 0, tax_part: 0, lock: false, payouts }
    }
    fn tax_of(x: u128) -> u128 {
        x * 800 / 10_000
    }

    // ---- 1-5: layout, size, view, split ----

    #[test]
    fn state_layout_is_frozen_near() {
        let bytes = near_sdk::borsh::to_vec(&near_invoice()).unwrap();
        assert_eq!(hex::encode(&bytes), NEAR_STATE_HEX);
        assert_eq!(bytes.len(), 201);
    }

    #[test]
    fn state_layout_is_frozen_token() {
        let bytes = near_sdk::borsh::to_vec(&token_invoice()).unwrap();
        assert_eq!(hex::encode(&bytes), TOKEN_STATE_HEX);
        assert_eq!(bytes.len(), 226);
    }

    #[test]
    fn state_worst_case_fits_zero_balance_limit() {
        let long = "a".repeat(64);
        let mut inv = near_invoice();
        inv.invoice_id = "i".repeat(32);
        inv.merchant = long.parse().unwrap();
        inv.tax_vault = long.parse().unwrap();
        inv.token = Some(long.parse().unwrap());
        inv.paid_by = Some(long.parse().unwrap());
        inv.refund_to = Some(long.parse().unwrap());
        inv.status = STATUS_SETTLING;
        inv.owed_merchant = u128::MAX;
        inv.owed_tax = u128::MAX;
        inv.owed_payer = u128::MAX;
        inv.busy_until_ms = u64::MAX;
        let state = near_sdk::borsh::to_vec(&inv).unwrap().len();
        assert_eq!(state, 519, "max-length state");
        assert_eq!(state + 45 + 132, 696);
        assert!(state as u64 + 45 + 132 <= ZBA_LIMIT_BYTES, "zero-balance limit");
    }

    #[test]
    fn view_has_token_owed_busy_and_new_statuses() {
        ctx_at(PAYER, 0, NOW, 0, 300);
        let mut inv = token_invoice();
        inv.status = STATUS_SETTLING;
        inv.owed_merchant = 5;
        inv.owed_tax = 6;
        inv.owed_payer = 7;
        inv.refund_to = Some(PAYER.parse().unwrap());
        inv.busy_until_ms = 1234;
        let v = inv.get_invoice();
        assert_eq!(v.v, 3);
        assert_eq!(v.token, Some(TOKEN.parse().unwrap()));
        assert_eq!(v.grace_ms.0, GRACE);
        assert_eq!(v.status, "SETTLING");
        assert_eq!((v.owed_merchant.0, v.owed_tax.0, v.owed_payer.0), (5, 6, 7));
        assert_eq!(v.refund_to, Some(PAYER.parse().unwrap()));
        assert_eq!(v.busy_until_ms.0, 1234);
        inv.status = STATUS_REFUNDED;
        assert_eq!(inv.get_invoice().status, "REFUNDED");
        assert_eq!(inv.get_owed_tax().0, 6);
    }

    #[test]
    fn split_never_loses_a_unit() {
        let amounts = [0u128, 1, 2, 3, 7, 10, 9999, ONE_NEAR, u128::MAX / 10_000];
        for bps in [0u16, 1, 799, 800, 9999, 10_000] {
            let mut inv = near_invoice();
            inv.tax_bps = bps;
            for x in amounts {
                let (net, tax) = inv.split_of(x);
                assert_eq!(net + tax, x, "bps {bps} x {x}");
                assert_eq!(tax, x * (bps as u128) / 10_000);
            }
        }
    }

    #[test]
    fn split_does_not_overflow_for_huge_balances() {
        // A token balance (or NEAR balance) above u128::MAX / 10000 must not panic a callback.
        let mut inv = near_invoice();
        for bps in [1u16, 800, 9999, 10_000] {
            inv.tax_bps = bps;
            for x in [u128::MAX, u128::MAX - 1, u128::MAX / 3, u128::MAX / 10_000 + 1] {
                let (net, tax) = inv.split_of(x);
                assert_eq!(net + tax, x);
                let exact = (x / 10_000) * (bps as u128) + ((x % 10_000) * (bps as u128)) / 10_000;
                assert_eq!(tax, exact);
            }
        }
    }

    // ---- 6-13: NEAR pay and fix 1 ----

    #[test]
    fn pay_exact_schedules_two_transfers_and_no_event() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        let r = inv.pay();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.paid_by, Some(PAYER.parse().unwrap()));
        assert_eq!(inv.paid_amount, ONE_NEAR);
        assert_eq!(inv.tax_amount, tax_of(ONE_NEAR));
        assert_eq!(inv.busy_until_ms, NOW + BUSY_MS);
        assert_eq!(transfers(), vec![(MERCHANT.to_string(), ONE_NEAR - tax_of(ONE_NEAR)), (VAULT.to_string(), tax_of(ONE_NEAR))]);
        assert!(get_logs().is_empty(), "pay() must not emit invoice_paid");
        assert_eq!(callback_calls(), vec!["on_settled".to_string()]);
    }

    #[test]
    fn invoice_paid_only_from_callback() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.busy_until_ms, 0);
        assert_eq!(logs_with("\"event\":\"invoice_paid\"").len(), 1);
        let log = &logs_with("\"event\":\"invoice_paid\"")[0];
        assert!(log.contains("\"via\":\"pay\""));
        assert!(log.contains("\"retried\":false"));
        assert!(log.contains("\"token\":null"));
    }

    #[test]
    fn failed_merchant_no_invoice_paid() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![PromiseResult::Failed, ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAYOUT_PENDING");
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.owed_merchant, ONE_NEAR - tax_of(ONE_NEAR));
        assert_eq!(inv.owed_tax, 0);
        assert!(logs_with("\"event\":\"invoice_paid\"").is_empty());
        assert_eq!(logs_with("\"event\":\"transfer_failed\"").len(), 1);
        assert!(logs_with("\"event\":\"transfer_failed\"")[0].contains("\"role\":\"merchant\""));
    }

    #[test]
    fn failed_tax_records_owed_tax() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), PromiseResult::Failed], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAYOUT_PENDING");
        assert_eq!(inv.owed_tax, tax_of(ONE_NEAR));
        assert!(!logs_with("\"event\":\"invoice_paid\"").iter().any(|l| l.contains("invoice_paid")));
    }

    #[test]
    fn both_failed_record_both() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![PromiseResult::Failed, PromiseResult::Failed], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAYOUT_PENDING");
        assert_eq!(inv.owed_merchant, ONE_NEAR - tax_of(ONE_NEAR));
        assert_eq!(inv.owed_tax, tax_of(ONE_NEAR));
        assert_eq!(logs_with("\"event\":\"transfer_failed\"").len(), 2);
    }

    #[test]
    fn excess_refund_failure_records_owed_payer() {
        let d = ONE_NEAR * 3 / 2;
        ctx(d, NOW, d);
        let mut inv = near_invoice();
        inv.pay();
        assert_eq!(sent_to(PAYER), ONE_NEAR / 2);
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok(), PromiseResult::Failed], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID", "a failed payer refund does not hold the settlement back");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.owed_payer, ONE_NEAR / 2);
        assert_eq!(inv.refund_to, Some(PAYER.parse().unwrap()));
        assert!(logs_with("\"role\":\"payer\"").len() > 0);
    }

    fn assert_refund_path(inv: &mut Invoice, d: u128, now: u64, reason: &str, result: &str) {
        ctx(d, now, d);
        let r = inv.pay();
        assert!(matches!(r, PromiseOrValue::Promise(_)), "{result}");
        drop(r);
        assert_eq!(transfers(), vec![(PAYER.to_string(), d)], "{result}");
        assert!(get_logs().iter().all(|l| !l.contains("payment_refunded")), "event only from the callback");
        let b = refund_batch(result, reason, payouts_from_transfers(false));
        ctx_cb(vec![ok()], now + 1000, 0);
        assert_eq!(inv.on_settled(b), result);
        assert!(logs_with("\"event\":\"payment_refunded\"").len() == 1, "{result}");
        assert!(logs_with(reason).len() > 0, "{reason} in the event");
    }

    #[test]
    fn pay_refund_paths_return_deposit_via_callback() {
        let mut not_open = near_invoice();
        not_open.status = STATUS_PAID;
        assert_refund_path(&mut not_open, ONE_NEAR, NOW, "not_open", "REFUNDED_NOT_OPEN");

        let mut expired = near_invoice();
        let r = {
            ctx(ONE_NEAR, EXPIRES + 1, ONE_NEAR);
            let r = expired.pay();
            assert!(matches!(r, PromiseOrValue::Promise(_)));
            drop(r); // construct the refund promise in the pay context, before the callback env
            assert_eq!(expired.status, STATUS_EXPIRED);
            let b = refund_batch("REFUNDED_EXPIRED", "expired", payouts_from_transfers(false));
            ctx_cb(vec![ok()], EXPIRES + 2, 0);
            expired.on_settled(b)
        };
        assert_eq!(r, "REFUNDED_EXPIRED");
        assert_eq!(expired.status, STATUS_EXPIRED);

        assert_refund_path(&mut near_invoice(), ONE_NEAR / 2, NOW, "underpaid", "REFUNDED_UNDERPAID");

        let mut wrong = token_invoice();
        assert_refund_path(&mut wrong, ONE_NEAR, NOW, "wrong_asset", "REFUNDED_WRONG_ASSET");

        let mut busy = near_invoice();
        busy.busy_until_ms = NOW + 30_000;
        assert_refund_path(&mut busy, ONE_NEAR, NOW, "busy", "REFUNDED_BUSY");
    }

    #[test]
    fn failed_refund_records_owed_payer_and_returns_refund_failed() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.status = STATUS_PAID;
        inv.pay();
        let b = refund_batch("REFUNDED_NOT_OPEN", "not_open", payouts_from_transfers(false));
        ctx_cb(vec![PromiseResult::Failed], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "REFUND_FAILED");
        assert_eq!(inv.owed_payer, ONE_NEAR);
        assert_eq!(inv.refund_to, Some(PAYER.parse().unwrap()));
        assert!(logs_with("\"event\":\"payment_refunded\"").is_empty());
    }

    #[test]
    fn zero_deposit_pay_after_expiry_emits_refund_at_once() {
        ctx(0, EXPIRES + 1, 0);
        let mut inv = near_invoice();
        let r = inv.pay();
        match r {
            PromiseOrValue::Value(s) => assert_eq!(s, "REFUNDED_EXPIRED"),
            _ => panic!("a zero deposit has nothing to transfer: the value must be returned directly"),
        }
        assert_eq!(inv.status, STATUS_EXPIRED);
        assert_eq!(transfers().len(), 0);
        let ev = logs_with("\"event\":\"payment_refunded\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains("\"amount\":\"0\""));
        assert!(ev[0].contains("\"reason\":\"expired\""));
    }

    #[test]
    fn parked_covering_amount_settles_parked_and_refunds_deposit() {
        // 1 NEAR parked + 1 NEAR attached: the parked funds settle, the deposit goes back.
        ctx(ONE_NEAR, NOW, 2 * ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.paid_by, None);
        assert_eq!(inv.paid_amount, ONE_NEAR);
        assert_eq!(sent_to(MERCHANT), ONE_NEAR - tax_of(ONE_NEAR));
        assert_eq!(sent_to(VAULT), tax_of(ONE_NEAR));
        assert_eq!(sent_to(PAYER), ONE_NEAR);
        let b = batch(KIND_TRANSFER, "PAID", payouts_from_transfers(false));
        let b = Batch { refund_reason: "already_funded".to_string(), excess: ONE_NEAR, ..b };
        ctx_cb(vec![ok(), ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.status, STATUS_PAID);
        assert!(logs_with("\"reason\":\"already_funded\"").len() == 1);
        let paid = logs_with("\"event\":\"invoice_paid\"");
        assert_eq!(paid.len(), 1);
        assert!(paid[0].contains("\"via\":\"transfer\""));
        assert!(paid[0].contains("\"payer\":null"));
    }

    // ---- 14-18: fix 3 (tax) ----

    #[test]
    fn partial_parked_then_pay_then_sweep_taxes_parked() {
        let price = ONE_NEAR;
        let half = ONE_NEAR / 20; // 0.05
        ctx(price, NOW, price + half);
        let mut inv = near_invoice();
        inv.pay();
        let mut merchant_total = sent_to(MERCHANT);
        let mut tax_total = sent_to(VAULT);
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.status, STATUS_PAID);

        ctx(0, NOW + 2000, half);
        let r = inv.sweep();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        merchant_total += sent_to(MERCHANT);
        tax_total += sent_to(VAULT);
        assert_eq!(sent_to(VAULT), tax_of(half));
        assert_eq!(merchant_total, price - tax_of(price) + (half - tax_of(half)));
        assert_eq!(tax_total, tax_of(price) + tax_of(half));
        assert_eq!(tax_total, tax_of(price + half), "vault gets 8% of 0.15, never an untaxed share");
        let b = batch(KIND_EXTRA, "EXTRA_SWEPT", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 3000, 0);
        assert_eq!(inv.on_settled(b), "EXTRA_SWEPT");
        assert_eq!(inv.paid_amount, price + half);
        assert_eq!(inv.tax_amount, tax_of(price + half));
    }

    #[test]
    fn sweep_overpay_is_taxed() {
        let parked = ONE_NEAR * 3 / 2;
        ctx(0, NOW, parked);
        let mut inv = near_invoice();
        inv.sweep();
        assert_eq!(sent_to(VAULT), tax_of(parked));
        assert_eq!(sent_to(MERCHANT), parked - tax_of(parked));
        assert_eq!(inv.paid_amount, parked);
        assert_eq!(inv.tax_amount, tax_of(parked));
        let b = batch(KIND_TRANSFER, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert!(logs_with("\"late\":false").len() > 0);
    }

    #[test]
    fn extra_after_paid_is_taxed() {
        let mut inv = near_invoice();
        inv.status = STATUS_PAID;
        inv.paid_amount = ONE_NEAR;
        inv.tax_amount = tax_of(ONE_NEAR);
        let extra = ONE_NEAR / 5;
        ctx(0, NOW, extra);
        let r = inv.sweep();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(sent_to(VAULT), tax_of(extra));
        assert_eq!(sent_to(MERCHANT), extra - tax_of(extra));
        assert_eq!(inv.paid_amount, ONE_NEAR + extra);
        assert_eq!(inv.tax_amount, tax_of(ONE_NEAR) + tax_of(extra));
        let b = batch(KIND_EXTRA, "EXTRA_SWEPT", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "EXTRA_SWEPT");
        let ev = logs_with("\"event\":\"extra_swept\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains(&format!("\"tax_amount\":\"{}\"", tax_of(extra))));
    }

    #[test]
    fn expired_underpaid_release_is_taxed_pro_rata() {
        let parked = ONE_NEAR / 20;
        ctx(0, EXPIRES + 1, parked);
        let mut inv = near_invoice();
        inv.status = STATUS_EXPIRED;
        let r = inv.sweep();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(sent_to(VAULT), tax_of(parked));
        assert_eq!(sent_to(MERCHANT), parked - tax_of(parked));
        assert_eq!(inv.status, STATUS_EXPIRED);
        assert_eq!(inv.paid_amount, parked);
        assert_eq!(inv.tax_amount, tax_of(parked));
        let b = batch(KIND_EXTRA, "EXTRA_SWEPT", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], EXPIRES + 2, 0);
        assert_eq!(inv.on_settled(b), "EXTRA_SWEPT");
        assert_eq!(inv.status, STATUS_EXPIRED);
    }

    #[test]
    fn sweep_underpaid_near_panics_with_v2_string() {
        ctx(0, NOW, ONE_NEAR / 2);
        let msg = panic_message(|| { near_invoice().sweep(); });
        assert!(msg.contains("UNDERPAID: available 500000000000000000000000 < amount 1000000000000000000000000"), "{msg}");
    }

    #[test]
    fn sweep_nothing_panics_with_v2_string() {
        let mut inv = near_invoice();
        inv.status = STATUS_PAID;
        ctx(0, NOW, 0);
        let msg = panic_message(|| { inv.sweep(); });
        assert!(msg.contains("NOTHING_TO_SWEEP"), "{msg}");
    }

    // ---- 19-30: fix 2 (owed ledger) ----

    fn settling_with_owed(owed_merchant: u128, owed_tax: u128, paid_by: Option<&str>) -> Invoice {
        let mut inv = near_invoice();
        inv.status = STATUS_SETTLING;
        inv.owed_merchant = owed_merchant;
        inv.owed_tax = owed_tax;
        inv.paid_by = paid_by.map(|p| p.parse().unwrap());
        inv.paid_at_ms = NOW;
        inv.paid_amount = ONE_NEAR;
        inv.tax_amount = tax_of(ONE_NEAR);
        inv
    }

    #[test]
    fn sweep_retries_owed_merchant_to_merchant_only() {
        let net = ONE_NEAR - tax_of(ONE_NEAR);
        let mut inv = settling_with_owed(net, 0, Some(PAYER));
        ctx(0, NOW + 1000, net);
        inv.sweep();
        assert_eq!(transfers(), vec![(MERCHANT.to_string(), net)], "merchant only");
        let b = batch(KIND_RESEND, "OWED_RESENT", payouts_from_transfers(true));
        ctx_cb(vec![ok()], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.owed_merchant, 0);
        let paid = logs_with("\"event\":\"invoice_paid\"");
        assert_eq!(paid.len(), 1);
        assert!(paid[0].contains("\"retried\":true"));
    }

    #[test]
    fn sweep_retries_owed_tax_to_vault_only() {
        let tax = tax_of(ONE_NEAR);
        let mut inv = settling_with_owed(0, tax, Some(PAYER));
        ctx(0, NOW + 1000, tax);
        inv.sweep();
        assert_eq!(transfers(), vec![(VAULT.to_string(), tax)], "vault only");
        assert_eq!(sent_to(MERCHANT), 0);
        let b = batch(KIND_RESEND, "TAX_RESENT", payouts_from_transfers(true));
        ctx_cb(vec![ok()], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert!(logs_with("\"event\":\"tax_resent\"").len() == 1);
    }

    #[test]
    fn sweep_in_settling_pays_owed_only_and_holds_extras() {
        let tax = tax_of(ONE_NEAR);
        let net = ONE_NEAR - tax;
        let mut inv = settling_with_owed(net, tax, Some(PAYER));
        let extra = ONE_NEAR / 10;
        ctx(0, NOW + 1000, ONE_NEAR + extra);
        inv.sweep();
        assert_eq!(sent_to(VAULT), tax);
        assert_eq!(sent_to(MERCHANT), net);
        assert_eq!(transfers().len(), 2, "the extra 0.1 is not paid while SETTLING");
        let b = batch(KIND_RESEND, "OWED_RESENT", payouts_from_transfers(true));
        ctx_cb(vec![ok(), ok()], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.paid_amount, ONE_NEAR, "the extra is still un-swept");
    }

    #[test]
    fn sweep_pays_what_balance_allows() {
        let tax = ONE_NEAR / 200;
        let net = ONE_NEAR / 50;
        let mut inv = settling_with_owed(net, tax, Some(PAYER));
        let bal = ONE_NEAR / 50;
        ctx(0, NOW + 1000, bal);
        inv.sweep();
        assert_eq!(sent_to(VAULT), tax);
        assert_eq!(sent_to(MERCHANT), bal - tax);
        assert_eq!(inv.owed_merchant, net - (bal - tax));
        assert_eq!(inv.owed_tax, 0);
        let paid = payouts_from_transfers(true);
        let b = batch(KIND_RESEND, "OWED_RESENT", paid);
        ctx_cb(vec![ok(), ok()], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "OWED_RESENT");
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.owed_merchant, net - (bal - tax), "the rest stays owed");
    }

    #[test]
    fn failed_retry_restores_owed() {
        let net = ONE_NEAR - tax_of(ONE_NEAR);
        let mut inv = settling_with_owed(net, 0, Some(PAYER));
        ctx(0, NOW + 1000, net);
        inv.sweep();
        let b = batch(KIND_RESEND, "OWED_RESENT", payouts_from_transfers(true));
        ctx_cb(vec![PromiseResult::Failed], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "PAYOUT_PENDING");
        assert_eq!(inv.owed_merchant, net);
        assert_eq!(inv.status, STATUS_SETTLING);
    }

    #[test]
    fn refund_payer_before_grace_panics_not_yet() {
        let mut inv = settling_with_owed(ONE_NEAR / 2, 0, Some(PAYER));
        ctx(0, NOW + 1000, ONE_NEAR / 2);
        let msg = panic_message(|| { inv.refund_payer(); });
        assert!(msg.contains("NOT_YET: refundable after"), "{msg}");
    }

    fn ready_to_reclaim() -> Invoice {
        let mut inv = settling_with_owed(ONE_NEAR / 2, ONE_NEAR / 100, Some(PAYER));
        inv.expires_at_ms = NOW - 1_000_000;
        inv.paid_at_ms = NOW;
        inv.grace_ms = 60_000;
        inv
    }

    #[test]
    fn refund_payer_after_grace_pays_paid_by_only() {
        let mut inv = ready_to_reclaim();
        let amount = inv.owed_merchant + inv.owed_tax;
        let now = NOW + 60_000 + 1;
        ctx(0, now, amount);
        inv.refund_payer();
        assert_eq!(transfers(), vec![(PAYER.to_string(), amount)]);
        assert_eq!(inv.owed_merchant, 0);
        assert_eq!(inv.owed_tax, 0);
        assert_eq!(inv.status, STATUS_SETTLING);
        let b = Batch { kind: KIND_RECLAIM, result: "REFUNDED".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part: ONE_NEAR / 2, tax_part: ONE_NEAR / 100, lock: true,
            payouts: payouts_from_transfers(true) };
        ctx_cb(vec![ok()], now + 1, 0);
        assert_eq!(inv.on_settled(b), "REFUNDED");
        assert_eq!(inv.status, STATUS_REFUNDED);
        assert_eq!(inv.owed_payer, 0);
        let ev = logs_with("\"event\":\"owed_reclaimed\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains(&format!("\"merchant_part\":\"{}\"", ONE_NEAR / 2)));
    }

    #[test]
    fn refund_payer_without_paid_by_panics_no_payer() {
        let mut inv = ready_to_reclaim();
        inv.paid_by = None;
        ctx(0, NOW + 3_600_000, ONE_NEAR);
        let msg = panic_message(|| { inv.refund_payer(); });
        assert!(msg.contains("NO_PAYER"), "{msg}");
    }

    #[test]
    fn refund_payer_failure_restores_owed_payer_and_sweep_retries_it() {
        let mut inv = ready_to_reclaim();
        let amount = inv.owed_merchant + inv.owed_tax;
        let now = NOW + 60_000 + 1;
        ctx(0, now, amount);
        inv.refund_payer();
        let b = Batch { kind: KIND_RECLAIM, result: "REFUNDED".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part: ONE_NEAR / 2, tax_part: ONE_NEAR / 100, lock: true,
            payouts: payouts_from_transfers(true) };
        ctx_cb(vec![PromiseResult::Failed], now + 1, 0);
        assert_eq!(inv.on_settled(b), "RECLAIM_FAILED");
        assert_eq!(inv.owed_payer, amount);
        assert_eq!(inv.refund_to, Some(PAYER.parse().unwrap()));
        // a later sweep retries it to the payer and only to the payer
        ctx(0, now + 2, amount);
        inv.sweep();
        assert_eq!(transfers(), vec![(PAYER.to_string(), amount)]);
        let b = batch(KIND_RESEND, "OWED_RESENT", payouts_from_transfers(true));
        ctx_cb(vec![ok()], now + 3, 0);
        assert_eq!(inv.on_settled(b), "REFUNDED");
        assert_eq!(inv.status, STATUS_REFUNDED);
    }

    #[test]
    fn nobody_else_can_take_owed() {
        // merchant retry
        let net = ONE_NEAR - tax_of(ONE_NEAR);
        let mut inv = settling_with_owed(net, tax_of(ONE_NEAR), Some(PAYER));
        ctx(0, NOW + 1000, ONE_NEAR);
        inv.sweep();
        let payouts = payouts_from_transfers(true);
        for p in &payouts {
            let expect = match p.role {
                ROLE_MERCHANT => MERCHANT,
                ROLE_TAX => VAULT,
                _ => PAYER,
            };
            assert_eq!(p.to.to_string(), expect, "owed amounts go to their own recipient");
        }
        assert_eq!(payouts.len(), 2);
        // reclaim
        let mut inv = ready_to_reclaim();
        let amount = inv.owed_merchant + inv.owed_tax;
        ctx(0, NOW + 3_600_000, amount);
        inv.refund_payer();
        assert_eq!(transfers(), vec![(PAYER.to_string(), amount)], "payer only");
    }

    #[test]
    fn refund_payer_twice_second_panics_nothing_owed() {
        let mut inv = ready_to_reclaim();
        let amount = inv.owed_merchant + inv.owed_tax;
        let now = NOW + 60_000 + 1;
        ctx(0, now, amount);
        inv.refund_payer();
        let b = Batch { kind: KIND_RECLAIM, result: "REFUNDED".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part: ONE_NEAR / 2, tax_part: ONE_NEAR / 100, lock: true,
            payouts: payouts_from_transfers(true) };
        ctx_cb(vec![ok()], now + 1, 0);
        inv.on_settled(b);
        assert_eq!(inv.status, STATUS_REFUNDED);
        ctx(0, now + 2, 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| inv.refund_payer()));
        assert!(r.is_err());
    }

    #[test]
    fn refund_payer_not_settling_panics() {
        let mut inv = near_invoice();
        inv.status = STATUS_PAID;
        inv.paid_by = Some(PAYER.parse().unwrap());
        inv.paid_at_ms = 1;
        inv.grace_ms = 1;
        inv.expires_at_ms = 1;
        inv.owed_merchant = ONE_NEAR / 2; // owed from a later extra, not a settlement share
        ctx(0, NOW + 1000, ONE_NEAR);
        let msg = panic_message(|| { inv.refund_payer(); });
        assert!(msg.contains("NOT_SETTLING"), "{msg}");
    }

    #[test]
    fn refund_slot_conflict_emits_refund_failed_unrecorded() {
        let mut inv = near_invoice();
        inv.status = STATUS_SETTLING;
        inv.refund_to = Some("a.testnet".parse().unwrap());
        inv.owed_payer = 100;
        let b = refund_batch("REFUNDED_NOT_OPEN", "not_open", vec![Payout {
            role: ROLE_PAYER, to: "b.testnet".parse().unwrap(), amount: 7, from_owed: false, near: true,
        }]);
        ctx_cb(vec![PromiseResult::Failed], NOW, 0);
        inv.on_settled(b);
        assert_eq!(inv.owed_payer, 100, "the taken slot is not overwritten");
        assert_eq!(inv.refund_to, Some("a.testnet".parse().unwrap()));
        let ev = logs_with("\"event\":\"refund_failed\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains("\"recorded\":false"));
    }

    // ---- 31-32: lock ----

    #[test]
    fn sweep_while_busy_panics_in_flight() {
        let mut inv = near_invoice();
        inv.busy_until_ms = NOW + 1000;
        ctx(0, NOW, ONE_NEAR);
        let msg = panic_message(|| { inv.sweep(); });
        assert!(msg.contains("PAYOUT_IN_FLIGHT"), "{msg}");
    }

    #[test]
    fn pay_while_busy_refunds_busy() {
        let mut inv = near_invoice();
        inv.busy_until_ms = NOW + 1000;
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let r = inv.pay();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(sent_to(PAYER), ONE_NEAR);
        let b = refund_batch("REFUNDED_BUSY", "busy", payouts_from_transfers(false));
        ctx_cb(vec![ok()], NOW + 1, 0);
        assert_eq!(inv.on_settled(b), "REFUNDED_BUSY");
        assert_eq!(inv.busy_until_ms, NOW + 1000, "a refund does not clear a lock it did not take");
    }

    #[test]
    fn lock_cleared_by_on_settled() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        assert!(inv.busy_until_ms > 0);
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 1, 0);
        inv.on_settled(b);
        assert_eq!(inv.busy_until_ms, 0);
    }

    #[test]
    fn stale_lock_after_5_minutes_is_taken_over() {
        let mut inv = near_invoice();
        inv.busy_until_ms = NOW + BUSY_MS;
        ctx(0, NOW + BUSY_MS + 1, ONE_NEAR);
        let r = inv.sweep();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(inv.busy_until_ms, NOW + BUSY_MS + 1 + BUSY_MS);
    }

    #[test]
    fn no_double_tax_during_flight() {
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let mut inv = near_invoice();
        inv.pay();
        // the extra arrives while the settlement payouts are in flight: a sweep must not run
        ctx(0, NOW + 1000, ONE_NEAR);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| inv.sweep()));
        assert!(r.is_err(), "sweep while the payouts are in flight must panic");
        let b = batch(KIND_PAY, "PAID", payouts_from_transfers(false));
        ctx_cb(vec![ok(), ok()], NOW + 2000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        // after the callback the extra is taxed once
        ctx(0, NOW + 3000, ONE_NEAR / 5);
        inv.sweep();
        assert_eq!(inv.tax_amount, tax_of(ONE_NEAR) + tax_of(ONE_NEAR / 5));
    }

    // ---- 33-48: token ----

    fn accept(inv: &mut Invoice, sender: &str, amount: u128, msg: &str, balance: u128, gas: u64) -> PromiseOrValue<U128> {
        ctx_at(TOKEN, 0, NOW, balance, gas);
        inv.ft_on_transfer(sender.parse().unwrap(), U128(amount), msg.to_string())
    }
    fn rejected(v: PromiseOrValue<U128>, amount: u128) {
        match v {
            PromiseOrValue::Value(x) => assert_eq!(x.0, amount),
            _ => panic!("must reject with the unused amount"),
        }
    }

    #[test]
    fn ft_on_transfer_rejects_wrong_token_and_near_invoice() {
        let mut inv = token_invoice();
        ctx_at("other-token.testnet", 0, NOW, 1_000_000, 300);
        let r = inv.ft_on_transfer("sender.testnet".parse().unwrap(), U128(1_000_000), "{\"action\":\"pay\"}".into());
        rejected(r, 1_000_000);
        assert_eq!(inv.status, STATUS_OPEN);
        assert!(logs_with("\"reason\":\"wrong_token\"").len() == 1);

        let mut near = near_invoice();
        ctx_at(TOKEN, 0, NOW, 1_000_000, 300);
        let r = near.ft_on_transfer("sender.testnet".parse().unwrap(), U128(1_000_000), "{\"action\":\"pay\"}".into());
        rejected(r, 1_000_000);
        assert!(logs_with("\"reason\":\"wrong_token\"").len() == 1);
    }

    #[test]
    fn ft_on_transfer_bad_msg_variants() {
        let msgs = ["", "not json", "{}", "{\"action\":\"x\"}", "{\"action\":\"pay\",\"sender_id\":\"evil.testnet\"}",
            "{\"action\":\"pay\",\"amount\":\"1\"}", "{\"action\":\"pay\",\"invoice_id\":\"OTHER\"}", "{\"action\":\"Pay\"}"];
        for msg in msgs {
            let mut inv = token_invoice();
            let r = accept(&mut inv, "sender.testnet", 1_000_000, msg, 1000, 300);
            rejected(r, 1_000_000);
            assert_eq!(inv.status, STATUS_OPEN, "{msg}");
            assert_eq!(inv.paid_by, None, "{msg}");
            assert!(logs_with("\"reason\":\"bad_msg\"").len() == 1, "{msg}");
            assert_eq!(ft_calls().len(), 0, "{msg}");
        }
    }

    #[test]
    fn ft_on_transfer_not_open_expired_busy_no_yocto_low_gas_underpaid() {
        let mut not_open = token_invoice();
        not_open.status = STATUS_PAID;
        rejected(accept(&mut not_open, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300), 1_000_000);
        assert!(logs_with("\"reason\":\"not_open\"").len() == 1);

        let mut expired = token_invoice();
        ctx_at(TOKEN, 0, EXPIRES + 1, 1000, 300);
        rejected(expired.ft_on_transfer("sender.testnet".parse().unwrap(), U128(1_000_000), "{\"action\":\"pay\"}".into()), 1_000_000);
        assert_eq!(expired.status, STATUS_EXPIRED);
        assert!(logs_with("\"reason\":\"expired\"").len() == 1);

        let mut busy = token_invoice();
        busy.busy_until_ms = NOW + 1000;
        rejected(accept(&mut busy, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300), 1_000_000);
        assert!(logs_with("\"reason\":\"busy\"").len() == 1);

        let mut broke = token_invoice();
        rejected(accept(&mut broke, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 0, 300), 1_000_000);
        assert!(logs_with("\"reason\":\"no_yocto\"").len() == 1);

        let mut gasless = token_invoice();
        rejected(accept(&mut gasless, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 40), 1_000_000);
        assert!(logs_with("\"reason\":\"low_gas\"").len() == 1);

        let mut short = token_invoice();
        rejected(accept(&mut short, "sender.testnet", 999_999, "{\"action\":\"pay\"}", 1000, 300), 999_999);
        assert!(logs_with("\"reason\":\"underpaid\"").len() == 1);
        assert_eq!(short.status, STATUS_OPEN);
    }

    #[test]
    fn ft_on_transfer_exact_accepts() {
        let mut inv = token_invoice();
        let r = accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        rejected(r, 0);
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.paid_by, Some("sender.testnet".parse().unwrap()));
        assert_eq!(inv.paid_amount, 1_000_000);
        assert_eq!(inv.tax_amount, 80_000);
        let calls = ft_calls();
        let fts: Vec<_> = calls.iter().filter(|(_, m, _, _, _)| m == "ft_transfer").collect();
        assert_eq!(fts.len(), 2);
        for (to, method, args, deposit, gas) in fts {
            assert_eq!(to, TOKEN);
            assert_eq!(*deposit, 1, "ft_transfer attaches exactly 1 yocto");
            assert_eq!(*gas, 15_000_000_000_000);
            assert_eq!(method, "ft_transfer");
            assert!(args["receiver_id"].is_string());
        }
        assert_eq!(callback_calls(), vec!["on_settled".to_string()]);
        let b = batch(KIND_PAY, "PAID", payouts_from_ft(false));
        ctx_cb(vec![ok(), ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        let ev = logs_with("\"event\":\"invoice_paid\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains("\"payer\":\"sender.testnet\""));
        assert!(ev[0].contains("\"token\":\"tusdc.example.testnet\""));
    }

    #[test]
    fn ft_on_transfer_overpay_returns_excess_and_pays_price_only() {
        let mut inv = token_invoice();
        let r = accept(&mut inv, "sender.testnet", 1_500_000, "{\"action\":\"pay\",\"invoice_id\":\"INV-0001\"}", 1000, 300);
        rejected(r, 500_000);
        assert_eq!(inv.paid_amount, 1_000_000);
        let calls: Vec<_> = ft_calls().into_iter().filter(|(_, m, _, _, _)| m == "ft_transfer").collect();
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().any(|(_, _, a, _, _)| a["receiver_id"] == MERCHANT && a["amount"] == "920000"));
        assert!(calls.iter().any(|(_, _, a, _, _)| a["receiver_id"] == VAULT && a["amount"] == "80000"));
    }

    #[test]
    fn ft_on_transfer_does_not_trust_msg_fields() {
        let mut inv = token_invoice();
        // a sender_id inside msg is rejected outright
        let r = accept(&mut inv, "alice.testnet", 1_000_000, "{\"action\":\"pay\",\"sender_id\":\"bob.testnet\"}", 1000, 300);
        rejected(r, 1_000_000);
        assert_eq!(inv.paid_by, None);
        // the recorded payer is the parameter, never msg
        let r = accept(&mut inv, "alice.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        rejected(r, 0);
        assert_eq!(inv.paid_by, Some("alice.testnet".parse().unwrap()));
    }

    #[test]
    fn token_failed_merchant_unregistered_records_owed_and_no_invoice_paid() {
        let mut inv = token_invoice();
        accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        let b = batch(KIND_PAY, "PAID", payouts_from_ft(false));
        ctx_cb(vec![PromiseResult::Failed, ok()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAYOUT_PENDING");
        assert_eq!(inv.owed_merchant, 920_000);
        assert_eq!(inv.status, STATUS_SETTLING);
        assert!(logs_with("\"event\":\"invoice_paid\"").is_empty());
        assert!(logs_with("\"role\":\"merchant\"").len() == 1);
    }

    #[test]
    fn token_failed_vault_records_owed_tax() {
        let mut inv = token_invoice();
        accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        let b = batch(KIND_PAY, "PAID", payouts_from_ft(false));
        ctx_cb(vec![ok(), PromiseResult::Failed], NOW + 1000, 0);
        inv.on_settled(b);
        assert_eq!(inv.owed_tax, 80_000);
        assert_eq!(inv.get_owed_tax().0, 80_000);
    }

    #[test]
    fn token_sweep_reads_balance_then_splits() {
        let mut inv = token_invoice();
        ctx(0, NOW, 1000);
        let r = inv.sweep();
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        let calls = ft_calls();
        assert!(calls.iter().any(|(to, m, _, d, g)| to == TOKEN && m == "ft_balance_of" && *d == 0 && *g == 5_000_000_000_000));
        assert_eq!(callback_calls(), vec!["on_token_balance".to_string()]);
        assert!(inv.busy_until_ms > NOW);
        ctx_cb(vec![PromiseResult::Successful(b"\"1000000\"".to_vec())], NOW + 1, 1000);
        let r = inv.on_token_balance(U64(inv.busy_until_ms));
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        drop(r);
        assert_eq!(inv.status, STATUS_SETTLING);
        let fts: Vec<_> = ft_calls().into_iter().filter(|(_, m, _, _, _)| m == "ft_transfer").collect();
        assert_eq!(fts.len(), 2);
        assert!(fts.iter().any(|(_, _, a, d, _)| a["receiver_id"] == MERCHANT && a["amount"] == "920000" && *d == 1));
        assert!(fts.iter().any(|(_, _, a, d, _)| a["receiver_id"] == VAULT && a["amount"] == "80000" && *d == 1));
    }

    #[test]
    fn token_sweep_racing_a_busy_ft_transfer_call_plans_nothing() {
        // sweep -> ft_on_transfer (rejected busy, the token refunds it) -> on_token_balance whose
        // balance read already holds the in-flight credit. It must not plan or enter SETTLING.
        let mut inv = token_invoice();
        ctx(0, NOW, 1000);
        drop(inv.sweep());
        let lock = inv.busy_until_ms;
        assert_eq!(lock, NOW + BUSY_MS);
        let r = accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        rejected(r, 1_000_000);
        assert!(logs_with("\"reason\":\"busy\"").len() == 1);
        assert_ne!(inv.busy_until_ms, lock, "the busy rejection changes the lock value");
        let before = ft_calls().len();
        ctx_cb(vec![PromiseResult::Successful(b"\"1000000\"".to_vec())], NOW + 1, 1000);
        match inv.on_token_balance(U64(lock)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "CONCURRENT_PAYMENT"),
            _ => panic!("must not schedule payouts"),
        }
        assert_eq!(inv.status, STATUS_OPEN, "the invoice stays open for a retry");
        assert_eq!(inv.busy_until_ms, 0);
        assert_eq!(inv.owed_merchant + inv.owed_tax, 0);
        assert_eq!(inv.paid_by, None);
        assert_eq!(ft_calls().len(), before, "no ft_transfer was created");
        // the retry is accepted now
        let r = accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        rejected(r, 0);
        assert_eq!(inv.status, STATUS_SETTLING);
    }

    #[test]
    fn token_sweep_balance_failure_clears_lock_returns_balance_unavailable() {
        let mut inv = token_invoice();
        inv.busy_until_ms = NOW + BUSY_MS;
        ctx_cb(vec![PromiseResult::Failed], NOW + 1, 1000);
        match inv.on_token_balance(U64(inv.busy_until_ms)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "BALANCE_UNAVAILABLE"),
            _ => panic!(),
        }
        assert_eq!(inv.busy_until_ms, 0);
    }

    #[test]
    fn token_sweep_underpaid_returns_value_and_clears_lock() {
        let mut inv = token_invoice();
        inv.busy_until_ms = NOW + BUSY_MS;
        ctx_cb(vec![PromiseResult::Successful(b"\"500000\"".to_vec())], NOW + 1, 1000);
        match inv.on_token_balance(U64(inv.busy_until_ms)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "UNDERPAID"),
            _ => panic!(),
        }
        assert_eq!(inv.busy_until_ms, 0);
        assert_eq!(ft_calls().len(), 0);
    }

    #[test]
    fn token_sweep_nothing_returns_value() {
        let mut inv = token_invoice();
        inv.status = STATUS_PAID;
        inv.busy_until_ms = NOW + BUSY_MS;
        ctx_cb(vec![PromiseResult::Successful(b"\"0\"".to_vec())], NOW + 1, 1000);
        match inv.on_token_balance(U64(inv.busy_until_ms)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "NOTHING_TO_SWEEP"),
            _ => panic!(),
        }
        assert_eq!(inv.busy_until_ms, 0);
    }

    #[test]
    fn token_sweep_needs_yocto_when_no_float() {
        let mut inv = token_invoice();
        inv.busy_until_ms = NOW + BUSY_MS;
        ctx_cb(vec![PromiseResult::Successful(b"\"1000000\"".to_vec())], NOW + 1, 0);
        match inv.on_token_balance(U64(inv.busy_until_ms)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "NEEDS_YOCTO"),
            _ => panic!(),
        }
        assert_eq!(inv.busy_until_ms, 0);
        assert_eq!(inv.status, STATUS_OPEN, "nothing was settled");
        assert_eq!(ft_calls().len(), 0);
    }

    #[test]
    fn token_sweep_needs_gas_panics() {
        let mut inv = token_invoice();
        ctx_at(PAYER, 0, NOW, 1000, 100);
        let msg = panic_message(|| { inv.sweep(); });
        assert!(msg.contains("NEEDS_GAS"), "{msg}");
    }

    #[test]
    fn token_double_claim_second_sweep_nothing_to_sweep() {
        let mut inv = token_invoice();
        inv.status = STATUS_PAID;
        ctx_cb(vec![PromiseResult::Successful(b"\"0\"".to_vec())], NOW + 1, 1000);
        match inv.on_token_balance(U64(inv.busy_until_ms)) {
            PromiseOrValue::Value(s) => assert_eq!(s, "NOTHING_TO_SWEEP"),
            _ => panic!(),
        }
    }

    #[test]
    fn token_second_ft_on_transfer_after_accept_returns_not_open() {
        let mut inv = token_invoice();
        accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        let r = accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        rejected(r, 1_000_000);
        assert!(logs_with("\"reason\":\"not_open\"").len() == 1);
    }

    #[test]
    fn token_refund_payer_ft_transfer_to_paid_by() {
        let mut inv = token_invoice();
        inv.status = STATUS_SETTLING;
        inv.owed_merchant = 920_000;
        inv.owed_tax = 80_000;
        inv.paid_by = Some(PAYER.parse().unwrap());
        inv.paid_at_ms = NOW;
        inv.grace_ms = 60_000;
        inv.expires_at_ms = NOW - 1;
        let now = NOW + 60_001;
        ctx(0, now, 1000);
        inv.refund_payer();
        let fts: Vec<_> = ft_calls().into_iter().filter(|(_, m, _, _, _)| m == "ft_transfer").collect();
        assert_eq!(fts.len(), 1);
        assert_eq!(fts[0].0, TOKEN);
        assert_eq!(fts[0].2["receiver_id"], PAYER);
        assert_eq!(fts[0].2["amount"], "1000000");
        assert_eq!(fts[0].3, 1);
        let b = Batch { kind: KIND_RECLAIM, result: "REFUNDED".to_string(), late: false, excess: 0,
            refund_reason: String::new(), merchant_part: 920_000, tax_part: 80_000, lock: true,
            payouts: payouts_from_ft(true) };
        ctx_cb(vec![ok()], now + 1, 0);
        assert_eq!(inv.on_settled(b), "REFUNDED");
        assert_eq!(inv.status, STATUS_REFUNDED);
    }

    #[test]
    fn fund_rejects_a_near_invoice() {
        ctx(1000, NOW, 1000);
        let msg = panic_message(|| { near_invoice().fund(); });
        assert!(msg.contains("NOT_A_TOKEN_INVOICE"), "{msg}");
    }

    #[test]
    fn fund_needs_deposit() {
        ctx(0, NOW, 0);
        let msg = panic_message(|| { token_invoice().fund(); });
        assert!(msg.contains("NEEDS_DEPOSIT"), "{msg}");
    }

    #[test]
    fn fund_accepts_a_deposit_into_a_token_invoice() {
        let mut inv = token_invoice();
        ctx(1000, NOW, 1000);
        inv.fund();
        assert_eq!(get_logs().len(), 0);
    }

    #[test]
    fn pay_on_token_invoice_refunds_near_wrong_asset() {
        let mut inv = token_invoice();
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        let r = inv.pay();
        drop(r);
        assert_eq!(transfers(), vec![(PAYER.to_string(), ONE_NEAR)]);
        let b = refund_batch("REFUNDED_WRONG_ASSET", "wrong_asset", payouts_from_transfers(false));
        ctx_cb(vec![ok()], NOW + 1, 0);
        assert_eq!(inv.on_settled(b), "REFUNDED_WRONG_ASSET");
        assert_eq!(inv.status, STATUS_OPEN);
    }

    #[test]
    fn failed_near_refund_on_token_invoice_is_not_recorded_as_owed_tokens() {
        // pay() with NEAR on a token invoice is refunded in NEAR; if that refund fails, the NEAR amount
        // must not enter the token-unit ledger (a later sweep would pay it out as tokens).
        let mut inv = token_invoice();
        ctx(ONE_NEAR, NOW, ONE_NEAR);
        drop(inv.pay());
        let b = refund_batch("REFUNDED_WRONG_ASSET", "wrong_asset", payouts_from_transfers(false));
        ctx_cb(vec![PromiseResult::Failed], NOW + 1, 0);
        assert_eq!(inv.on_settled(b), "REFUND_FAILED");
        assert_eq!(inv.owed_payer, 0);
        assert_eq!(inv.refund_to, None);
        let ev = logs_with("\"event\":\"refund_failed\"");
        assert_eq!(ev.len(), 1);
        assert!(ev[0].contains("\"recorded\":false"));
        // a token sweep over parked tokens pays only the merchant and the vault
        ctx_at(PAYER, 0, NOW + 2, 1_000, 300);
        drop(inv.sweep());
        ctx_cb(vec![PromiseResult::Successful(b"\"1000000\"".to_vec())], NOW + 3, 1_000);
        drop(inv.on_token_balance(U64(inv.busy_until_ms)));
        let to: Vec<String> = payouts_from_ft(false).into_iter().map(|p| p.to.to_string()).collect();
        assert_eq!(to, vec![MERCHANT.to_string(), VAULT.to_string()]);
    }

    #[test]
    fn refund_payer_does_not_redirect_an_owed_payer_of_another_account() {
        let mut inv = ready_to_reclaim();
        inv.owed_payer = 5;
        inv.refund_to = Some("other.testnet".parse().unwrap());
        let now = NOW + 60_000 + 1;
        ctx(0, now, ONE_NEAR);
        drop(inv.refund_payer());
        assert_eq!(inv.refund_to, Some("other.testnet".parse().unwrap()), "the owed_payer slot keeps its own recipient");
        assert_eq!(inv.owed_payer, 5);
    }

    #[test]
    fn token_split_uses_same_tax_rule() {
        let mut near = near_invoice();
        let mut tok = token_invoice();
        for x in [1u128, 7, 1_000_000, 123_456_789] {
            assert_eq!(near.split_of(x), tok.split_of(x));
        }
        tok.amount = 1_000_000;
        assert_eq!(tok.split(), (920_000, 80_000));
        near.amount = 1_000_000;
        assert_eq!(near.split(), (920_000, 80_000));
    }

    // ---- audit contract-1..4 (contract v3.2) ----

    /// Starts a token sweep (takes the lock), then delivers `ft_on_transfer(msg)` from the token at
    /// `at_ms`, then runs the balance callback with a balance that holds the (soon refunded) credit.
    fn race_sweep_with_ft_call(mut inv: Invoice, msg: &str, at_ms: u64, parked: u128, credit: u128) -> (Invoice, String) {
        ctx(0, NOW, 1000);
        drop(inv.sweep());
        let lock = inv.busy_until_ms;
        assert_eq!(lock, NOW + BUSY_MS);
        ctx_at(TOKEN, 0, at_ms, 1000, 300);
        rejected(inv.ft_on_transfer("sender.testnet".parse().unwrap(), U128(credit), msg.to_string()), credit);
        let before = ft_calls().len();
        let bal = format!("\"{}\"", parked + credit);
        ctx_cb(vec![PromiseResult::Successful(bal.into_bytes())], at_ms + 1, 1000);
        let out = match inv.on_token_balance(U64(lock)) {
            PromiseOrValue::Value(s) => s,
            _ => panic!("a balance read that holds a refunded credit must not plan payouts"),
        };
        assert_eq!(ft_calls().len(), before, "no ft_transfer was created");
        assert_eq!(inv.busy_until_ms, 0, "the lock is released");
        (inv, out)
    }

    #[test]
    fn token_sweep_racing_a_bad_msg_ft_transfer_call_plans_nothing() {
        let (inv, out) = race_sweep_with_ft_call(token_invoice(), "junk", NOW + 1, 0, 1_000_000);
        assert_eq!(out, "CONCURRENT_PAYMENT");
        assert_eq!(inv.status, STATUS_OPEN);
        assert_eq!(inv.owed_merchant + inv.owed_tax, 0, "no phantom owed ledger");
        assert_eq!(inv.paid_by, None);
    }

    #[test]
    fn token_sweep_racing_a_bad_msg_with_parked_funds_does_not_let_merchant_take_the_tax() {
        // outcome B of the audit: 1,000,000 parked, junk credit 86,956 about to be pulled back.
        let (inv, out) = race_sweep_with_ft_call(token_invoice(), "junk", NOW + 1, 1_000_000, 86_956);
        assert_eq!(out, "CONCURRENT_PAYMENT");
        assert_eq!(inv.status, STATUS_OPEN);
        assert_eq!(inv.owed_merchant + inv.owed_tax, 0);
    }

    #[test]
    fn token_sweep_racing_a_not_open_ft_transfer_call_plans_nothing() {
        let mut inv = token_invoice();
        inv.status = STATUS_PAID;
        let (inv, out) = race_sweep_with_ft_call(inv, "{\"action\":\"pay\"}", NOW + 1, 0, 500_000);
        assert_eq!(out, "CONCURRENT_PAYMENT");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.paid_amount, 0);
    }

    #[test]
    fn token_sweep_racing_an_expired_ft_transfer_call_plans_nothing() {
        let mut inv = token_invoice();
        inv.expires_at_ms = NOW + 1000;
        let (inv, out) = race_sweep_with_ft_call(inv, "{\"action\":\"pay\"}", NOW + 2000, 0, 1_000_000);
        assert_eq!(out, "CONCURRENT_PAYMENT");
        assert_eq!(inv.status, STATUS_EXPIRED, "the expiry flip persists");
        assert_eq!(inv.owed_merchant + inv.owed_tax, 0);
        assert_eq!(inv.paid_amount, 0);
    }

    #[test]
    fn token_sweep_racing_a_wrong_sender_hook_is_not_disturbed() {
        // wrong_token (a call from some other contract) never touches the lock: only the invoice's
        // own token can have credited this account.
        let mut inv = token_invoice();
        ctx(0, NOW, 1000);
        drop(inv.sweep());
        let lock = inv.busy_until_ms;
        ctx_at("other.testnet", 0, NOW + 1, 1000, 300);
        rejected(inv.ft_on_transfer("s.testnet".parse().unwrap(), U128(5), "junk".into()), 5);
        assert_eq!(inv.busy_until_ms, lock);
    }

    #[test]
    fn ft_on_transfer_rejection_without_a_lock_leaves_the_lock_alone() {
        let mut inv = token_invoice();
        rejected(accept(&mut inv, "sender.testnet", 1_000_000, "junk", 1000, 300), 1_000_000);
        assert_eq!(inv.busy_until_ms, 0);
    }

    #[test]
    fn on_settled_treats_a_long_ft_transfer_result_as_success() {
        // contract-3: a token whose ft_transfer returns a body longer than 64 bytes still succeeded.
        let mut inv = token_invoice();
        accept(&mut inv, "sender.testnet", 1_000_000, "{\"action\":\"pay\"}", 1000, 300);
        let b = batch(KIND_PAY, "PAID", payouts_from_ft(false));
        let long = || PromiseResult::Successful(vec![b'x'; 500]);
        ctx_cb(vec![long(), long()], NOW + 1000, 0);
        assert_eq!(inv.on_settled(b), "PAID");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.owed_merchant + inv.owed_tax, 0, "nothing is recorded as owed");
    }

    #[test]
    fn expired_unpaid_partial_release_then_full_payment_still_settles_as_paid() {
        // contract-2: a 1-unit sweep after expiry must not disable late settlement.
        let mut inv = token_invoice();
        inv.status = STATUS_EXPIRED;
        match inv.plan_sweep(1, EXPIRES + 10) {
            SweepOutcome::Pay(b, st) => {
                assert_eq!(b.kind, KIND_EXTRA);
                inv.apply(st);
            }
            _ => panic!("the 1-unit release must be planned"),
        }
        assert_eq!(inv.paid_amount, 1);
        assert_eq!(inv.paid_at_ms, 0, "a release is not a settlement");
        match inv.plan_sweep(1_000_000, EXPIRES + 20) {
            SweepOutcome::Pay(b, st) => {
                assert_eq!(b.kind, KIND_TRANSFER, "the full payment is a settlement, not an extra");
                assert!(b.late);
                inv.apply(st);
            }
            _ => panic!("must settle"),
        }
        assert_eq!(inv.status, STATUS_SETTLING);
        assert_eq!(inv.paid_amount, 1_000_001, "running total of everything delivered");
        assert_eq!(inv.tax_amount, tax_of(1) + tax_of(1_000_000));
    }

    #[test]
    fn expired_open_partial_tokens_are_released_by_sweep_alone() {
        // contract-4: the invoice is still OPEN in storage but past its expiry.
        let inv = token_invoice();
        assert_eq!(inv.status, STATUS_OPEN);
        match inv.plan_sweep(500_000, EXPIRES + 1) {
            SweepOutcome::Pay(b, st) => {
                assert_eq!(b.kind, KIND_EXTRA);
                assert_eq!(st.status, STATUS_EXPIRED, "the same sweep flags the expiry");
                assert_eq!(st.paid_amount, 500_000);
                let total: u128 = b.payouts.iter().map(|p| p.amount).sum();
                assert_eq!(total, 500_000);
            }
            _ => panic!("expired parked tokens must be released"),
        }
        // not yet expired: still UNDERPAID
        match inv.plan_sweep(500_000, EXPIRES) {
            SweepOutcome::Panic(s) => assert!(s.starts_with("UNDERPAID")),
            _ => panic!("an unexpired partial stays UNDERPAID"),
        }
    }
}
