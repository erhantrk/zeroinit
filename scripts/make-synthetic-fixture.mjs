import { readFileSync, writeFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync('invoices/examples/INV-0001.json','utf8'));
const raw64 = Buffer.from(doc.raw_state_init_hex,'hex').toString('base64');
const ret = Buffer.from(JSON.stringify('PAID')).toString('base64');
const ev = 'EVENT_JSON:'+JSON.stringify({standard:'zeroinit',version:'1.0.0',event:'invoice_paid',data:[{invoice_id:'INV-0001',account_id:doc.account_id,via:'pay',payer:'zi-payer.testnet',amount:'1000000000000000000000000',merchant_amount:'920000000000000000000000',tax_amount:'80000000000000000000000',excess_refunded:'0',late:false}]});
const txs = { final_execution_status:'FINAL', status:{SuccessValue:ret},
  transaction:{hash:'SYNTHETIC1111111111111111111111111111111111',signer_id:'zi-payer.testnet',receiver_id:doc.account_id,
    actions:[{UniversalStateInit:{state_init:raw64,deposit:'0'}},{FunctionCall:{method_name:'pay',args:'e30=',gas:50000000000000,deposit:'1000000000000000000000000'}}]},
  transaction_outcome:{id:'SYNTHETIC1111111111111111111111111111111111',outcome:{executor_id:'zi-payer.testnet',logs:[],status:{SuccessReceiptId:'R1'}}},
  receipts_outcome:[{id:'R1',outcome:{executor_id:doc.account_id,logs:[ev],status:{SuccessValue:ret}}},{id:'R2',outcome:{executor_id:'zi-merchant.testnet',logs:[],status:{SuccessValue:''}}},{id:'R3',outcome:{executor_id:'zi-taxvault.testnet',logs:[],status:{SuccessValue:''}}}],
  receipts:[{predecessor_id:'zi-payer.testnet',receiver_id:doc.account_id,receipt_id:'R1',receipt:{Action:{actions:[{UniversalStateInit:{state_init:raw64,deposit:'0'}},{FunctionCall:{method_name:'pay',args:'e30=',gas:50000000000000,deposit:'1000000000000000000000000'}}]}}},
    {predecessor_id:doc.account_id,receiver_id:'zi-merchant.testnet',receipt_id:'R2',receipt:{Action:{actions:[{Transfer:{deposit:'920000000000000000000000'}}]}}},
    {predecessor_id:doc.account_id,receiver_id:'zi-taxvault.testnet',receipt_id:'R3',receipt:{Action:{actions:[{Transfer:{deposit:'80000000000000000000000'}}]}}},
    {predecessor_id:'system',receiver_id:'zi-payer.testnet',receipt_id:'R4',receipt:{Action:{actions:[{Transfer:{deposit:'12345'}}]}}}] };
const view = {...doc}; 
const inv = {v:1,account_id:doc.account_id,invoice_id:'INV-0001',merchant:doc.merchant,tax_vault:doc.tax_vault,tax_bps:800,amount:doc.amount_yocto,expires_at_ms:doc.expires_at_ms,salt:doc.salt,status:'PAID',paid_by:'zi-payer.testnet',paid_at_ms:'1794651234567',paid_amount:doc.amount_yocto,tax_amount:'80000000000000000000000'};
const f = { format:'zeroinit-fixture/1', synthetic:true, recorded_at_iso:'SYNTHETIC', rpc_url:'https://rpc.testnet.near.org', invoices:[doc], calls:[
 {seq:0,invoice_id:'INV-0001',label:'before: view_account',method:'query',params:{request_type:'view_account',finality:'final',account_id:doc.account_id},
  response:{jsonrpc:'2.0',id:'zi',error:{name:'HANDLER_ERROR',cause:{name:'UNKNOWN_ACCOUNT',info:{requested_account_id:doc.account_id}},code:-32000,message:'Server error'}}},
 {seq:1,invoice_id:'INV-0001',label:'pay: tx_status',method:'EXPERIMENTAL_tx_status',params:{tx_hash:'SYNTHETIC',sender_account_id:'zi-payer.testnet',wait_until:'FINAL'},response:{jsonrpc:'2.0',id:'zi',result:txs}},
 {seq:2,invoice_id:'INV-0001',label:'after: view_account',method:'query',params:{request_type:'view_account',finality:'final',account_id:doc.account_id},
  response:{jsonrpc:'2.0',id:'zi',result:{amount:'0',locked:'0',code_hash:'11111111111111111111111111111111',storage_usage:300,storage_paid_at:0,global_contract_hash:doc.code_hash,block_height:1,block_hash:'x'}}},
 {seq:3,invoice_id:'INV-0001',label:'after: get_invoice',method:'query',params:{request_type:'call_function'},response:{jsonrpc:'2.0',id:'zi',result:{result:[...Buffer.from(JSON.stringify(inv))],logs:[],block_height:1,block_hash:'x'}}}]};
writeFileSync('fixtures/v2/synthetic-demo.json', JSON.stringify(f,null,2)+'\n');
