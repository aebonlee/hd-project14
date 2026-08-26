/**
 * portal-fill.mjs — 검증된 JSON 을 Access Portal 에 대신 입력한다 (Playwright)
 *
 *   node scripts/portal-fill.mjs 딜러등록_20260826.json
 *
 * ⚠ 이 스크립트는 **아직 완성할 수 없습니다.**
 *   화면의 입력칸 이름(선택자)을 알아야 하는데, 포털이 사외에서만 열리고
 *   로그인해야 볼 수 있습니다. 그래서 아래 SELECTORS 를 비워 두었습니다.
 *   개발자도구로 확인해 채우면 그대로 돕니다 — 나머지 흐름은 다 되어 있습니다.
 *
 * ⚠ 계정 정보는 **코드에 적지 않습니다.** 환경변수로만 받습니다.
 *     export HD_PORTAL_USER='...'
 *     export HD_PORTAL_PASS='...'
 *   .env 파일을 쓴다면 반드시 .gitignore 에 넣으세요.
 *   한 번 커밋한 비밀번호는 지워도 커밋 기록에 남습니다.
 *
 * ⚠ 로그인 자동화는 **사내 보안 정책을 먼저 확인**하세요.
 *   자동 로그인을 금지하는 곳이 많고, 계정 잠금으로 이어질 수 있습니다.
 */
import fs from 'node:fs';
import process from 'node:process';

const PORTAL = process.env.HD_PORTAL_URL || 'https://access.hd-ce.com/Admin/Dealer/List';
const USER = process.env.HD_PORTAL_USER;
const PASS = process.env.HD_PORTAL_PASS;

/** 개발자도구에서 확인해 채우세요. 비어 있으면 스크립트가 스스로 멈춥니다. */
const SELECTORS = {
  login:   { user: '', pass: '', submit: '' },
  newBtn:  '',
  profile: { name: '', country: '', language: '', email: '', dealer: '', phone: '' },
  authTab: '',
  perms:   { dealernet: '', parts: '', ordering: '', mydevelon: '', irw: '' },
  saveBtn: ''
};

function assertReady() {
  const missing = [];
  if (!USER || !PASS) missing.push('HD_PORTAL_USER / HD_PORTAL_PASS 환경변수');
  const flat = [
    ...Object.values(SELECTORS.login), SELECTORS.newBtn,
    ...Object.values(SELECTORS.profile), SELECTORS.authTab,
    ...Object.values(SELECTORS.perms), SELECTORS.saveBtn
  ];
  if (flat.some(v => !v)) missing.push('SELECTORS (포털 화면의 입력칸 이름)');
  if (missing.length) {
    console.error('아직 실행할 수 없습니다 — 다음이 필요합니다:');
    missing.forEach(m => console.error('  · ' + m));
    console.error('\n채우는 방법은 README 의 「포털 자동 입력」 절을 보세요.');
    process.exit(2);
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node scripts/portal-fill.mjs <딜러등록.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dealers = data.dealers || [];
  if (!dealers.length) { console.error('등록할 딜러가 없습니다.'); process.exit(1); }

  assertReady();

  const { chromium } = await import('playwright');
  // headless:false — 사람이 보는 앞에서 돌린다. 무엇이 입력되는지 보이지 않으면
  // 잘못 들어가도 알 수 없다.
  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const page = await browser.newPage();

  try {
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
    await page.fill(SELECTORS.login.user, USER);
    await page.fill(SELECTORS.login.pass, PASS);
    await page.click(SELECTORS.login.submit);
    await page.waitForLoadState('networkidle');

    for (const [i, d] of dealers.entries()) {
      console.log(`[${i + 1}/${dealers.length}] ${d.name} · ${d.dealer} (${d.country})`);
      await page.click(SELECTORS.newBtn);

      await page.fill(SELECTORS.profile.name, d.name);
      await page.selectOption(SELECTORS.profile.country, d.country);
      await page.fill(SELECTORS.profile.language, d.language || '');
      await page.fill(SELECTORS.profile.email, d.email);
      await page.fill(SELECTORS.profile.dealer, d.dealer);
      await page.fill(SELECTORS.profile.phone, d.phone || '');

      await page.click(SELECTORS.authTab);
      for (const [key, sel] of Object.entries(SELECTORS.perms)) {
        const level = d.permissions?.[key];
        if (!level) continue;
        await page.selectOption(sel, level);
      }

      /* ⚠ 여기서 **저장하지 않는다.**
         기획서 요구: "최종 Save 전 검토 단계 필요 — 사람이 확인 후 저장".
         자동으로 저장해 버리면 잘못 들어간 것을 되돌리기가 훨씬 번거롭다. */
      console.log('    입력 완료 — 화면에서 확인한 뒤 직접 Save 하세요.');
      console.log('    확인이 끝나면 Enter 를 누르면 다음 딜러로 넘어갑니다.');
      await new Promise(r => process.stdin.once('data', r));
    }
    console.log('\n모두 입력했습니다. 저장 여부는 각 화면에서 확인하세요.');
  } finally {
    // 브라우저를 자동으로 닫지 않는다 — 확인 중인 화면이 사라지면 곤란하다
    console.log('브라우저는 열어 둡니다. 확인이 끝나면 직접 닫으세요.');
  }
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
