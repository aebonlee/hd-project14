/**
 * app.js — 화면
 *
 * 흐름: 엑셀 업로드 → 줄마다 검증 + 국가별 권한 결정 → **사람이 확인** → 내보내기.
 * 포털에 자동으로 넣는 것은 마지막 단계이고, 그 앞까지가 이 화면의 몫이다.
 */
(function () {
  'use strict';
  var L = window.DealerLogic;
  var $ = function (s) { return document.querySelector(s); };
  var CFG = null, picked = null, rows = [];

  var esc = function (s) { return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  /* ───────────────────────── 설정 읽기 ───────────────────────── */

  function loadConfig() {
    return fetch('config/permissions.json?cb=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('permissions.json ' + r.status); return r.json(); })
      .then(function (j) { CFG = j; renderConfig(); return j; });
  }

  function renderConfig() {
    var head = '<th>국가</th>' + CFG.modules.map(function (m) {
      return '<th>' + esc(m.label) + '</th>'; }).join('');
    var body = Object.keys(CFG.countries).map(function (code) {
      var c = CFG.countries[code];
      return '<tr><td><b>' + esc(code) + '</b> ' + esc(c.name) + '</td>' +
        CFG.modules.map(function (m) {
          var v = c[m.key] || '';
          var cls = v === '없음' ? 'lv-none' : v === '관리자' ? 'lv-admin' : '';
          return '<td class="' + cls + '">' + esc(v) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    $('#cfg').innerHTML =
      '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body +
      '</tbody></table></div>';
  }

  /* ───────────────────────── 파일 ───────────────────────── */

  function renderFile() {
    $('#files').innerHTML = picked
      ? '<li><span>' + esc(picked.name) + '</span><span>' +
        Math.round(picked.size / 1024).toLocaleString() + ' KB</span></li>' : '';
    $('#run').disabled = !picked;
  }

  function run() {
    if (!picked || !CFG) return;
    var btn = $('#run'); btn.disabled = true; btn.textContent = '읽는 중…';
    $('#out').innerHTML = '';
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
        rows = [];
        var found = false;
        wb.SheetNames.forEach(function (name) {
          var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
          var hit = L.findHeaderRow(aoa);
          if (!hit) return;
          found = true;
          for (var i = hit.index + 1; i < aoa.length; i++) {
            var cells = aoa[i] || [];
            if (cells.filter(function (c) { return String(c).trim() !== ''; }).length < 2) continue;
            var raw = {};
            Object.keys(hit.map).forEach(function (k) { raw[k] = cells[hit.map[k]]; });
            rows.push(L.checkRow(raw, CFG));
          }
        });
        if (!found) throw new Error('딜러 목록을 찾지 못했습니다. 머리글에 이메일과 국가가 있어야 합니다.');
        render();
      } catch (e) {
        $('#out').innerHTML = '<div class="warn"><b>처리하지 못했습니다.</b><br>' + esc(e.message) + '</div>';
      } finally { btn.disabled = false; btn.textContent = '검증하기'; }
    };
    fr.onerror = function () {
      $('#out').innerHTML = '<div class="warn">파일을 읽지 못했습니다.</div>';
      btn.disabled = false; btn.textContent = '검증하기';
    };
    fr.readAsArrayBuffer(picked);
  }

  /* ───────────────────────── 표 ───────────────────────── */

  function render() {
    // 중복은 줄 단위 검사로는 못 잡는다 — 전체를 보고 표시한다
    L.findDuplicates(rows).forEach(function (d) {
      rows[d.index].review = (rows[d.index].review ? rows[d.index].review + ' · ' : '') +
        '이메일 중복 (' + (d.first + 1) + '번째 줄과 같음)';
      rows[d.index].ready = false;
    });

    var ready = rows.filter(function (r) { return r.ready; }).length;
    var need = rows.length - ready;

    var head = ['#', '이름', '국가', '언어', '이메일', '딜러사명', '전화번호']
      .concat(CFG.modules.map(function (m) { return m.label; }))
      .concat(['검토필요']).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');

    var body = rows.map(function (r, i) {
      var perms = CFG.modules.map(function (m) {
        var v = r.perms ? (r.perms[m.key] || '') : '';
        var cls = v === '없음' ? 'lv-none' : v === '관리자' ? 'lv-admin' : '';
        return '<td class="' + cls + '">' + esc(v) + '</td>';
      }).join('');
      return '<tr class="' + (r.ready ? '' : 'flag') + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.countryCode || r.country) +
          (r.countryName ? ' <span class="sub">' + esc(r.countryName) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.lang) + '</td>' +
        '<td>' + esc(r.email) + '</td>' +
        '<td>' + esc(r.dealer) + '</td>' +
        '<td>' + esc(r.phone) + '</td>' + perms +
        '<td class="rev">' + esc(r.review) + '</td></tr>';
    }).join('');

    $('#out').innerHTML =
      '<h2>검증 결과</h2>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + rows.length + '</b>줄</div>' +
        '<div class="stat"><b>' + ready + '</b>줄 등록 가능</div>' +
        '<div class="stat"><b>' + need + '</b>줄 검토필요</div>' +
      '</div>' +
      (need
        ? '<div class="warn"><b>' + need + '줄은 그대로 넣으면 안 됩니다.</b> ' +
          '무엇이 문제인지 맨 오른쪽에 적어 두었습니다. ' +
          '<b>고쳐서 채우지 않습니다</b> — 포털에 들어간 뒤에 되돌리는 것이 훨씬 번거롭습니다.</div>'
        : '<div class="ok">모든 줄이 등록 가능합니다.</div>') +
      '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body +
      '</tbody></table></div>' +
      '<div class="btnrow">' +
      '<button class="btn green" id="dl-xlsx">검증 결과 엑셀로 내려받기</button>' +
      '<button class="btn" id="dl-json">등록용 JSON 내려받기 (등록 가능분만)</button>' +
      '</div>' +
      '<div class="note"><b>다음 단계는 사람이 합니다.</b> 이 화면은 포털에 넣기 전까지를 맡습니다. ' +
      '실제 등록은 <code>scripts/portal-fill.mjs</code> 로 하고, 최종 Save 전에 담당자가 확인합니다 — ' +
      '<a href="guide.html">사용법</a> 참고.</div>';

    $('#dl-xlsx').addEventListener('click', downloadXlsx);
    $('#dl-json').addEventListener('click', downloadJson);
  }

  function downloadXlsx() {
    var cols = ['이름', '국가코드', '국가', '언어', '이메일', '딜러사명', '전화번호']
      .concat(CFG.modules.map(function (m) { return m.label; }))
      .concat(['등록가능', '검토필요']);
    var aoa = [cols];
    rows.forEach(function (r) {
      aoa.push([r.name, r.countryCode || '', r.countryName || '', r.lang, r.email, r.dealer, r.phone]
        .concat(CFG.modules.map(function (m) { return r.perms ? (r.perms[m.key] || '') : ''; }))
        .concat([r.ready ? 'Y' : 'N', r.review]));
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map(function (c) { return { wch: Math.max(10, Math.min(32, c.length + 8)) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '딜러 등록 검증');
    XLSX.writeFile(wb, '딜러등록_검증_' + stamp() + '.xlsx');
  }

  function downloadJson() {
    // ⚠ 등록 가능한 줄만 내보낸다. 문제 있는 줄이 섞이면
    //    자동 등록이 중간에 멈추거나, 더 나쁘게는 잘못된 채로 들어간다.
    var ok = rows.filter(function (r) { return r.ready; }).map(function (r) {
      return { name: r.name, country: r.countryCode, language: r.lang,
               email: r.email, dealer: r.dealer, phone: r.phone, permissions: r.perms };
    });
    var blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(),
      count: ok.length, dealers: ok }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = '딜러등록_' + stamp() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  /* ───────────────────────── 연결 ───────────────────────── */

  function wire() {
    var drop = $('#drop'), input = $('#file');
    input.addEventListener('change', function () { picked = input.files[0] || null; renderFile(); });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) {
      picked = (e.dataTransfer.files || [])[0] || null; renderFile(); });
    $('#run').addEventListener('click', run);
    $('#sample').addEventListener('click', function () {
      var b = $('#sample'); b.disabled = true; b.textContent = '예제 받는 중…';
      var name = '신규딜러_등록요청_20260826.xlsx';
      fetch('sample/' + encodeURIComponent(name))
        .then(function (r) { if (!r.ok) throw new Error('예제 ' + r.status); return r.blob(); })
        .then(function (blob) { picked = new File([blob], name); renderFile(); run(); })
        .catch(function (e) { $('#out').innerHTML = '<div class="warn">예제를 불러오지 못했습니다 — ' + esc(e.message) + '</div>'; })
        .then(function () { b.disabled = false; b.textContent = '예제 엑셀로 해보기'; });
    });
  }

  loadConfig().then(wire).catch(function (e) {
    $('#out').innerHTML = '<div class="warn"><b>권한 매핑을 읽지 못했습니다.</b><br>' +
      esc(e.message) + '<br><code>config/permissions.json</code> 을 확인하세요.</div>';
  });
})();
