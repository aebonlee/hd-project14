/**
 * 단위 테스트 — 실행: node test/logic.test.js
 *
 * 이 도구는 결국 **사내 포털에 계정을 만드는** 일이다.
 * 잘못 들어가면 되돌리기가 번거롭고, 권한이 잘못 나가면 눈에 띄지도 않는다.
 * 그래서 "넣기 전에 걸러야 할 것"을 여기서 못박는다.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../js/logic.js');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/permissions.json'), 'utf8'));
const REGIONCFG = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/region-items.json'), 'utf8'));

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  ✔ ' + n); }
  catch (e) { fail++; console.error('  ✘ ' + n); console.error('    ' + e.message); } };

/* ═════════════════ 권한 매핑 ═════════════════ */

test('국가에 따라 권한 다섯 가지가 정해진다', () => {
  const r = L.permissionsFor('KR', CFG);
  assert.ok(r.ok, r.reason);
  assert.strictEqual(Object.keys(r.perms).length, 5, '다섯 항목이 다 나와야 한다');
  assert.strictEqual(r.perms.dealernet, '관리자');
  assert.strictEqual(r.perms.ordering, '조회+등록');
});

test('국가가 다르면 권한도 다르다', () => {
  const kr = L.permissionsFor('KR', CFG).perms;
  const cn = L.permissionsFor('CN', CFG).perms;
  assert.notDeepStrictEqual(kr, cn, '국가별로 달라야 하는데 같다');
  assert.strictEqual(cn.ordering, '없음');
});

test('★ 매핑에 없는 국가는 기본값을 주지 않고 막아 세운다', () => {
  const r = L.permissionsFor('ZZ', CFG);
  assert.strictEqual(r.ok, false, '모르는 국가에 권한을 줬다');
  assert.ok(/매핑에 없는 국가/.test(r.reason), r.reason);
  assert.strictEqual(r.perms, null);
});

test('매핑에 항목이 빠져 있으면 알린다', () => {
  const cfg = JSON.parse(JSON.stringify(CFG));
  delete cfg.countries.KR.irw;
  const r = L.permissionsFor('KR', cfg);
  assert.strictEqual(r.ok, false);
  assert.ok(/빠진 항목/.test(r.reason), r.reason);
});

test('등급 목록에 없는 값은 받지 않는다', () => {
  const cfg = JSON.parse(JSON.stringify(CFG));
  cfg.countries.KR.parts = '슈퍼관리자';
  const r = L.permissionsFor('KR', cfg);
  assert.strictEqual(r.ok, false);
  assert.ok(/알 수 없는 등급/.test(r.reason), r.reason);
});

test('설정 파일의 모든 국가가 유효하다 (지금 파일 자체 검사)', () => {
  for (const code of Object.keys(CFG.countries)) {
    const r = L.permissionsFor(code, CFG);
    assert.ok(r.ok, code + ': ' + r.reason);
  }
});

/* ═════════════════ 국가 표기 ═════════════════ */

test('국가를 코드·소문자·한글 이름 어느 쪽으로 적어도 알아본다', () => {
  for (const v of ['KR', 'kr', ' KR ', '대한민국']) {
    assert.strictEqual(L.normalizeCountry(v, CFG.countries), 'KR', JSON.stringify(v));
  }
});

test('모르는 국가는 추측하지 않는다', () => {
  assert.strictEqual(L.normalizeCountry('ZZ', CFG.countries), null);
  assert.strictEqual(L.normalizeCountry('한국어', CFG.countries), null, '언어를 국가로 봤다');
  assert.strictEqual(L.normalizeCountry('', CFG.countries), null);
});

/* ═════════════════ 이메일 ═════════════════ */

test('포털이 받지 않을 이메일을 거른다', () => {
  const bad = [['', '없음'], ['a b@x.com', '공백'], ['홍길동@x.com', '한글'],
               ['abc.com', '@ 확인'], ['a@localhost', '도메인']];
  for (const [v, want] of bad) {
    const r = L.checkEmail(v);
    assert.ok(r && r.includes(want), JSON.stringify(v) + ' → ' + r);
  }
});

