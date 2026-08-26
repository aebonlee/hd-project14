/**
 * logic.js — 딜러 프로필 검증과 국가별 권한 결정 (순수 함수)
 *
 * 이 도구가 실제로 하는 일은 두 가지다.
 *   ① 엑셀에 적힌 딜러 정보가 **포털에 넣어도 되는 값인지** 본다
 *   ② 국가에 따라 **권한 다섯 가지를 정한다**
 *
 * 포털에 실제로 넣는 것은 마지막 단계이고, 그 전에 사람이 확인한다.
 * 그래서 여기서는 **넣기 전에 걸러야 할 것**을 최대한 잡아 둔다 —
 * 포털에 절반쯤 들어간 뒤에 틀린 것을 발견하면 되돌리기가 훨씬 번거롭다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealerLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FIELDS = [
    { key: 'name',    label: '이름',     required: true },
    { key: 'country', label: '국가',     required: true },
    { key: 'lang',    label: '언어',     required: true },
    { key: 'email',   label: '이메일',   required: true },
    { key: 'dealer',  label: '딜러사명', required: true },
    { key: 'phone',   label: '전화번호', required: true }
  ];

  var ALIASES = {
    name:    ['name', 'user name', 'full name', '이름', '성명', '담당자', '담당자명'],
    country: ['country', 'country code', 'nation', '국가', '국가코드', '나라'],
    lang:    ['language', 'lang', 'locale', '언어', '사용언어'],
    email:   ['email', 'e-mail', 'mail', '이메일', '메일', '메일주소'],
    dealer:  ['dealer', 'dealer name', 'company', 'distributor', '딜러사', '딜러사명',
              '업체명', '회사명', '대리점'],
    phone:   ['phone', 'tel', 'telephone', 'mobile', 'contact', '전화', '전화번호', '연락처', '휴대폰']
  };

  function norm(s) {
    return String(s == null ? '' : s).replace(/[\[\]()（）]/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** 머리글 → { 항목: 칸번호 }. 못 알아본 항목은 넣지 않는다. */
  function mapHeader(cells) {
    var used = {}, out = {};
    var n = (cells || []).map(norm);
    Object.keys(ALIASES).forEach(function (key) {
      for (var a = 0; a < ALIASES[key].length; a++) {
        var alias = norm(ALIASES[key][a]);
        for (var i = 0; i < n.length; i++) {
          if (used[i] || !n[i]) continue;
          if (n[i] === alias ||
              new RegExp('(^|[^a-z0-9가-힣])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                         + '([^a-z0-9가-힣]|$)').test(n[i])) {
            out[key] = i; used[i] = true; return;
          }
        }
      }
    });
    return out;
  }

  /** 표에서 머리글 줄을 찾는다. 이메일과 국가가 함께 있어야 딜러 목록으로 본다. */
  function findHeaderRow(rows, scan) {
    var limit = Math.min(rows.length, scan || 20);
    var best = null;
    for (var i = 0; i < limit; i++) {
      var m = mapHeader(rows[i] || []);
      var n = Object.keys(m).length;
      if (m.email !== undefined && m.country !== undefined && n >= 3 && (!best || n > best.count)) {
        best = { index: i, map: m, count: n };
      }
    }
    return best;
  }

  /* ─────────────────────────── 값 다듬기 ─────────────────────────── */

  /** 'KR' · 'kr' · '대한민국' · 'Korea, Republic of' → 두 자리 코드. 못 알아보면 null */
  function normalizeCountry(v, table) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var up = s.toUpperCase();
    if (/^[A-Z]{2}$/.test(up) && table[up]) return up;
    // 이름으로도 찾는다 — 엑셀에 '대한민국' 이라 적는 사람이 많다
    var keys = Object.keys(table);
    for (var i = 0; i < keys.length; i++) {
      var nm = String(table[keys[i]].name || '');
      if (nm && (nm === s || norm(nm) === norm(s))) return keys[i];
    }
    return null;
  }

  /**
   * 이메일 검사.
   * ⚠ 완벽한 이메일 정규식은 없다. 여기서는 **포털이 받지 않을 것**만 거른다 —
   *   공백, @ 없음, 점 없는 도메인, 한글. 지나치게 엄격하면 멀쩡한 주소가 막힌다.
   */
  function checkEmail(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '이메일 없음';
    if (/\s/.test(s)) return '이메일에 공백이 있음';
    if (/[가-힣]/.test(s)) return '이메일에 한글이 있음';
    if (!/^[^@]+@[^@]+$/.test(s)) return '이메일 형식이 아님 (@ 확인)';
    if (!/\.[a-z]{2,}$/i.test(s)) return '이메일 도메인이 이상함';
    return null;
  }

  /** 전화번호는 숫자와 +·-·공백만 남긴다. 나라마다 자릿수가 달라 길이는 안 본다. */
  function normalizePhone(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return s.replace(/[^\d+\-\s()]/g, '').replace(/\s+/g, ' ').trim();
  }

  /* ─────────────────────────── 권한 결정 ─────────────────────────── */

  /**
   * 국가로 권한 다섯 가지를 정한다.
   *
   * ⚠ 매핑에 없는 국가는 **기본값을 주지 않는다.**
   *   조용히 기본 권한을 주면, 잘못된 권한이 나가도 아무도 모른다.
   *   담당자가 매핑 표에 그 국가를 추가하도록 막아 세우는 편이 낫다.
   */
  function permissionsFor(countryCode, config) {
    var c = config.countries[countryCode];
    if (!c) return { ok: false, reason: '권한 매핑에 없는 국가: ' + countryCode, perms: null };
    var perms = {};
    var missing = [];
    config.modules.forEach(function (m) {
      var v = c[m.key];
      if (v === undefined || v === null || v === '') { missing.push(m.label); return; }
      if (config.levels.indexOf(v) === -1) { missing.push(m.label + '(알 수 없는 등급 ' + v + ')'); return; }
      perms[m.key] = v;
    });
    if (missing.length) {
      return { ok: false, reason: '매핑에 빠진 항목: ' + missing.join(', '), perms: perms };
    }
    return { ok: true, reason: null, perms: perms };
  }

  /* ─────────────────────────── 한 줄 검사 ─────────────────────────── */

  function checkRow(raw, config) {
    var problems = [];
    var out = {};

    FIELDS.forEach(function (f) {
      var v = raw[f.key];
      out[f.key] = v == null ? '' : String(v).trim();
      if (f.required && !out[f.key]) problems.push(f.label + ' 없음');
    });

    var em = checkEmail(out.email);
    if (em) problems.push(em);

    out.phone = normalizePhone(out.phone);

    var code = normalizeCountry(out.country, config.countries);
    if (out.country && !code) problems.push('국가를 알 수 없음: ' + out.country);
    out.countryCode = code;
    out.countryName = code ? config.countries[code].name : '';

    var perms = code ? permissionsFor(code, config) : { ok: false, reason: null, perms: null };
    if (code && !perms.ok && perms.reason) problems.push(perms.reason);
    out.perms = perms.perms;

    out.review = problems.join(' · ');
    out.ready = problems.length === 0;
    return out;
  }

  /** 같은 이메일이 두 번 오면 포털에 중복 계정이 생긴다 — 넣기 전에 잡는다 */
  function findDuplicates(rows) {
    var seen = {}, dups = [];
    rows.forEach(function (r, i) {
      var k = String(r.email || '').trim().toLowerCase();
      if (!k) return;
      if (seen[k] !== undefined) dups.push({ index: i, first: seen[k], email: r.email });
      else seen[k] = i;
    });
    return dups;
  }

  return {
    FIELDS: FIELDS, ALIASES: ALIASES,
    mapHeader: mapHeader, findHeaderRow: findHeaderRow,
    normalizeCountry: normalizeCountry, checkEmail: checkEmail, normalizePhone: normalizePhone,
    permissionsFor: permissionsFor, checkRow: checkRow, findDuplicates: findDuplicates
  };
});
