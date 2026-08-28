/* 브라우저에 실제로 띄워 화면이 그려지는지 본다.
 *
 *   node test/smoke.browser.js
 *
 * 규칙 테스트(test/logic.test.js)가 19개 전부 통과해도 app.js 의 오타 하나면
 * 페이지가 빈 화면이 된다. 규칙은 맞는데 아무도 그것을 볼 수 없는 상태다.
 * 파일을 읽어서는 안 잡힌다 — 실제로 띄워 봐야 잡힌다.
 *
 * 「예제 엑셀로 해보기」 단추가 엑셀 읽기 → 줄 검증 → 국가별 권한 결정 →
 * 표 그리기까지 한 번에 지나가므로, 그것을 누르는 것이 가장 넓게 훑는 길이다.
 *
 * playwright 가 없으면 **조용히 건너뛴다.** 이것 하나 때문에 다른 테스트가
 * 막히면 아무도 안 돌리게 된다. CI 에서는 설치하고 돌린다.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다 (CI 에서는 설치 후 돌립니다).');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function group(t) { console.log('\n' + t); }
function ok(c, label, detail) {
  if (c) passed++; else { failed++; console.log('  X ' + label); if (detail) console.log('      ' + detail); }
}
function eq(g, w, label) { ok(String(g) === String(w), label, '기대: ' + w + '  실제: ' + g); }

/* 정적 서버가 내주는 MIME.
 *
 * ⚠ **.mjs 를 빠뜨리면 안 된다.** 브라우저는 모듈 스크립트의 MIME 을 엄격히
 * 검사해서, octet-stream 으로 오면 실행을 거부한다. 실제로 그렇게 만들었다가
 * 화면이 영영 그려지지 않아 30초를 기다린 끝에 시간 초과로만 끝났다 —
 * 무엇이 잘못됐는지는 한 마디도 나오지 않았다.
 * (이 저장소도 .mjs 를 쓴다 — scripts/portal-fill.mjs)
 */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* 서버가 내주지 못한 것을 모아 둔다. 테스트가 못 서는 이유가
 * 앱이 아니라 이 서버일 수 있고, 그때 시간 초과만 나면 원인을 못 찾는다. */
var missed = [];

function serve(port) {
  return http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      missed.push(rel);
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}