test('멀쩡한 이메일은 통과시킨다 — 지나치게 엄격하면 안 된다', () => {
  for (const v of ['a@b.com', 'first.last+tag@sub.domain.co.kr', 'A_B-1@x-y.io']) {
    assert.strictEqual(L.checkEmail(v), null, v + ' 가 막혔다');
  }
});

/* ═════════════════ 전화번호 ═════════════════ */

test('전화번호에서 넣으면 안 될 글자를 뺀다 — 자릿수는 건드리지 않는다', () => {
  assert.strictEqual(L.normalizePhone('+82 10-1234-5678'), '+82 10-1234-5678');
  assert.strictEqual(L.normalizePhone('010-1234-5678 (내선 5)'), '010-1234-5678 ( 5)');
  // 나라마다 자릿수가 달라 길이로 판단하지 않는다
  assert.strictEqual(L.normalizePhone('+971 4 123 4567'), '+971 4 123 4567');
});

/* ═════════════════ 머리글 ═════════════════ */

test('엑셀 머리글을 알아본다 (한글·영문)', () => {
  const ko = L.mapHeader(['이름','국가','언어','이메일','딜러사명','전화번호']);
  assert.deepStrictEqual(ko, { name:0, country:1, lang:2, email:3, dealer:4, phone:5 });
  const en = L.mapHeader(['Name','Country','Language','Email','Dealer Name','Phone']);
  assert.deepStrictEqual(en, { name:0, country:1, lang:2, email:3, dealer:4, phone:5 });
});

test('제목이 몇 줄 있어도 머리글 줄을 찾는다', () => {
  const rows = [['신규 딜러 등록 요청'], [], ['요청일','2026-08-26'], [],
    ['이름','국가','언어','이메일','딜러사명','전화번호'],
    ['홍길동','KR','한국어','hong@x.com','대한기계','010-1111-2222']];
  const h = L.findHeaderRow(rows);
  assert.strictEqual(h.index, 4);
});

test('★ 이메일·국가가 없는 표는 딜러 목록으로 보지 않는다', () => {
  assert.strictEqual(L.findHeaderRow([['이름','전화번호'],['홍','010']]), null);
});

/* ═════════════════ 한 줄 검사 ═════════════════ */

test('제대로 된 줄은 바로 넣을 수 있다고 답한다', () => {
  const r = L.checkRow({ name:'홍길동', country:'KR', lang:'한국어',
    email:'hong@daehan.co.kr', dealer:'대한기계', phone:'010-1111-2222' }, CFG);
  assert.strictEqual(r.ready, true, r.review);
  assert.strictEqual(r.countryCode, 'KR');
  assert.strictEqual(r.perms.dealernet, '관리자');
});

test('빠진 항목이 있으면 넣을 수 없다고 답한다', () => {
  const r = L.checkRow({ name:'', country:'KR', lang:'', email:'x@y.com', dealer:'', phone:'' }, CFG);
  assert.strictEqual(r.ready, false);
  ['이름','언어','딜러사명','전화번호'].forEach(f =>
    assert.ok(r.review.includes(f + ' 없음'), f + ' 를 안 잡았다: ' + r.review));
});

test('모르는 국가면 권한을 비우고 알린다', () => {
  const r = L.checkRow({ name:'A', country:'ZZ', lang:'en',
    email:'a@b.com', dealer:'D', phone:'1' }, CFG);
  assert.strictEqual(r.ready, false);
  assert.ok(/국가를 알 수 없음/.test(r.review), r.review);
  assert.strictEqual(r.perms, null, '권한을 지어냈다');
});

/* ═════════════════ 중복 ═════════════════ */

test('★ 같은 이메일이 두 번 오면 잡는다 — 포털에 중복 계정이 생긴다', () => {
  const rows = [{ email:'a@x.com' }, { email:'b@x.com' }, { email:'A@X.com' }];
  const d = L.findDuplicates(rows);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].index, 2);
  assert.strictEqual(d[0].first, 0, '대소문자가 달라도 같은 주소다');
});

test('빈 이메일은 중복으로 세지 않는다', () => {
  assert.strictEqual(L.findDuplicates([{ email:'' }, { email:'' }]).length, 0);
});

/* ═════════════════ Region 자동 매핑 (임나연 수정요청) ═════════════════ */

