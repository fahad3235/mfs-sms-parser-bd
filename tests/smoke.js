'use strict';
/* mfs-sms-parser-bd -- headless-Chrome smoke tests via RAW CDP (no dependencies).
 * Usage: node tests/smoke.js [--viewport=desktop|mobile]
 * Exit code 0 = all checks pass. */
var path = require('path');
var http = require('http');
var child_process = require('child_process');

var VIEWPORT = 'desktop';
process.argv.slice(2).forEach(function (a) {
  if (a.indexOf('--viewport=') === 0) VIEWPORT = a.split('=')[1];
});
var MOBILE = VIEWPORT === 'mobile';
var PORT = MOBILE ? 19243 : 19242;
var CHROME = '/opt/meta-chromium/chrome';
var INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

var passed = 0, failed = 0, failures = [], pageErrors = [];

function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' | ' + extra : '')); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function getVersion() {
  return new Promise(function (resolve, reject) {
    http.get('http://127.0.0.1:' + PORT + '/json/version', function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function launchChrome() {
  var args = [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--no-first-run',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/mfs-smoke-' + VIEWPORT + '-' + process.pid,
    'about:blank'
  ];
  return child_process.spawn(CHROME, args, { stdio: 'ignore', detached: true });
}

function main() {
  var chrome = launchChrome();
  var ws = null, nextId = 1;
  var pending = new Map();

  function send(method, params, sessionId) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      var msg = { id: id, method: method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      setTimeout(function () {
        if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 15000);
    });
  }

  function onMessage(data) {
    var msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      var p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result || {});
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      var d = msg.params.exceptionDetails || {};
      pageErrors.push('exception: ' + (d.text || '') + ' ' + ((d.exception && d.exception.description) || ''));
    }
    if (msg.method === 'Log.entryAdded') {
      var e = msg.params.entry || {};
      if (e.level === 'error') pageErrors.push('log: ' + (e.text || '') + ' ' + (e.url || ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      var args = msg.params.args || [];
      pageErrors.push('console.error: ' + args.map(function (a) { return a.value || a.description || ''; }).join(' '));
    }
  }

  (async function () {
    try {
      var version = null;
      for (var i = 0; i < 50 && !version; i++) {
        try { version = await getVersion(); } catch (e) { await sleep(200); }
      }
      if (!version) throw new Error('Chrome DevTools endpoint did not come up');

      ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = function (ev2) { onMessage(ev2.data); };

      var target = await send('Target.createTarget', { url: 'about:blank' });
      var targetId = target.targetId;
      var attach = await send('Target.attachToTarget', { targetId: targetId, flatten: true });
      var session = attach.sessionId;

      await send('Runtime.enable', {}, session);
      await send('Page.enable', {}, session);
      await send('Log.enable', {}, session);
      await send('Emulation.setDeviceMetricsOverride',
        MOBILE
          ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }
          : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
        session);

      function ev(expr) {
        return send('Runtime.evaluate', { expression: expr, returnByValue: true }, session)
          .then(function (res) {
            if (res.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(res.exceptionDetails));
            return res.result.value;
          });
      }
      async function boot(url) {
        await send('Page.navigate', { url: url }, session);
        var ready = false;
        for (var w = 0; w < 60 && !ready; w++) {
          ready = await ev('typeof window.__mfs === "object" && document.readyState === "complete" ? "yes" : "no"') === 'yes';
          if (!ready) await sleep(200);
        }
        return ready;
      }

      // ---- boot + empty states ----
      check('app boots (__mfs present, DOM complete)', await boot(INDEX));
      check('test hook version 1.0.0', await ev('window.__mfs.version') === '1.0.0');
      var h1 = await ev('document.querySelector(".brand h1").textContent');
      check('default UI is English', h1 === 'MFS SMS Parser BD', JSON.stringify(h1));
      check('statParsed starts at 0', await ev('document.getElementById("statParsed").textContent') === '0');
      check('table empty state visible', await ev('document.querySelector("#txBody .empty") !== null') === true);
      check('review box hidden initially', await ev('document.getElementById("reviewBox").classList.contains("hidden")') === true);
      check('no rows parsed initially', await ev('window.__mfs.state.rows.length') === 0);

      // ---- load sample data ----
      await ev('window.__mfs.doParse(window.__mfs.SAMPLE_SMS, "auto", true)');
      await sleep(300);
      check('sample: 6 parsed', await ev('document.getElementById("statParsed").textContent') === '6');
      check('sample: 1 needs review', await ev('document.getElementById("statReview").textContent') === '1');
      check('sample: 2 duplicate rows', await ev('document.getElementById("statDup").textContent') === '2');
      check('sample: money in 8,500.00', await ev('document.getElementById("statIn").textContent') === '8,500.00');
      check('sample: money out 4,050.00', await ev('document.getElementById("statOut").textContent') === '4,050.00');
      check('sample banner shown', await ev('!document.getElementById("sampleBanner").classList.contains("hidden")') === true);
      check('review box shown with 1 item', await ev('document.querySelectorAll("#reviewList .review-item").length') === 1);
      var revTxt = await ev('document.querySelector("#reviewList .review-item").textContent');
      check('review item is the OTP line', revTxt.indexOf('482910') !== -1, revTxt.slice(0, 60));
      check('per-provider table has 4 rows', await ev('document.querySelectorAll("#ppWrap table.mini tbody tr").length') === 4);

      // ---- provider filter ----
      await ev('(function(){var s=document.getElementById("fProvider");s.value="nagad";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await sleep(200);
      check('provider filter nagad -> 1 row', await ev('document.querySelectorAll("#txBody tr").length') === 1);
      await ev('(function(){var s=document.getElementById("fProvider");s.value="all";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await sleep(200);

      // ---- search ----
      await ev('(function(){var q=document.getElementById("q");q.value="9HXK2LM4PQ";q.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await sleep(200);
      check('search TrxID -> duplicate pair (2 rows)', await ev('document.querySelectorAll("#txBody tr").length') === 2);
      await ev('(function(){var q=document.getElementById("q");q.value="";q.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await sleep(200);

      // ---- sort by amount ----
      await ev('document.querySelector(\'#txTable th[data-sort="amount"]\').click()');
      await sleep(200);
      var firstAmt = await ev('document.querySelector("#txBody tr td.num").textContent');
      check('sort amount asc -> 500.00 first', firstAmt.indexOf('500.00') !== -1, JSON.stringify(firstAmt));

      // ---- contacts mapping ----
      await ev('(function(){document.getElementById("contacts").value="01800000001,Amma";})()');
      await ev('document.getElementById("applyContacts").click()');
      await sleep(200);
      var tblTxt = await ev('document.getElementById("txBody").textContent');
      check('name mapping applied', tblTxt.indexOf('Amma (01800000001)') !== -1, tblTxt.slice(0, 80));

      // ---- CSV export content ----
      var csvInfo = await ev('(function(){var c=window.MfsParser.buildCSV(window.__mfs.state.rows, window.__mfs.state.contacts);return {bom:c.charCodeAt(0),lines:c.split("\\n").length,named:c.indexOf("Amma (01800000001)")!==-1};})()');
      check('CSV has BOM', csvInfo.bom === 0xFEFF, 'got ' + csvInfo.bom);
      check('CSV header + 6 rows', csvInfo.lines === 7, 'got ' + csvInfo.lines);
      check('CSV carries mapped name', csvInfo.named === true);

      // ---- BN toggle ----
      await ev('document.getElementById("langToggle").click()');
      await sleep(300);
      var h1bn = await ev('document.querySelector(".brand h1").textContent');
      check('BN toggle changes title', /[\u0980-\u09FF]/.test(h1bn), JSON.stringify(h1bn));
      var inBn = await ev('document.getElementById("statIn").textContent');
      check('BN digits in summary', /[\u09E6-\u09EF]/.test(inBn), JSON.stringify(inBn));
      await boot(INDEX);
      await sleep(400);
      check('BN UI persists across reload', /[\u0980-\u09FF]/.test(await ev('document.querySelector(".brand h1").textContent')) === true);
      await ev('document.getElementById("langToggle").click()'); // back to EN
      await sleep(300);

      // ---- erase flow (reload first so rows exist again? no -- rows are in-memory; re-parse) ----
      await ev('window.__mfs.doParse(window.__mfs.SAMPLE_SMS, "auto", true)');
      await sleep(200);
      await ev('document.getElementById("eraseBtn").click()');
      await sleep(200);
      check('erase box opens', await ev('!document.getElementById("eraseBox").classList.contains("hidden")') === true);
      await ev('(function(){document.getElementById("eraseInput").value="nope";})()');
      await ev('document.getElementById("eraseConfirm").click()');
      await sleep(200);
      var toastTxt = await ev('document.getElementById("toast").textContent');
      check('wrong word does not erase (toast + rows intact)',
        toastTxt.length > 0 && await ev('window.__mfs.state.rows.length') === 7, JSON.stringify(toastTxt));
      await ev('(function(){document.getElementById("eraseInput").value="CLEAR";})()');
      await ev('document.getElementById("eraseConfirm").click()');
      await sleep(300);
      check('CLEAR erases all rows', await ev('window.__mfs.state.rows.length') === 0);
      check('empty state returns after erase', await ev('document.querySelector("#txBody .empty") !== null') === true);
      check('stats reset to 0', await ev('document.getElementById("statParsed").textContent') === '0');

      // ---- overflow + errors ----
      var overflow = await ev('document.documentElement.scrollWidth <= window.innerWidth');
      check('no horizontal overflow (' + VIEWPORT + ')', overflow === true,
        'scrollWidth=' + await ev('document.documentElement.scrollWidth') + ' innerWidth=' + await ev('window.innerWidth'));
      check('zero console/page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

      try { await send('Target.closeTarget', { targetId: targetId }); } catch (e) {}
    } catch (err) {
      failed++;
      failures.push('HARNESS: ' + err.message);
      console.log('HARNESS ERROR: ' + err.stack);
    }
    try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    console.log('smoke(' + VIEWPORT + '): ' + passed + ' passed, ' + failed + ' failed' +
      (failures.length ? ' [' + failures.join('; ') + ']' : ''));
    process.exit(failed ? 1 : 0);
  })();
}

main();
