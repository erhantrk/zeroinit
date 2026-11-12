#!/usr/bin/env python3
"""Extract the replay steps for the site from fixtures/v32/demo-run.json.

Every value comes from a recorded call in the fixture (seq noted per fact).
Output: src/replay-data.json. Run: python3 -I scripts/extract-replay.py
"""
import json
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT.parent / 'fixtures' / 'v32' / 'demo-run.json'
OUT = ROOT / 'src' / 'replay-data.json'

d = json.loads(FIX.read_text())
calls = d['calls']


def call(seq):
    c = calls[seq]
    assert c['seq'] == seq
    return c


def near(yocto):
    n = int(yocto)
    whole, frac = divmod(n, 10**24)
    if frac == 0:
        return str(whole)
    s = f'{frac:024d}'.rstrip('0')
    return f'{whole}.{s}'


def invoice_doc(seq):
    return json.loads(bytes(call(seq)['response']['result']['result']).decode())


def transfers(tx_seq):
    out = []
    for rc in call(tx_seq)['response']['result'].get('receipts', []):
        acts = rc['receipt'].get('Action', {}).get('actions', [])
        for a in acts:
            if 'Transfer' in a and rc['receiver_id'] != rc['receipt']['Action'].get('signer_id'):
                out.append((rc['receiver_id'], a['Transfer']['deposit'], rc['receipt']['Action'].get('gas_price')))
    return out


def success_text(tx_seq):
    v = call(tx_seq)['response']['result']['status']['SuccessValue']
    return base64.b64decode(v).decode().strip('"')


# --- invoice A (pay path) ---
a_unknown = call(6)['response']['error']['cause']
assert a_unknown['name'] == 'UNKNOWN_ACCOUNT'
a_tx = call(10)['response']['result']
a_doc = invoice_doc(12)
assert a_doc['status'] == 'PAID' and a_doc['invoice_id'] == 'INV-1111-V32-A'
a_tr = {r: dep for r, dep, gp in transfers(10) if gp == '1000000000'}
merchant, vault = a_doc['merchant'], a_doc['tax_vault']
assert near(a_tr[merchant]) == '0.92' and near(a_tr[vault]) == '0.08'

# --- invoice B (plain transfer + sweep) ---
b_pre = call(24)['response']['result']
assert b_pre['state'] == 'uninitialized'
b_tx = call(28)['response']['result']
b_doc = invoice_doc(30)
assert b_doc['status'] == 'PAID' and b_doc['invoice_id'] == 'INV-1111-V32-B'
assert success_text(28) == 'PAID' and success_text(10) == 'PAID'

short = lambda h: h[:8] + '…' + h[-6:]

steps = [
    {
        'name': 'before-unknown-account', 'inv': 'INV-1111-V32-A', 'state': 'NONEXISTENT',
        'title': 'No account yet.',
        'text': 'The invoice already has an address. Asking the chain about it returns UNKNOWN_ACCOUNT.',
        'facts': [['Address', a_doc['account_id']], ['Chain answer', a_unknown['name']], ['Recorded call', '#6, block ' + str(a_unknown['info']['block_height'])]],
        'rest': 'NONEXISTENT',
    },
    {
        'name': 'pay-tx-success', 'inv': 'INV-1111-V32-A', 'state': 'PAID',
        'title': 'One transaction pays and creates the account.',
        'text': 'The payer sends 1 NEAR. The same transaction creates the account and runs the payment.',
        'facts': [['Transaction', a_tx['transaction']['hash']], ['Signed by', a_tx['transaction']['signer_id']], ['Actions', 'UniversalStateInit, FunctionCall'], ['Result', success_text(10)], ['Recorded call', '#10']],
        'rest': a_tx['transaction']['hash'] + ' []',
    },
    {
        'name': 'invoice-paid-after-callback', 'inv': 'INV-1111-V32-A', 'state': 'PAID',
        'title': 'The invoice reads PAID.',
        'text': 'After the payment callback, get_invoice on the new account returns PAID and the payer.',
        'facts': [['status', a_doc['status']], ['paid_by', a_doc['paid_by']], ['paid_amount', near(a_doc['paid_amount']) + ' NEAR'], ['Recorded call', '#12']],
        'rest': '',
    },
    {
        'name': 'split-merchant', 'inv': 'INV-1111-V32-A', 'state': 'PAID',
        'title': '92% to the merchant.',
        'text': 'The first of two transfers in the payment receipt.',
        'facts': [['To', merchant], ['Amount', near(a_tr[merchant]) + ' NEAR'], ['Recorded call', '#10']],
        'rest': near(a_tr[merchant]),
    },
    {
        'name': 'split-vault', 'inv': 'INV-1111-V32-A', 'state': 'PAID',
        'title': '8% to the tax vault.',
        'text': f"The invoice sets tax_bps to {a_doc['tax_bps']}. That is 8%.",
        'facts': [['To', vault], ['Amount', near(a_tr[vault]) + ' NEAR'], ['tax_bps', str(a_doc['tax_bps'])], ['Recorded call', '#10']],
        'rest': near(a_tr[vault]),
    },
    {
        'name': 'transfer-path-uninitialized', 'inv': 'INV-1111-V32-B', 'state': 'UNINITIALIZED',
        'title': 'A wallet sends money to invoice B.',
        'text': 'A plain transfer to the address. The balance arrives and no contract is installed yet.',
        'facts': [['Address', b_doc['account_id']], ['Balance', near(b_pre['amount']) + ' NEAR'], ['state', b_pre['state']], ['Recorded call', '#24']],
        'rest': near(b_pre['amount']),
    },
    {
        'name': 'sweep-tx-result', 'inv': 'INV-1111-V32-B', 'state': 'PAID',
        'title': 'A sweep settles invoice B.',
        'text': 'The sweep installs the contract and settles the same split. paid_by is null because sweep does not know who sent the money.',
        'facts': [['Transaction', b_tx['transaction']['hash']], ['Signed by', b_tx['transaction']['signer_id']], ['Result', 'PAID'], ['paid_by', 'null'], ['Recorded call', '#28']],
        'rest': b_tx['transaction']['hash'] + ' result=PAID',
    },
]

OUT.write_text(json.dumps({
    'source': 'fixtures/v32/demo-run.json',
    'recorded_at_iso': d['recorded_at_iso'],
    'steps': steps,
}, indent=1) + '\n')
print('wrote', OUT, len(steps), 'steps')
for s in steps:
    print(' ', s['name'], s['state'], short(s['facts'][0][1]) if len(s['facts'][0][1]) > 20 else s['facts'][0][1])
