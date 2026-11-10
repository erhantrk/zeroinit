//! ZeroInit invoice contract. One instance = one invoice = one `0u` universal account.
//! The instance never has an init method: its whole state (key "STATE") is written by the
//! protocol's UniversalStateInit action from the invoice terms. See INTERFACES.md §2.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_PAID: u8 = 1;
pub const STATUS_EXPIRED: u8 = 2;
pub const ZBA_LIMIT_BYTES: u64 = 770;

/// Borsh layout is FROZEN (INTERFACES.md §2.1). Field order matters. Do not reorder.
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
    pub status: u8,
    pub paid_by: Option<AccountId>,
    pub paid_at_ms: u64,
    pub paid_amount: u128,
    pub tax_amount: u128,
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
    pub status: String,
    pub paid_by: Option<AccountId>,
    pub paid_at_ms: U64,
    pub paid_amount: U128,
    pub tax_amount: U128,
}

fn status_name(s: u8) -> &'static str {
    match s {
        STATUS_OPEN => "OPEN",
        STATUS_PAID => "PAID",
        STATUS_EXPIRED => "EXPIRED",
        _ => "UNKNOWN",
    }
}

fn emit(event: &str, data: serde_json::Value) {
    let ev = serde_json::json!({
        "standard": "zeroinit",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", ev));
}

/// Storage key of the "tax not yet confirmed delivered" counter (u128, little endian).
/// It lives OUTSIDE the frozen borsh state ("STATE") so the TS client's state layout and
/// account-id derivation are unchanged. The key is absent while the counter is 0.
const OWED_TAX_KEY: &[u8] = b"OWED_TAX";
const CALLBACK_GAS_TGAS: u64 = 10;
/// Callback roles (borsh-encoded callback args keep the wasm small: no serde_json parser).
pub const ROLE_MERCHANT: u8 = 0;
pub const ROLE_TAX: u8 = 1;

fn owed_tax() -> u128 {
    match env::storage_read(OWED_TAX_KEY) {
        Some(b) if b.len() == 16 => {
            let mut a = [0u8; 16];
            a.copy_from_slice(&b);
            u128::from_le_bytes(a)
        }
        _ => 0,
    }
}

fn set_owed_tax(v: u128) {
    if v == 0 {
        env::storage_remove(OWED_TAX_KEY);
    } else {
        env::storage_write(OWED_TAX_KEY, &v.to_le_bytes());
    }
}

/// Plain detached transfer, used for payer refunds (no record is kept for those).
fn send(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(yocto)).detach();
    }
}

/// Transfer with a `on_transfer` callback so a failure is observed and recorded.
fn send_tracked(to: &AccountId, yocto: u128, role: u8) {
    if yocto > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(yocto))
            .then(
                Invoice::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(CALLBACK_GAS_TGAS))
                    .on_transfer(role, yocto),
            )
            .detach();
    }
}

