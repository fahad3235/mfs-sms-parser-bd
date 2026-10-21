/* mfs-sms-parser-bd -- UI wiring. No network calls, ever. */
(function () {
  'use strict';

  var P = window.MfsParser;
  var LS_KEY = 'mfs-sms-parser-bd-v1';
  var BN_DIGITS = '\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF';

  var state = {
    rows: [], contacts: {}, lang: 'en', sample: false,
    sort: { key: 'idx', dir: 1 },
    fProvider: 'all', fType: 'all', q: ''
  };

  // ---- persistence (language + name mapping only; SMS data is never stored) ----
  function loadPrefs() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.lang === 'bn' || d.lang === 'en') state.lang = d.lang;
      if (d.contacts && typeof d.contacts === 'object') state.contacts = d.contacts;
    } catch (e) { /* private mode etc. -- run without persistence */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ lang: state.lang, contacts: state.contacts }));
    } catch (e) { /* ignore */ }
  }

  // ---- i18n ----
  function t(key) {
    var dict = state.lang === 'bn' ? window.MfsI18n.bn : window.MfsI18n.en;
    return dict[key] !== undefined ? dict[key] : (window.MfsI18n.en[key] || key);
  }
  function bnDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return BN_DIGITS[+d]; });
  }
  function loc(s) {
    return state.lang === 'bn' ? bnDigits(s) : String(s);
  }
  function fmtBDT(n) {
    if (n === null || n === undefined || isNaN(n)) return t('na');
    var s = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return loc(s);
  }
  function typeName(ty) { return t('t_' + ty); }
  function providerName(id) { return P.providerName(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function $(id) { return document.getElementById(id); }

  function applyLang() {
    document.documentElement.lang = state.lang === 'bn' ? 'bn' : 'en';
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    var phs = document.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < phs.length; j++) phs[j].setAttribute('placeholder', t(phs[j].getAttribute('data-i18n-ph')));
    $('langToggle').textContent = state.lang === 'bn' ? 'English' : '\u09AC\u09BE\u0982\u09B2\u09BE';
    $('eraseBox').classList.add('hidden');
  }

  // ---- sample data (clearly fictional numbers, clearly labeled) ----
  var SAMPLE_SMS = [
    'Cash In Tk 5,000.00 from 01800000001 successful. Ref 1023. TrxID 9HXK2LM4PQ. Fee Tk 0.00. Balance Tk 5,120.50. bKash on 20/10/2026 at 14:32.',
    'Send Money Tk 1,200.00 to 01900000002 successful. TrxID 7QWE9RT2YU. Fee Tk 5.00. Balance Tk 3,915.50. bKash on 20/10/2026 at 15:05.',
    'Cash Out Tk 2,000.00 to Agent 01700000003 successful. TrxID NAG4D8K2M1X. Charge Tk 36.50. Balance Tk 1,879.00. Nagad on 21/10/2026 at 09:12.',
    'Payment of Tk 850.00 to Shwapno Mirpur successful. TrxID RKT5T6Y7U8I. Balance Tk 4,230.00. Rocket on 21/10/2026 at 11:40.',
    'You have received Tk 3,000.00 from 01600000004. TrxID UPAY1A2B3C4. Balance Tk 7,230.00. Upay on 21/10/2026 at 13:15.',
    'Cash In Tk 500.00 from 01800000001 successful. TrxID 9HXK2LM4PQ. Fee Tk 0.00. Balance Tk 5,620.50. bKash on 21/10/2026 at 16:00.',
    'Your OTP is 482910. Do not share it with anyone. bKash.'
  ].join('\n\n');

  // ---- actions ----
  function doParse(text, providerOverride, isSample) {
    state.rows = P.parseBatch(text, providerOverride || 'auto');
    state.sample = !!isSample;
    state.sort = { key: 'idx', dir: 1 };
    state.fProvider = 'all'; state.fType = 'all'; state.q = '';
    $('fProvider').value = 'all'; $('fType').value = 'all'; $('q').value = '';
    renderAll();
    var n = state.rows.filter(function (r) { return r.parsed; }).length;
    toast(loc(n) + ' ' + t('parsedToast'));
  }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._tm);
    el._tm = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = state.rows.filter(function (r) { return r.parsed; }).filter(function (r) {
      if (state.fProvider !== 'all' && r.provider !== state.fProvider) return false;
      if (state.fType !== 'all' && r.type !== state.fType) return false;
      if (q) {
        var hay = [r.trxId, r.counterparty, P.displayCounterparty(r, state.contacts),
          providerName(r.provider), typeName(r.type)].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort.key, dir = state.sort.dir;
    rows.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return rows;
  }

  function flagChips(r) {
    var out = [];
    if (r.duplicate) out.push('<span class="chip chip-dup">' + esc(t('dupBadge')) + '</span>');
    r.warnings.forEach(function (w) {
      if (w === 'unparseable') return;
      out.push('<span class="chip">' + esc(t('w_' + w)) + '</span>');
    });
    return out.join(' ');
  }

  function dirArrow(r) {
    var d = P.DIRECTION[r.type];
    if (d === 'in') return '<span class="dir in">IN</span>';
    if (d === 'out') return '<span class="dir out">OUT</span>';
    return '<span class="dir">-</span>';
  }

  function renderSummary() {
    var s = P.summarize(state.rows);
    $('statParsed').textContent = loc(s.parsed);
    $('statIn').textContent = fmtBDT(s.totalIn);
    $('statOut').textContent = fmtBDT(s.totalOut);
    $('statDup').textContent = loc(s.duplicates);
    $('statReview').textContent = loc(s.review);
    var keys = Object.keys(s.perProvider);
    if (!keys.length) {
      $('ppWrap').innerHTML = '<p class="muted">' + esc(t('emptyTable')) + '</p>';
      return;
    }
    var h = '<table class="mini"><thead><tr><th>' + esc(t('ppProvider')) + '</th><th>' +
      esc(t('ppCount')) + '</th><th>' + esc(t('ppIn')) + '</th><th>' + esc(t('ppOut')) +
      '</th></tr></thead><tbody>';
    keys.sort().forEach(function (k) {
      var p = s.perProvider[k];
      h += '<tr><td>' + esc(providerName(k)) + '</td><td>' + loc(p.count) + '</td><td>' +
        fmtBDT(p.in) + '</td><td>' + fmtBDT(p.out) + '</td></tr>';
    });
    $('ppWrap').innerHTML = h + '</tbody></table>';
  }

  function renderTable() {
    var rows = filteredRows();
    var body = $('txBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty">' + esc(t('emptyTable')) + '</td></tr>';
      return;
    }
    var arrow = { 1: ' ^', '-1': ' v' };
    var heads = document.querySelectorAll('#txTable th[data-sort]');
    for (var i = 0; i < heads.length; i++) {
      var k = heads[i].getAttribute('data-sort');
      heads[i].textContent = t(heads[i].getAttribute('data-i18n')) + (state.sort.key === k ? arrow[state.sort.dir] : '');
    }
    var h = '';
    rows.forEach(function (r) {
      h += '<tr' + (r.duplicate ? ' class="duprow"' : '') + '>' +
        '<td>' + esc(r.date || t('na')) + '</td>' +
        '<td>' + esc(r.time || t('na')) + '</td>' +
        '<td>' + esc(providerName(r.provider)) + '</td>' +
        '<td>' + esc(typeName(r.type)) + '</td>' +
        '<td class="num">' + dirArrow(r) + ' ' + fmtBDT(r.amount) + '</td>' +
        '<td class="num">' + fmtBDT(r.fee) + '</td>' +
        '<td>' + esc(P.displayCounterparty(r, state.contacts)) +
        (r.counterparty ? ' <span class="muted small">' + esc(t(r.cpDir === 'from' ? 'dirFrom' : 'dirTo')) + '</span>' : '') + '</td>' +
        '<td class="mono">' + esc(r.trxId || t('na')) + '</td>' +
        '<td class="num">' + fmtBDT(r.balance) + '</td>' +
        '<td>' + flagChips(r) + '</td></tr>';
    });
    body.innerHTML = h;
  }

  function renderReview() {
    var items = state.rows.filter(function (r) { return !r.parsed; });
    var box = $('reviewBox');
    if (!items.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var h = '';
    items.forEach(function (r) {
      h += '<div class="review-item"><div class="mono small">' + esc(r.raw) + '</div>' +
        '<div><span class="chip">' + esc(t('w_unparseable')) + '</span></div></div>';
    });
    $('reviewList').innerHTML = h;
    $('reviewCount').textContent = loc(items.length);
  }

  function renderAll() {
    applyLang();
    $('sampleBanner').classList.toggle('hidden', !state.sample);
    renderSummary();
    renderTable();
    renderReview();
  }

  function exportCSV() {
    var parsed = state.rows.filter(function (r) { return r.parsed; });
    if (!parsed.length) { toast(t('exportEmpty')); return; }
    var csv = P.buildCSV(state.rows, state.contacts);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mfs-transactions.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function copyTable() {
    var rows = filteredRows();
    if (!rows.length) { toast(t('exportEmpty')); return; }
    var lines = [[t('colDate'), t('colTime'), t('colProvider'), t('colType'), t('colAmount'),
      t('colFee'), t('colCp'), t('colTrx'), t('colBal')].join('\t')];
    rows.forEach(function (r) {
      lines.push([r.date || '', r.time || '', providerName(r.provider), typeName(r.type),
        r.amount !== null ? r.amount.toFixed(2) : '',
        r.fee !== null ? r.fee.toFixed(2) : '',
        P.displayCounterparty(r, state.contacts), r.trxId || '',
        r.balance !== null ? r.balance.toFixed(2) : ''].join('\t'));
    });
    var done = function () { toast(t('copyDone')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lines.join('\n')).then(done, function () { toast(t('exportEmpty')); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = lines.join('\n');
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast(t('exportEmpty')); }
      ta.remove();
    }
  }

  function eraseAll() {
    state.rows = []; state.contacts = {}; state.sample = false;
    $('contacts').value = '';
    savePrefs();
    renderAll();
    toast(t('eraseDone'));
  }

  // ---- wire up ----
  function init() {
    loadPrefs();
    $('parseBtn').addEventListener('click', function () {
      doParse($('smsInput').value, $('providerSel').value, false);
    });
    $('sampleBtn').addEventListener('click', function () {
      $('smsInput').value = SAMPLE_SMS;
      doParse(SAMPLE_SMS, 'auto', true);
    });
    $('clearInputBtn').addEventListener('click', function () { $('smsInput').value = ''; });
    $('langToggle').addEventListener('click', function () {
      state.lang = state.lang === 'bn' ? 'en' : 'bn';
      savePrefs();
      renderAll();
    });
    $('fProvider').addEventListener('change', function () { state.fProvider = this.value; renderTable(); });
    $('fType').addEventListener('change', function () { state.fType = this.value; renderTable(); });
    $('q').addEventListener('input', function () { state.q = this.value; renderTable(); });
    var heads = document.querySelectorAll('#txTable th[data-sort]');
    for (var i = 0; i < heads.length; i++) {
      heads[i].addEventListener('click', (function (k) {
        return function () {
          if (state.sort.key === k) state.sort.dir = -state.sort.dir;
          else state.sort = { key: k, dir: 1 };
          renderTable();
        };
      })(heads[i].getAttribute('data-sort')));
    }
    $('applyContacts').addEventListener('click', function () {
      state.contacts = P.parseContacts($('contacts').value);
      savePrefs();
      renderTable();
      toast(loc(Object.keys(state.contacts).length) + ' ' + t('contactsApplied'));
    });
    $('exportCsv').addEventListener('click', exportCSV);
    $('copyTable').addEventListener('click', copyTable);
    $('eraseBtn').addEventListener('click', function () {
      $('eraseBox').classList.remove('hidden');
      $('eraseInput').value = '';
      $('eraseInput').focus();
    });
    $('eraseConfirm').addEventListener('click', function () {
      if ($('eraseInput').value === 'CLEAR') { $('eraseBox').classList.add('hidden'); eraseAll(); }
      else toast(t('eraseWrong'));
    });
    $('contacts').value = Object.keys(state.contacts).map(function (k) { return k + ',' + state.contacts[k]; }).join('\n');
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);

  // test hooks (not user features)
  window.__mfs = {
    version: '1.0.0',
    state: state,
    doParse: doParse,
    exportCSV: exportCSV,
    SAMPLE_SMS: SAMPLE_SMS,
    t: t
  };
})();