test('영문 국가명으로 HD Region 을 찾는다', () => {
  assert.strictEqual(L.regionFor('Guatemala', REGIONCFG), 'LA');
  assert.strictEqual(L.regionFor('South Korea', REGIONCFG), 'APAC');
  assert.strictEqual(L.regionFor('germany', REGIONCFG), 'EU', '대소문자를 가리지 않아야 한다');
});

test('region-items.json 의 IN/ID 는 permissions.json 의 ISO 코드와 다른 체계다 — 섞이면 안 된다', () => {
  assert.strictEqual(REGIONCFG.countryToRegion['Indonesia'], 'IN');
  assert.strictEqual(REGIONCFG.countryToRegion['India'], 'ID');
  // permissions.json 에서는 반대로 IN = 인도다. 두 표를 같은 코드로 착각하면 안 된다.
  assert.strictEqual(CFG.countries.IN.name, '인도');
});

test('모르는 국가명은 Region 을 추측하지 않는다', () => {
  assert.strictEqual(L.regionFor('Neverland', REGIONCFG), null);
  assert.strictEqual(L.regionFor('', REGIONCFG), null);
});

test('APAC·LA·MEA 는 Items to Select 26개를 제안하고, 다른 Region 은 제안하지 않는다', () => {
  const auto = L.regionItemsFor('LA', REGIONCFG);
  assert.strictEqual(auto.autoCheck, true);
  assert.strictEqual(auto.items.length, 26);

  const notAuto = L.regionItemsFor('EU', REGIONCFG);
  assert.strictEqual(notAuto.autoCheck, false);
  assert.strictEqual(notAuto.items.length, 0);

  const unknown = L.regionItemsFor(null, REGIONCFG);
  assert.strictEqual(unknown.autoCheck, false);
});

test('checkRow 가 hdRegion 과 regionItems 를 함께 채운다', () => {
  // Region 판정은 원문 국가 텍스트로 한다 — 실제 템플릿의 Country 열은 'United States'처럼
  // 영문 전체 이름을 쓴다(코드 'US'가 아니다). ISO 코드만으로는 Region 을 찾지 못하는 것이
  // 의도된 동작이다(추측하지 않는다).
  const raw = { name:'X', country:'United States', lang:'EN', email:'x@x.com', dealer:'D', phone:'1' };
  const r = L.checkRow(raw, CFG, REGIONCFG);
  assert.strictEqual(r.hdRegion, 'NA', 'NA 는 자동제안 대상이 아니다');
  assert.strictEqual(r.regionItems.autoCheck, false);
});

test('국가 열에 ISO 코드만 있으면(예: US) Region 은 추측하지 않는다 — 실제 템플릿은 전체 이름을 쓴다', () => {
  const raw = { name:'X', country:'US', lang:'EN', email:'x@x.com', dealer:'D', phone:'1' };
  const r = L.checkRow(raw, CFG, REGIONCFG);
  assert.strictEqual(r.hdRegion, null);
});

/* ═════════════════ Member of Dealer — 절대 자동으로 안 채운다 ═════════════════ */

test('머리글의 "Member of Dealer" 는 별도 칸으로만 잡고, 딜러사명(FIELDS.dealer) 으로는 절대 안 흘러든다', () => {
  const header = ['Full Name', 'Country', 'Preferred Language', 'Email', 'Member of Dealer', 'Mobile (entry)'];
  const hit = L.mapHeader(header);
  assert.strictEqual(hit.memberOfDealer, 4);
  assert.strictEqual(hit.dealer, undefined, '"Member of Dealer" 안의 dealer 를 딜러사명 칸으로 주우면 안 된다');
});

test('Member of Dealer 값은 그대로 옮겨지되 검증·자동화 대상에서는 빠진다', () => {
  const raw = { name:'X', country:'KR', lang:'KO', email:'x@x.com', dealer:'', phone:'1',
                memberOfDealer:'ABC Motors' };
  const r = L.checkRow(raw, CFG, REGIONCFG);
  assert.strictEqual(r.memberOfDealer, 'ABC Motors');
  // 딜러사명(필수 항목)이 비었으니 그 이유로는 검토 필요가 맞지만,
  // memberOfDealer 자체는 problems 판단에 관여하지 않아야 한다(자동화 대상이 아니므로 옳고 그름을 판정하지 않는다).
  assert.ok(r.review.indexOf('딜러사명') !== -1);
});

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