impl Invoice {
    fn split_of(&self, x: u128) -> (u128, u128) {
        let tax = x * (self.tax_bps as u128) / 10_000u128;
        (x - tax, tax)
    }
    fn split(&self) -> (u128, u128) {
        self.split_of(self.amount)
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

    /// Pay `tax` to the vault and record it as owed until the callback confirms delivery.
    fn send_tax(&self, tax: u128, already_owed: bool) {
        if tax == 0 {
            return;
        }
        if !already_owed {
            set_owed_tax(owed_tax() + tax);
        }
        send_tracked(&self.tax_vault, tax, ROLE_TAX);
    }

    /// Settle `avail` parked funds as a transfer payment (split, PAID). Shared by sweep() and
    /// pay() (contract-3). Never routes the tax share to the merchant.
    fn settle_parked(&mut self, avail: u128, now: u64) -> String {
        let me = env::current_account_id();
        let (_, tax) = self.split();
        let net = avail - tax; // overpayment goes to the merchant (payer unknown)
        send_tracked(&self.merchant, net, ROLE_MERCHANT);
        self.send_tax(tax, false);
        self.status = STATUS_PAID;
        self.paid_by = None;
        self.paid_at_ms = now;
        self.paid_amount = avail;
        self.tax_amount = tax;
        emit("invoice_paid", serde_json::json!({
            "invoice_id": self.invoice_id, "account_id": me, "via": "transfer",
            "payer": null, "amount": avail.to_string(),
            "merchant_amount": net.to_string(), "tax_amount": tax.to_string(),
            "excess_refunded": "0", "late": now > self.expires_at_ms,
        }));
        "PAID".to_string()
    }
}

#[near]
impl Invoice {
    /// Pay with an attached deposit. Never panics on business rules: it refunds instead,
    /// so the account still materializes and the refund is auditable on-chain.
    #[payable]
    pub fn pay(&mut self) -> String {
        let d = env::attached_deposit().as_yoctonear();
        let payer = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let me = env::current_account_id();
        let refund = |reason: &str| {
            send(&payer, d);
            emit("payment_refunded", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me, "payer": payer,
                "amount": d.to_string(), "reason": reason,
            }));
        };
        if self.status != STATUS_OPEN {
            refund("not_open");
            return "REFUNDED_NOT_OPEN".to_string();
        }
        if now > self.expires_at_ms {
            refund("expired");
            self.status = STATUS_EXPIRED;
            return "REFUNDED_EXPIRED".to_string();
        }
        // contract-3: funds already parked by a plain transfer cover the amount. Settle them
        // exactly like sweep() and give the attached deposit back in full (no double charge).
        let parked = Self::free_balance().saturating_sub(d);
        if parked >= self.amount {
            refund("already_funded");
            return self.settle_parked(parked, now);
        }
        if d < self.amount {
            refund("underpaid");
            return "REFUNDED_UNDERPAID".to_string();
        }
        let (net, tax) = self.split();
        let excess = d - self.amount;
        send_tracked(&self.merchant, net, ROLE_MERCHANT);
        self.send_tax(tax, false);
        send(&payer, excess);
        self.status = STATUS_PAID;
        self.paid_by = Some(payer.clone());
        self.paid_at_ms = now;
        self.paid_amount = self.amount;
        self.tax_amount = tax;
        emit("invoice_paid", serde_json::json!({
            "invoice_id": self.invoice_id, "account_id": me, "via": "pay",
            "payer": payer, "amount": self.amount.to_string(),
            "merchant_amount": net.to_string(), "tax_amount": tax.to_string(),
            "excess_refunded": excess.to_string(), "late": false,
        }));
        "PAID".to_string()
    }

    /// Settle funds that arrived by plain transfer (exchange / any wallet). Anyone may call.
    /// Panics (whole receipt reverts, funds stay parked) if there is nothing valid to do.
    pub fn sweep(&mut self) -> String {
        let avail = Self::free_balance();
        let now = env::block_timestamp_ms();
        let me = env::current_account_id();
        // contract-1: an EXPIRED invoice that was never paid (paid_amount == 0) still owes the
        // tax share on funds that arrive by transfer, exactly like an OPEN one (late = true).
        if self.status == STATUS_OPEN || (self.status == STATUS_EXPIRED && self.paid_amount == 0) {
            if avail >= self.amount {
                return self.settle_parked(avail, now);
            }
            if self.status == STATUS_OPEN {
                env::panic_str(&format!("UNDERPAID: available {} < amount {}", avail, self.amount));
            }
            // EXPIRED and underpaid: nothing can complete the payment any more, so release the
            // funds, but still pro rata: tax_bps of them go to the vault, never to the merchant.
            if avail == 0 {
                env::panic_str("NOTHING_TO_SWEEP");
            }
            let (net, tax) = self.split_of(avail);
            send_tracked(&self.merchant, net, ROLE_MERCHANT);
            self.send_tax(tax, false);
            emit("extra_swept", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me,
                "amount": net.to_string(), "to": self.merchant,
                "tax_amount": tax.to_string(), "tax_to": self.tax_vault,
            }));
            return "EXTRA_SWEPT".to_string();
        }
        if avail == 0 {
            env::panic_str("NOTHING_TO_SWEEP");
        }
        // contract-2: a tax transfer that failed (or is unconfirmed) is owed to the vault. Funds
        // that bounced back to this account are re-sent to the vault first, never to the merchant.
        let owed = owed_tax();
        let retry = owed.min(avail);
        let rest = avail - retry;
        if retry > 0 {
            self.send_tax(retry, true);
            emit("tax_resent", serde_json::json!({
                "invoice_id": self.invoice_id, "account_id": me,
                "amount": retry.to_string(), "to": self.tax_vault,
            }));
        }
        if rest == 0 {
            return "TAX_RESENT".to_string();
        }
        send_tracked(&self.merchant, rest, ROLE_MERCHANT);
        emit("extra_swept", serde_json::json!({
            "invoice_id": self.invoice_id, "account_id": me,
            "amount": rest.to_string(), "to": self.merchant,
        }));
        "EXTRA_SWEPT".to_string()
    }

    /// Callback of every tracked transfer. A success confirms delivery (tax: clears the owed
    /// counter). A failure keeps the tax owed so the next sweep() re-sends it to the vault only,
    /// and emits `transfer_failed`, which supersedes the optimistic `invoice_paid` amounts.
    #[private]
    pub fn on_transfer(&mut self, #[serializer(borsh)] role: u8, #[serializer(borsh)] amount: u128) {
        let me = env::current_account_id();
        let ok = matches!(env::promise_result_checked(0, 64), Ok(_));
        if ok {
            if role == ROLE_TAX {
                set_owed_tax(owed_tax().saturating_sub(amount));
            }
            return;
        }
        let to = if role == ROLE_TAX { &self.tax_vault } else { &self.merchant };
        emit("transfer_failed", serde_json::json!({
            "invoice_id": self.invoice_id, "account_id": me,
            "role": if role == ROLE_TAX { "tax" } else { "merchant" },
            "to": to, "amount": amount.to_string(),
        }));
    }

    /// Tax share not yet confirmed delivered to the vault (in flight, or failed and awaiting a sweep).
    pub fn get_owed_tax(&self) -> U128 {
        U128(owed_tax())
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
            status: status_name(self.status).to_string(),
            paid_by: self.paid_by.clone(),
            paid_at_ms: U64(self.paid_at_ms),
            paid_amount: U128(self.paid_amount),
            tax_amount: U128(self.tax_amount),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const STATE_HEX: &str = "0108000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    fn example() -> Invoice {
        Invoice {
            v: 1,
            invoice_id: "INV-0001".into(),
            merchant: "zi-merchant.testnet".parse().unwrap(),
            tax_vault: "zi-taxvault.testnet".parse().unwrap(),
            tax_bps: 800,
            amount: ONE_NEAR,
            expires_at_ms: 1_794_700_800_000,
            salt: 42,
            status: STATUS_OPEN,
            paid_by: None,
            paid_at_ms: 0,
            paid_amount: 0,
            tax_amount: 0,
        }
    }

    /// `balance` is the account balance the contract sees DURING the call, i.e. it already
    /// includes the attached deposit (the real runtime adds the deposit before execution; the
    /// mock's `account_balance` is the balance BEFORE the deposit, hence the subtraction).
    fn ctx(deposit: u128, now_ms: u64, balance: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("payer.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_yoctonear(balance.saturating_sub(deposit)))
            .block_timestamp(now_ms * 1_000_000)
            .storage_usage(330);
        testing_env!(b.build());
    }

    #[test]
    fn state_layout_is_frozen() {
        let bytes = near_sdk::borsh::to_vec(&example()).unwrap();
        assert_eq!(hex::encode(&bytes), STATE_HEX);
        assert_eq!(bytes.len(), 135);
    }

    #[test]
    fn pay_exact_splits_92_8() {
        ctx(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.pay(), "PAID");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.tax_amount, ONE_NEAR / 100 * 8);
        let logs = get_logs();
        assert!(logs[0].starts_with("EVENT_JSON:"));
        assert!(logs[0].contains("\"merchant_amount\":\"920000000000000000000000\""));
    }

    #[test]
    fn pay_underpaid_refunds_and_stays_open() {
        ctx(ONE_NEAR / 2, 1_794_000_000_000, ONE_NEAR / 2);
        let mut inv = example();
        assert_eq!(inv.pay(), "REFUNDED_UNDERPAID");
        assert_eq!(inv.status, STATUS_OPEN);
    }

    #[test]
    fn pay_expired_refunds_and_marks_expired() {
        ctx(ONE_NEAR, 1_794_700_800_001, ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.pay(), "REFUNDED_EXPIRED");
        assert_eq!(inv.status, STATUS_EXPIRED);
    }

    #[test]
    fn pay_twice_refunds_second() {
        ctx(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        inv.pay();
        // second transaction: a fresh context (the first pay() already spent the mock balance)
        ctx(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        assert_eq!(inv.pay(), "REFUNDED_NOT_OPEN");
    }

    #[test]
    fn sweep_after_plain_transfer() {
        ctx(0, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.sweep(), "PAID");
        assert_eq!(inv.paid_by, None);
        assert_eq!(inv.paid_amount, ONE_NEAR);
    }

    #[test]
    fn sweep_paid_with_extra_sweeps_to_merchant() {
        ctx(0, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        inv.status = STATUS_PAID;
        inv.paid_amount = ONE_NEAR;
        assert_eq!(inv.sweep(), "EXTRA_SWEPT");
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.paid_amount, ONE_NEAR);
        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("EVENT_JSON:"));
        assert!(logs[0].contains("\"event\":\"extra_swept\""));
        assert!(logs[0].contains("\"amount\":\"1000000000000000000000000\""));
        assert!(logs[0].contains("\"to\":\"zi-merchant.testnet\""));
    }

    #[test]
    #[should_panic(expected = "UNDERPAID")]
    fn sweep_underpaid_panics() {
        ctx(0, 1_794_000_000_000, ONE_NEAR / 2);
        example().sweep();
    }

    // ---- v2 audit regression tests (each fails on v1) ----

    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    use near_sdk::{PromiseResult};

    /// Sum of plain Transfer actions per receiver among the receipts created so far.
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

    fn reset_storage_env(deposit: u128, now_ms: u64, balance: u128) {
        ctx(deposit, now_ms, balance);
        env::storage_remove(OWED_TAX_KEY);
    }

    /// contract-1: parked funds, zero-deposit pay() after expiry flips EXPIRED, then sweep().
    #[test]
    fn audit_contract_1_expired_sweep_still_pays_tax_vault() {
        let late = 1_794_700_800_001;
        reset_storage_env(0, late, ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.pay(), "REFUNDED_EXPIRED");
        assert_eq!(inv.status, STATUS_EXPIRED);
        reset_storage_env(0, late + 1000, ONE_NEAR);
        inv.sweep();
        let tax = ONE_NEAR / 100 * 8;
        assert_eq!(sent_to("zi-taxvault.testnet"), tax);
        assert_eq!(sent_to("zi-merchant.testnet"), ONE_NEAR - tax);
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.paid_amount, ONE_NEAR);
        assert_eq!(inv.tax_amount, tax);
        assert!(get_logs().iter().any(|l| l.contains("\"late\":true")));
    }

    /// contract-1, underpaid variant: EXPIRED + less than amount parked: merchant never gets the tax share.
    #[test]
    fn audit_contract_1_expired_underpaid_sweep_keeps_tax_share() {
        let late = 1_794_700_800_001;
        reset_storage_env(0, late, ONE_NEAR / 2);
        let mut inv = example();
        inv.status = STATUS_EXPIRED;
        assert_eq!(inv.sweep(), "EXTRA_SWEPT");
        assert_eq!(sent_to("zi-taxvault.testnet"), ONE_NEAR / 2 / 100 * 8);
        assert_eq!(sent_to("zi-merchant.testnet"), ONE_NEAR / 2 / 100 * 92);
        assert_eq!(inv.status, STATUS_EXPIRED);
    }

    /// contract-3: 1 NEAR parked, payer then pay()s 1 NEAR: parked funds settle, deposit refunded in full.
    #[test]
    fn audit_contract_3_pay_with_parked_funds_refunds_deposit() {
        reset_storage_env(ONE_NEAR, 1_794_000_000_000, 2 * ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.pay(), "PAID");
        let tax = ONE_NEAR / 100 * 8;
        assert_eq!(inv.status, STATUS_PAID);
        assert_eq!(inv.paid_by, None);
        assert_eq!(inv.paid_amount, ONE_NEAR);
        assert_eq!(sent_to("payer.testnet"), ONE_NEAR); // full refund of the deposit
        assert_eq!(sent_to("zi-merchant.testnet"), ONE_NEAR - tax);
        assert_eq!(sent_to("zi-taxvault.testnet"), tax);
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("\"reason\":\"already_funded\"")));
        assert!(logs.iter().any(|l| l.contains("\"via\":\"transfer\"")));
    }

    /// contract-2: tax transfer fails (vault missing), tax stays owed; sweep re-sends to the vault only.
    #[test]
    fn audit_contract_2_failed_tax_transfer_is_retried_to_vault_only() {
        let tax = ONE_NEAR / 100 * 8;
        reset_storage_env(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        assert_eq!(inv.pay(), "PAID");
        assert_eq!(inv.get_owed_tax().0, tax); // recorded until delivery is confirmed
        // the tax transfer failed: callback sees a failed promise; funds bounce back to the account.
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .account_balance(NearToken::from_yoctonear(tax))
            .storage_usage(330);
        testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(),
            Default::default(), vec![PromiseResult::Failed]);
        inv.on_transfer(ROLE_TAX, tax);
        assert!(get_logs().iter().any(|l| l.contains("\"event\":\"transfer_failed\"")));
        assert_eq!(inv.get_owed_tax().0, tax);
        // a later sweep (any caller) must send the bounced tax to the vault, not the merchant
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("anyone.testnet".parse().unwrap())
            .account_balance(NearToken::from_yoctonear(tax))
            .storage_usage(330);
        testing_env!(b.build());
        assert_eq!(inv.sweep(), "TAX_RESENT");
        assert_eq!(sent_to("zi-taxvault.testnet"), tax);
        assert_eq!(sent_to("zi-merchant.testnet"), 0);
    }

    /// contract-2: a confirmed tax transfer clears the owed counter; later extras go to the merchant.
    #[test]
    fn audit_contract_2_success_callback_clears_owed_tax() {
        let tax = ONE_NEAR / 100 * 8;
        reset_storage_env(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        inv.pay();
        assert_eq!(inv.get_owed_tax().0, tax); // owed until delivery is confirmed
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .storage_usage(330);
        testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(),
            Default::default(), vec![PromiseResult::Successful(vec![])]);
        inv.on_transfer(ROLE_TAX, tax);
        assert_eq!(inv.get_owed_tax().0, 0);
        assert!(!get_logs().iter().any(|l| l.contains("transfer_failed")));
    }

    #[test]
    fn audit_contract_2_failed_merchant_transfer_emits_transfer_failed() {
        reset_storage_env(ONE_NEAR, 1_794_000_000_000, ONE_NEAR);
        let mut inv = example();
        inv.pay();
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .storage_usage(330);
        testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(),
            Default::default(), vec![PromiseResult::Failed]);
        inv.on_transfer(ROLE_MERCHANT, ONE_NEAR / 100 * 92);
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("transfer_failed") && l.contains("\"role\":\"merchant\"")));
        assert_eq!(inv.get_owed_tax().0, ONE_NEAR / 100 * 8); // merchant failure never touches the tax record
    }
}
