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
  var CFG = null, REGIONCFG = null, picked = null, rows = [];

  var esc = function (s) { return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  /* ───────────────────────── 설정 읽기 ───────────────────────── */

  function loadConfig() {
    return Promise.all([
      fetch('config/permissions.json?cb=' + Date.now())
        .then(function (r) { if (!r.ok) throw new Error('permissions.json ' + r.status); return r.json(); }),
      // Region 매핑은 있으면 좋지만 없어도 검증 자체는 막지 않는다 — 실패해도 조용히 건너뛴다.
      fetch('config/region-items.json?cb=' + Date.now())
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (res) {
      CFG = res[0]; REGIONCFG = res[1];
      renderConfig();
      return CFG;
    });
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
            rows.push(L.checkRow(raw, CFG, REGIONCFG));
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

    var head = ['<input type="checkbox" id="chk-all" title="전체 선택">', '#',
                '이름', '국가', 'Region', '언어', '이메일', '딜러사명', '전화번호',
                'Member of Dealer']
      .concat(CFG.modules.map(function (m) { return m.label; }))
      .concat(['검토필요'])
      // ⚠ 첫 칸은 체크박스 HTML 이라 그대로 넣는다. esc 하면 글자로 보인다.
      .map(function (h, i) { return '<th>' + (i === 0 ? h : esc(h)) + '</th>'; }).join('');

    var body = rows.map(function (r, i) {
      var perms = CFG.modules.map(function (m) {
        var v = r.perms ? (r.perms[m.key] || '') : '';
        var cls = v === '없음' ? 'lv-none' : v === '관리자' ? 'lv-admin' : '';
        return '<td class="' + cls + '">' + esc(v) + '</td>';
      }).join('');
      var regionBadge = r.hdRegion
        ? '<span class="badge' + (r.regionItems && r.regionItems.autoCheck ? ' badge-auto' : '') + '">' + esc(r.hdRegion) + '</span>'
        : '<span class="sub">미상</span>';
      // 자동화 대상이 아니므로 값이 있어도 강조하지 않고 "직접 입력" 임을 항상 함께 적는다.
      var mod = r.memberOfDealer
        ? esc(r.memberOfDealer) + ' <span class="sub">(직접 입력값)</span>'
        : '<span class="sub">직접 입력 필요</span>';
      // 검토가 필요한 줄은 **기본으로 꺼 둔다.** 켜 두면 그대로 내보내기 쉽다.
      return '<tr class="' + (r.ready ? '' : 'flag') + '">' +
        '<td><input type="checkbox" class="chk" data-i="' + i + '"' +
          (r.ready ? ' checked' : '') + (r.ready ? '' : ' title="검토가 필요한 줄입니다"') + '></td>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.countryCode || r.country) +
          (r.countryName ? ' <span class="sub">' + esc(r.countryName) + '</span>' : '') + '</td>' +
        '<td>' + regionBadge + '</td>' +
        '<td>' + esc(r.lang) + '</td>' +
        '<td>' + esc(r.email) + '</td>' +
        '<td>' + esc(r.dealer) + '</td>' +
        '<td>' + esc(r.phone) + '</td>' +
        '<td>' + mod + '</td>' + perms +
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
      '<button class="btn green" id="dl-xlsx">검증 결과 엑셀로 내려받기 (전체)</button>' +
      '<button class="btn primary" id="dl-json">선택한 <span id="sel-n">0</span>줄 내보내기 (JSON)</button>' +
      '</div>' +
      '<div class="note"><b>넣을 줄은 직접 고르세요.</b> 검토가 필요한 줄은 기본으로 꺼 두었습니다. ' +
      '내보낸 JSON 을 <code>scripts/portal-fill.mjs</code> 에 넘기면 입력칸을 대신 채웁니다.<br>' +
      '<b>로그인은 사람이 직접 합니다</b> — 스크립트는 계정 정보를 다루지 않습니다. ' +
      '최종 Save 도 사람이 누릅니다. <a href="guide.html">사용법</a> 참고.</div>' +
      renderRegionItems();

    $('#dl-xlsx').addEventListener('click', downloadXlsx);
    $('#dl-json').addEventListener('click', downloadJson);

    // 체크박스 — 위임으로 걸어 두면 표를 다시 그려도 살아 있다
    var tbl = $('#out table');
    tbl.addEventListener('change', function (e) {
      if (e.target.id === 'chk-all') {
        var on = e.target.checked;
        Array.prototype.forEach.call(tbl.querySelectorAll('.chk'), function (c) { c.checked = on; });
      }
      updateCount();
    });
    updateCount();
  }

  /**
   * Region 이 APAC·LA·MEA 인 딜러마다 Account/Authorization 화면의 Items to Select
   * 26개를 "제안값"으로 보여준다(임나연 수정요청 — config/region-items.json 참고).
   *
   * ⚠ 여기서 만드는 체크는 **포털에 아무것도 넣지 않는다.** 화면에서 사람이
   *   실제로 체크하기 전에 무엇을 봐야 하는지 미리 보여 주는 참고용일 뿐이다.
   */
  function renderRegionItems() {
    if (!REGIONCFG) return '';
    var targets = rows.filter(function (r) { return r.regionItems && r.regionItems.autoCheck; });
    if (!targets.length) return '';
    var cards = targets.map(function (r) {
      var items = r.regionItems.items.map(function (it) {
        return '<li><label><input type="checkbox" checked disabled> ' + esc(it) + '</label></li>';
      }).join('');
      return '<div class="card region-card">' +
        '<h3>' + esc(r.name) + ' <span class="sub">' + esc(r.dealer) + ' · ' + esc(r.hdRegion) + '</span></h3>' +
        '<ul class="region-items">' + items + '</ul></div>';
    }).join('');
    return '<h2>Account/Authorization — Items to Select (APAC · LA · MEA 자동 제안)</h2>' +
      '<p class="sub">국가로 판정한 Region 이 APAC/LA/MEA 인 딜러는 아래 26개 항목을 전부 체크하는 것이 기본값입니다. ' +
      '<b>제안일 뿐입니다</b> — access.hd-ce.com 의 Account/Authorization 탭에서 사람이 직접 확인하고 체크하세요.</p>' +
      cards;
  }

  function selectedIndexes() {
    return Array.prototype.slice.call(document.querySelectorAll('.chk'))
      .filter(function (c) { return c.checked; })
      .map(function (c) { return Number(c.getAttribute('data-i')); });
  }

  function updateCount() {
    var n = selectedIndexes().length;
    var el = document.getElementById('sel-n');
    if (el) el.textContent = n;
    var btn = document.getElementById('dl-json');
    if (btn) btn.disabled = n === 0;
  }

  function downloadXlsx() {
    var cols = ['이름', '국가코드', '국가', 'Region', '언어', '이메일', '딜러사명', '전화번호',
                'Member of Dealer(직접 입력 필요)']
      .concat(CFG.modules.map(function (m) { return m.label; }))
      .concat(['등록가능', '검토필요']);
    var aoa = [cols];
    rows.forEach(function (r) {
      aoa.push([r.name, r.countryCode || '', r.countryName || '', r.hdRegion || '', r.lang, r.email,
                r.dealer, r.phone, r.memberOfDealer || '']
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
    // 사람이 고른 줄만 내보낸다.
    // 검토가 필요한 줄은 기본으로 꺼져 있지만, 확인하고 켰다면 그 판단을 존중한다 —
    // 다만 어떤 상태였는지 파일에 남겨 나중에 되짚을 수 있게 한다.
    var idx = selectedIndexes();
    var chosen = idx.map(function (i) { return rows[i]; });
    var risky = chosen.filter(function (r) { return !r.ready; }).length;
    if (risky && !confirm('검토가 필요한 줄 ' + risky + '개가 선택되어 있습니다.\n' +
        '그대로 내보낼까요?')) return;
    var ok = chosen.map(function (r) {
      return { name: r.name, country: r.countryCode, language: r.lang,
               email: r.email, dealer: r.dealer, phone: r.phone, permissions: r.perms,
               hdRegion: r.hdRegion || null,
               regionItemsSuggested: (r.regionItems && r.regionItems.autoCheck) ? r.regionItems.items : [],
               // 자동화 대상이 아니다 — 값이 있어도 참고용으로만 옮긴다.
               memberOfDealer: r.memberOfDealer || '',
               memberOfDealerNote: '자동화 대상 아님 — 포털에서 직접 검색/선택',
               // 내보낼 때 어떤 상태였는지 남긴다
               verified: r.ready, note: r.review || '' };
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
