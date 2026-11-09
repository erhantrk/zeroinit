//! ZeroInit invoice contract. One instance = one invoice = one `0u` universal account.
//! The instance never has an init method: its whole state (key "STATE") is written by the
//! protocol's UniversalStateInit action from the invoice terms. See INTERFACES.md §2.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise};

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

fn send(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(yocto)).detach();
    }
}

impl Invoice {
    fn split(&self) -> (u128, u128) {
        let tax = self.amount * (self.tax_bps as u128) / 10_000u128;
        (self.amount - tax, tax)
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
        if d < self.amount {
            refund("underpaid");
            return "REFUNDED_UNDERPAID".to_string();
        }
        let (net, tax) = self.split();
        let excess = d - self.amount;
        send(&self.merchant, net);
        send(&self.tax_vault, tax);
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
        if self.status == STATUS_OPEN {
            if avail < self.amount {
                env::panic_str(&format!("UNDERPAID: available {} < amount {}", avail, self.amount));
            }
            let (_, tax) = self.split();
            let net = avail - tax; // overpayment goes to the merchant (payer unknown)
            send(&self.merchant, net);
            send(&self.tax_vault, tax);
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
            return "PAID".to_string();
        }
        if avail == 0 {
            env::panic_str("NOTHING_TO_SWEEP");
        }
        send(&self.merchant, avail);
        emit("extra_swept", serde_json::json!({
            "invoice_id": self.invoice_id, "account_id": me,
            "amount": avail.to_string(), "to": self.merchant,
        }));
        "EXTRA_SWEPT".to_string()
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

    fn ctx(deposit: u128, now_ms: u64, balance: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0".parse().unwrap())
            .predecessor_account_id("payer.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_yoctonear(balance))
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
    #[should_panic(expected = "UNDERPAID")]
    fn sweep_underpaid_panics() {
        ctx(0, 1_794_000_000_000, ONE_NEAR / 2);
        example().sweep();
    }
}