(async function main() {
  var PORT = 8814;
  var server = serve(PORT);
  var browser = await chromium.launch();
  var errors = [];

  try {
    var page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });

    group('1. 첫 화면');
    /* <input type=file> 은 css 로 감춰 두고 .drop 라벨이 그 자리를 대신한다. */
    ok(await page.isVisible('#drop'), '파일을 끌어다 놓는 자리가 보인다');
    ok(await page.locator('#file').count() === 1, '파일 입력이 붙어 있다');
    ok(await page.isVisible('#sample'), '예제 단추가 보인다');
    eq((await page.textContent('#out')).trim(), '', '처음엔 결과가 비어 있다');

    group('2. 국가별 권한 매핑을 읽어 온다');
    /* config/permissions.json 하나가 정본이다. 못 읽으면 권한을 정할 수 없다. */
    await page.waitForSelector('#cfg', { timeout: 15000 });
    var cfg = await page.textContent('#cfg');
    ok(cfg.indexOf('읽지 못했습니다') < 0, '권한 매핑을 읽었다', cfg.slice(0, 120));

    group('3. 예제 엑셀 한 번으로 검증까지 지나간다');
    await page.click('#sample');
    try {
      await page.waitForSelector('#out table', { timeout: 30000 });
    } catch (e) {
      var dump = (await page.textContent('#out')).replace(/\s+/g, ' ').slice(0, 160);
      ok(false, '예제를 눌러 표가 그려진다',
         '#out: ' + (dump || '(비어 있음)') +
         ' | 못 내준 파일: ' + (missed.length ? missed.join(', ') : '없음') +
         ' | 오류: ' + (errors.slice(0, 2).join(' | ') || '없음'));
      throw e;
    }

    var rows = await page.locator('#out table tbody tr').count();
    ok(rows > 0, '검증 결과에 줄이 있다 (' + rows + '줄)');
    var stats = await page.$$eval('#out .stat', function (els) {
      return els.map(function (e) { return e.textContent.trim(); });
    });
    ok(stats.length >= 3, '요약 숫자가 나온다', JSON.stringify(stats));

    group('3-1. Region 자동 매핑 — 임나연 수정요청');
    /* 샘플에 LA 지역(Guatemala) 딜러 한 줄을 섞어 두었다 — 정말로 화면에 반영되는지 본다. */
    var regionBadges = await page.locator('#out .badge-auto').count();
    ok(regionBadges > 0, 'APAC/LA/MEA Region 배지가 뜬다 (' + regionBadges + '개)');
    var itemBoxes = await page.locator('#out .region-items input[type=checkbox]').count();
    ok(itemBoxes === 26, 'Items to Select 26개가 전부 나온다 (' + itemBoxes + '개)');
    var itemUnchecked = await page.locator('#out .region-items input:not(:checked)').count();
    ok(itemUnchecked === 0, '제안 체크박스는 전부 켜져 있다');
    var regionNote = await page.textContent('#out');
    ok(regionNote.indexOf('제안일 뿐입니다') >= 0, '자동 제안일 뿐 실제 제출이 아니라고 분명히 적는다');

    group('4. 문제 있는 줄은 고치지 않고 알린다');
    var text = await page.textContent('#out');
    ok(text.indexOf('검토필요') >= 0 || text.indexOf('모든 줄이 등록 가능합니다') >= 0,
       '검증 결과를 밝힌다');
    if (text.indexOf('검토필요') >= 0) {
      ok(text.indexOf('고쳐서 채우지 않습니다') >= 0,
         '고쳐 주지 않는다고 분명히 적는다');
    }

    group('5. 넣을 줄은 사람이 고른다');
    /* 검토가 필요한 줄은 기본으로 꺼 둔다. 켜 두면 그대로 내보내기 쉽다. */
    var boxes = await page.locator('#out .chk').count();
    ok(boxes === rows, '줄마다 체크박스가 있다 (' + boxes + '/' + rows + ')');
    var checked = await page.locator('#out .chk:checked').count();
    ok(checked < rows, '검토가 필요한 줄은 기본으로 꺼져 있다 (' + checked + '/' + rows + ' 켜짐)');
    eq(await page.textContent('#sel-n'), String(checked), '고른 줄 수를 세어 보여 준다');

    /* 전체 선택을 누르면 다 켜지고 숫자가 따라온다 */
    await page.check('#chk-all');
    await page.waitForTimeout(150);
    eq(await page.locator('#out .chk:checked').count(), rows, '전체 선택이 모든 줄을 켠다');
    eq(await page.textContent('#sel-n'), String(rows), '숫자가 따라온다');

    group('6. 내려받기 단추가 살아 있다');
    ok(await page.isVisible('#dl-xlsx'), '엑셀로 내려받기');
    ok(await page.isVisible('#dl-json'), 'JSON 으로 내보내기');
    /* 로그인·최종 저장을 사람이 한다는 것이 이 도구의 핵심 약속이다 */
    ok(text.indexOf('로그인은 사람이 직접') >= 0, '로그인은 사람이 한다고 적혀 있다');

    group('7. 좁은 화면에서 가로로 넘치지 않는다');
    await page.setViewportSize({ width: 380, height: 780 });
    await page.waitForTimeout(150);
    var over = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    ok(over <= 1, '가로 스크롤이 생기지 않는다 (넘침 ' + over + 'px)');
    ok(await page.isVisible('#drop'), '좁은 화면에서도 파일 자리가 보인다');

    group('8. 콘솔에 오류가 없다');
    ok(errors.length === 0, '자바스크립트 오류 없음', errors.join(' | '));
    /* 이 서버가 못 내준 파일이 있으면 앱이 아니라 테스트가 틀린 것이다 */
    ok(missed.length === 0, '테스트 서버가 필요한 파일을 다 내줬다', missed.join(', '));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failed ? 'X' : 'O') + ' ' + passed + ' 통과 / ' + failed + ' 실패');
  process.exit(failed ? 1 : 0);
}());
