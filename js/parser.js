/* mfs-sms-parser-bd -- heuristic parser for Bangladeshi MFS transaction SMS.
 * Pure functions, no DOM, no network. UMD so the same file runs in the
 * browser and under node for unit tests.
 *
 * Supported (heuristic) providers: bKash, Nagad, Rocket, Upay.
 * The parser looks for common field shapes (Tk amounts, TrxID, dates,
 * 01XXXXXXXXX numbers). Anything it cannot confidently parse lands in the
 * review bucket -- it never invents a transaction.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MfsParser = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PROVIDERS = [
    { id: 'bkash',  name: 'bKash',  keys: ['bkash'] },
    { id: 'nagad',  name: 'Nagad',  keys: ['nagad'] },
    { id: 'rocket', name: 'Rocket', keys: ['rocket', 'dbbl', 'dutch-bangla', 'dutch bangla'] },
    { id: 'upay',   name: 'Upay',   keys: ['upay', 'ucb '] }
  ];

  var TYPE_RULES = [
    [/cash\s*in/i, 'cash_in'],
    [/cash\s*out/i, 'cash_out'],
    [/send\s*money/i, 'send_money'],
    [/payment/i, 'payment'],
    [/recharge|top[\s\-]*up/i, 'recharge'],
    [/receiv/i, 'receive_money']
  ];

  // money flowing IN vs OUT of the user's wallet, for the summary cards
  var DIRECTION = {
    cash_in: 'in', receive_money: 'in',
    cash_out: 'out', send_money: 'out', payment: 'out', recharge: 'out',
    other: 'na'
  };

  function detectProvider(text) {
    var t = String(text).toLowerCase();
    for (var i = 0; i < PROVIDERS.length; i++) {
      var keys = PROVIDERS[i].keys;
      for (var k = 0; k < keys.length; k++) {
        if (t.indexOf(keys[k]) !== -1) return PROVIDERS[i].id;
      }
    }
    return 'unknown';
  }

  function detectType(text) {
    for (var i = 0; i < TYPE_RULES.length; i++) {
      if (TYPE_RULES[i][0].test(text)) return TYPE_RULES[i][1];
    }
    return 'other';
  }

  function toNum(s) {
    return parseFloat(String(s).replace(/,/g, ''), 10);
  }

  function extractMoney(text) {
    var feeM = /(?:fee|charge)\s*Tk\.?\s*([\d,]+\.\d{2})/i.exec(text);
    var balM = /balance\s*Tk\.?\s*([\d,]+\.\d{2})/i.exec(text);
    var stripped = text
      .replace(/(?:fee|charge)\s*Tk\.?\s*[\d,]+\.\d{2}/gi, ' ')
      .replace(/balance\s*Tk\.?\s*[\d,]+\.\d{2}/gi, ' ');
    var amtM = /Tk\.?\s*([\d,]+\.\d{2})/.exec(stripped);
    return {
      amount: amtM ? toNum(amtM[1]) : null,
      fee: feeM ? toNum(feeM[1]) : null,
      balance: balM ? toNum(balM[1]) : null
    };
  }

  function extractTrxId(text) {
    var m = /\bTrx\s*ID\s*[:#]?\s*([A-Za-z0-9]{6,})/i.exec(text);
    return m ? m[1].toUpperCase() : null;
  }

  function extractCounterparty(text) {
    var m = /from[^.\n]*?(01\d{9})/i.exec(text);
    if (m) return { dir: 'from', value: m[1] };
    m = /\bto[^.\n]*?(01\d{9})/i.exec(text);
    if (m) return { dir: 'to', value: m[1] };
    // merchant / biller name after "to" or "at", up to the next keyword
    m = /(?:\bto|\bat)\s+([A-Za-z][A-Za-z0-9 .&'\-]{1,40}?)\s*(?:successful|has been|is successful|Tk\.|Trx\s*ID|on\s+\d{1,2}[\/\-]|\.|$)/i.exec(text);
    if (m) {
      var v = m[1].trim().replace(/\s{2,}/g, ' ');
      if (v) return { dir: 'to', value: v };
    }
    return { dir: null, value: null };
  }

  function extractDateTime(text) {
    var date = null, time = null;
    var dm = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(text);
    if (dm) {
      var y = dm[3].length === 2 ? '20' + dm[3] : dm[3];
      date = y + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[1]).slice(-2);
    }
    var tm = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/.exec(text);
    if (tm) time = tm[1].trim();
    return { date: date, time: time };
  }

  function parseMessage(raw, idx, providerOverride) {
    var text = String(raw || '').replace(/\r/g, '').trim();
    var money = extractMoney(text);
    var cp = extractCounterparty(text);
    var dt = extractDateTime(text);
    var provider = providerOverride && providerOverride !== 'auto'
      ? providerOverride
      : detectProvider(text);
    var warnings = [];
    if (provider === 'unknown') warnings.push('unknown-provider');
    var trxId = extractTrxId(text);
    if (money.amount !== null && !trxId) warnings.push('missing-trxid');
    var parsed = money.amount !== null;
    if (!parsed) warnings.push('unparseable');
    return {
      idx: idx,
      raw: text,
      provider: provider,
      type: parsed ? detectType(text) : 'other',
      amount: money.amount,
      fee: money.fee,
      balance: money.balance,
      trxId: trxId,
      date: dt.date,
      time: dt.time,
      cpDir: cp.dir,
      counterparty: cp.value,
      parsed: parsed,
      duplicate: false,
      warnings: warnings
    };
  }

  function splitMessages(input) {
    var chunks = String(input || '')
      .replace(/\r\n/g, '\n')
      .split(/\n[ \t]*\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    return chunks;
  }

  function parseBatch(input, providerOverride) {
    var rows = splitMessages(input).map(function (chunk, i) {
      return parseMessage(chunk, i, providerOverride);
    });
    markDuplicates(rows);
    return rows;
  }

  function markDuplicates(rows) {
    var seen = {};
    rows.forEach(function (r) {
      if (!r.trxId) return;
      var key = r.trxId.toUpperCase();
      if (seen[key] !== undefined) {
        r.duplicate = true;
        rows[seen[key]].duplicate = true;
      } else {
        seen[key] = r.idx;
      }
    });
    return rows;
  }

  function summarize(rows) {
    var perProvider = {};
    var perType = {};
    var totalIn = 0, totalOut = 0, parsed = 0, review = 0, dups = 0;
    rows.forEach(function (r) {
      if (!r.parsed) { review++; return; }
      parsed++;
      if (r.duplicate) dups++;
      var dir = DIRECTION[r.type] || 'na';
      if (dir === 'in') totalIn += r.amount;
      else if (dir === 'out') totalOut += r.amount;
      if (!perProvider[r.provider]) perProvider[r.provider] = { in: 0, out: 0, count: 0 };
      perProvider[r.provider].count++;
      if (dir === 'in') perProvider[r.provider].in += r.amount;
      else if (dir === 'out') perProvider[r.provider].out += r.amount;
      perType[r.type] = (perType[r.type] || 0) + 1;
    });
    return {
      parsed: parsed, review: review, duplicates: dups,
      totalIn: totalIn, totalOut: totalOut,
      perProvider: perProvider, perType: perType
    };
  }

  function parseContacts(input) {
    var map = {};
    String(input || '').split('\n').forEach(function (line) {
      var parts = line.split(',');
      var num = (parts[0] || '').replace(/\D/g, '');
      var name = (parts.slice(1).join(',') || '').trim();
      if (/^01\d{9}$/.test(num) && name) map[num] = name;
    });
    return map;
  }

  function displayCounterparty(row, contacts) {
    if (!row.counterparty) return '';
    if (/^01\d{9}$/.test(row.counterparty) && contacts && contacts[row.counterparty]) {
      return contacts[row.counterparty] + ' (' + row.counterparty + ')';
    }
    return row.counterparty;
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCSV(rows, contacts) {
    var header = ['date', 'time', 'provider', 'type', 'amount_bdt', 'fee_bdt',
      'counterparty', 'trx_id', 'balance_bdt', 'warnings', 'raw'];
    var lines = [header.join(',')];
    rows.forEach(function (r) {
      if (!r.parsed) return;
      lines.push([
        csvCell(r.date), csvCell(r.time), csvCell(r.provider), csvCell(r.type),
        csvCell(r.amount !== null ? r.amount.toFixed(2) : ''),
        csvCell(r.fee !== null ? r.fee.toFixed(2) : ''),
        csvCell(displayCounterparty(r, contacts)),
        csvCell(r.trxId),
        csvCell(r.balance !== null ? r.balance.toFixed(2) : ''),
        csvCell(r.warnings.join(';')),
        csvCell(r.raw.replace(/\n/g, ' '))
      ].join(','));
    });
    return '\uFEFF' + lines.join('\n');
  }

  function providerName(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i].name;
    }
    return id === 'unknown' ? 'Unknown' : id;
  }

  return {
    PROVIDERS: PROVIDERS,
    DIRECTION: DIRECTION,
    detectProvider: detectProvider,
    detectType: detectType,
    extractMoney: extractMoney,
    extractTrxId: extractTrxId,
    extractCounterparty: extractCounterparty,
    extractDateTime: extractDateTime,
    parseMessage: parseMessage,
    splitMessages: splitMessages,
    parseBatch: parseBatch,
    markDuplicates: markDuplicates,
    summarize: summarize,
    parseContacts: parseContacts,
    displayCounterparty: displayCounterparty,
    buildCSV: buildCSV,
    providerName: providerName
  };
}));
