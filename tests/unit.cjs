'use strict';
/* mfs-sms-parser-bd -- unit tests for js/parser.js. No dependencies.
 * Usage: node tests/unit.cjs   (exit 0 = all pass) */
var P = require('../js/parser.js');

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + name + (extra ? ' | ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// ---- provider detection ----
eq('provider bkash', P.detectProvider('Cash In Tk 100.00 bKash successful'), 'bkash');
eq('provider nagad', P.detectProvider('Nagad Cash Out done'), 'nagad');
eq('provider rocket dbbl', P.detectProvider('DBBL Rocket payment ok'), 'rocket');
eq('provider upay', P.detectProvider('Upay recharge done'), 'upay');
eq('provider unknown', P.detectProvider('Your OTP is 1234'), 'unknown');

// ---- type detection ----
eq('type cash_in', P.detectType('Cash In Tk 100.00 successful'), 'cash_in');
eq('type cash_out', P.detectType('Cash Out Tk 100.00 successful'), 'cash_out');
eq('type send_money', P.detectType('Send Money Tk 100.00 to 01x'), 'send_money');
eq('type payment', P.detectType('Payment of Tk 100.00 to Shop'), 'payment');
eq('type recharge', P.detectType('Mobile Recharge Tk 100.00 done'), 'recharge');
eq('type receive', P.detectType('You have received Tk 100.00'), 'receive_money');
eq('type other', P.detectType('Balance query result'), 'other');

// ---- money extraction ----
var m1 = P.extractMoney('Cash In Tk 5,000.00 from 01800000001. Fee Tk 0.00. Balance Tk 5,120.50.');
eq('money amount', m1.amount, 5000.00);
eq('money fee', m1.fee, 0.00);
eq('money balance', m1.balance, 5120.50);
var m2 = P.extractMoney('Cash Out Tk 2,000.00 done. Charge Tk 36.50. Balance Tk 1,879.00.');
eq('money charge-as-fee', m2.fee, 36.50);
eq('money amount w/ charge', m2.amount, 2000.00);
var m3 = P.extractMoney('Payment of Tk 850.00 to Shop successful.');
eq('money amount only', m3.amount, 850.00);
eq('money fee null', m3.fee, null);
eq('money balance null', m3.balance, null);
var m4 = P.extractMoney('Your OTP is 482910.');
eq('money none -> null', m4.amount, null);

// ---- trxid ----
eq('trxid basic', P.extractTrxId('TrxID 9HXK2LM4PQ done'), '9HXK2LM4PQ');
eq('trxid spaced+lower', P.extractTrxId('Trx ID: abc123x done'), 'ABC123X');
eq('trxid none', P.extractTrxId('no id here'), null);

// ---- counterparty ----
var c1 = P.extractCounterparty('Cash In Tk 100.00 from 01800000001 successful.');
eq('cp from number', c1.value, '01800000001'); eq('cp from dir', c1.dir, 'from');
var c2 = P.extractCounterparty('Send Money Tk 100.00 to 01900000002 successful.');
eq('cp to number', c2.value, '01900000002'); eq('cp to dir', c2.dir, 'to');
var c3 = P.extractCounterparty('Cash Out Tk 100.00 to Agent 01700000003 successful.');
eq('cp agent number', c3.value, '01700000003');
var c4 = P.extractCounterparty('Payment of Tk 850.00 to Shwapno Mirpur successful.');
eq('cp merchant', c4.value, 'Shwapno Mirpur');
var c5 = P.extractCounterparty('Balance Tk 100.00.');
eq('cp none', c5.value, null);

// ---- datetime ----
var d1 = P.extractDateTime('bKash on 20/10/2026 at 14:32.');
eq('date iso', d1.date, '2026-10-20'); eq('time', d1.time, '14:32');
var d2 = P.extractDateTime('no date here');
eq('date null', d2.date, null); eq('time null', d2.time, null);

// ---- full message parse ----
var r1 = P.parseMessage('Cash In Tk 5,000.00 from 01800000001 successful. Ref 1023. TrxID 9HXK2LM4PQ. Fee Tk 0.00. Balance Tk 5,120.50. bKash on 20/10/2026 at 14:32.', 0, 'auto');
eq('msg provider', r1.provider, 'bkash');
eq('msg type', r1.type, 'cash_in');
eq('msg amount', r1.amount, 5000);
eq('msg trx', r1.trxId, '9HXK2LM4PQ');
eq('msg date', r1.date, '2026-10-20');
eq('msg parsed', r1.parsed, true);
var r2 = P.parseMessage('Your OTP is 482910. Do not share. bKash.', 1, 'auto');
eq('otp unparsed', r2.parsed, false);
ok('otp warning unparseable', r2.warnings.indexOf('unparseable') !== -1);
var r3 = P.parseMessage('Cash In Tk 100.00 from 01800000001. bKash.', 2, 'auto');
ok('missing trxid warning', r3.warnings.indexOf('missing-trxid') !== -1);
var r4 = P.parseMessage('Cash In Tk 100.00 from 01800000001.', 3, 'nagad');
eq('provider override', r4.provider, 'nagad');

// ---- batch split ----
var batch = P.parseBatch('AAA Tk 100.00 bKash.\n\nBBB Tk 200.00 Nagad.\n\n', 'auto');
eq('batch count', batch.length, 2);
var crlf = P.splitMessages('a\r\n\r\nb\r\n');
eq('crlf split', crlf.length, 2);

// ---- duplicates ----
var dup = P.parseBatch('Cash In Tk 100.00 TrxID DUP001 bKash.\n\nCash In Tk 200.00 TrxID dup001 bKash.\n\nCash In Tk 300.00 TrxID OTHER9 bKash.', 'auto');
eq('dup both flagged', dup[0].duplicate && dup[1].duplicate, true);
eq('dup third clean', dup[2].duplicate, false);

// ---- summarize ----
var srows = P.parseBatch(
  'Cash In Tk 5,000.00 from 01800000001. TrxID A1B2C3D4 bKash.\n\n' +
  'Send Money Tk 1,200.00 to 01900000002. TrxID E5F6G7H8 bKash.\n\n' +
  'You have received Tk 3,000.00 from 01600000004. TrxID I9J0K1L2 Upay.\n\n' +
  'Your OTP is 1.', 'auto');
var sum = P.summarize(srows);
eq('sum parsed', sum.parsed, 3);
eq('sum review', sum.review, 1);
eq('sum in', sum.totalIn, 8000);
eq('sum out', sum.totalOut, 1200);
eq('sum bkash count', sum.perProvider.bkash.count, 2);
eq('sum upay in', sum.perProvider.upay.in, 3000);

// ---- contacts ----
var cmap = P.parseContacts('01800000001,Amma\nbadline\n01900000002, Rahim \n123,No');
eq('contacts count', Object.keys(cmap).length, 2);
eq('contacts name', cmap['01800000001'], 'Amma');
var drow = { counterparty: '01800000001' };
eq('display mapped', P.displayCounterparty(drow, cmap), 'Amma (01800000001)');
eq('display unmapped', P.displayCounterparty(drow, {}), '01800000001');

// ---- CSV ----
var csv = P.buildCSV(srows, cmap);
ok('csv bom', csv.charCodeAt(0) === 0xFEFF, 'first char ' + csv.charCodeAt(0));
var lines = csv.split('\n');
eq('csv header', lines[0].replace(/^\uFEFF/, ''), 'date,time,provider,type,amount_bdt,fee_bdt,counterparty,trx_id,balance_bdt,warnings,raw');
eq('csv row count', lines.length - 1, 3); // review row excluded
ok('csv has mapped name', csv.indexOf('Amma (01800000001)') !== -1);
var csvQ = P.buildCSV(P.parseBatch('Payment of Tk 10.00 to "Best", Shop. TrxID Q1W2E3R4 Rocket.', 'auto'), {});
ok('csv quotes commas', csvQ.indexOf('"""Best"", Shop"') !== -1 || csvQ.indexOf('"Best""') !== -1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
