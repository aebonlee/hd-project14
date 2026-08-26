/**
 * portal-fill.mjs — 검증된 JSON 을 Access Portal 입력칸에 **대신 채워 넣는다**
 *
 *   node scripts/portal-fill.mjs 딜러등록_20260826.json
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠ 로그인은 **사람이 직접** 합니다. 자동 로그인 기능은 넣지 않았습니다.
 *
 *    사내 정책상 로그인 자동화가 금지되어 있고, 외부 포털 로그인도 마찬가지입니다.
 *    그래서 이 스크립트는 아이디·비밀번호를 **받지도, 저장하지도, 묻지도 않습니다.**
 *
 *    흐름은 이렇습니다.
 *      ① 스크립트가 브라우저 창을 엽니다
 *      ② **사람이 평소대로 로그인합니다** (사번·비밀번호·OTP 무엇이든)
 *      ③ 준비되면 터미널에서 Enter — 그때부터 입력칸 채우기를 시작합니다
 *      ④ 딜러마다 사람이 확인하고 **직접 Save** 를 누릅니다
 *
 *    로그인 창을 사람이 쓰므로 계정 정보가 코드·파일·환경변수 어디에도 남지 않습니다.
 * ══════════════════════════════════════════════════════════════════════
 *
 *  세션은 `.portal-session/` 에 남습니다(브라우저 프로필).
 *  다음에 다시 돌릴 때 로그인이 유지되어 있을 수 있습니다 —
 *  그 폴더는 .gitignore 에 들어 있고, 공용 PC 에서는 쓰고 나서 지우세요.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

const PORTAL = process.env.HD_PORTAL_URL || 'https://access.hd-ce.com/Admin/Dealer/List';
const SESSION_DIR = path.join(process.cwd(), '.portal-session');

/**
 * 포털 화면의 입력칸 이름. 개발자도구에서 확인해 채우세요.
 * 비어 있으면 스크립트가 스스로 멈춥니다 — 엉뚱한 곳에 입력하지 않도록.
 */
const SELECTORS = {
  newBtn:  '',
  profile: { name: '', country: '', language: '', email: '', dealer: '', phone: '' },
  authTab: '',
  perms:   { dealernet: '', parts: '', ordering: '', mydevelon: '', irw: '' },
  // saveBtn 은 일부러 두지 않습니다. 저장은 사람이 누릅니다.
};

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

function assertSelectors() {
  const flat = [SELECTORS.newBtn, ...Object.values(SELECTORS.profile),
                SELECTORS.authTab, ...Object.values(SELECTORS.perms)];
  if (flat.some(v => !v)) {
    console.error('\n아직 실행할 수 없습니다 — 포털 화면의 입력칸 이름(SELECTORS)이 비어 있습니다.');
    console.error('채우는 방법은 guide.html 의 「포털 입력」 절을 보세요.');
    console.error('비어 있는 채로 돌리면 엉뚱한 곳에 입력할 수 있어 여기서 멈춥니다.\n');
    process.exit(2);
  }
}

/** 어떤 딜러를 넣을지 사람이 고른다. 전부 넣는 것이 기본이 아니다. */
async function choose(dealers) {
  console.log('\n등록할 딜러를 고르세요.\n');
  dealers.forEach((d, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${d.name} · ${d.dealer} (${d.country})  ${d.email}`);
  });
  console.log('\n  전부  → a');
  console.log('  일부  → 번호를 쉼표로 (예: 1,3,5)  또는 범위 (예: 2-4)');
  console.log('  취소  → 그냥 Enter\n');

  const ans = await ask('선택: ');
  if (!ans) return [];
  if (/^a(ll)?$/i.test(ans)) return dealers.map((_, i) => i);

  const picked = new Set();
  for (const part of ans.split(',')) {
    const s = part.trim();
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(s);
    if (range) {
      for (let n = +range[1]; n <= +range[2]; n++) picked.add(n - 1);
    } else if (/^\d+$/.test(s)) {
      picked.add(+s - 1);
    } else if (s) {
      console.error(`  알 수 없는 입력: "${s}" — 무시합니다`);
    }
  }
  // 범위 밖 번호는 조용히 버리지 않고 알린다
  const bad = [...picked].filter(i => i < 0 || i >= dealers.length);
  if (bad.length) console.error(`  없는 번호: ${bad.map(i => i + 1).join(', ')} — 무시합니다`);
  return [...picked].filter(i => i >= 0 && i < dealers.length).sort((a, b) => a - b);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: node scripts/portal-fill.mjs <딜러등록.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dealers = data.dealers || [];
  if (!dealers.length) { console.error('등록할 딜러가 없습니다.'); process.exit(1); }

  assertSelectors();

  const idx = await choose(dealers);
  if (!idx.length) { console.log('취소했습니다.'); process.exit(0); }
  console.log(`\n${idx.length}명을 입력합니다.\n`);

  const { chromium } = await import('playwright');
  // 세션을 남겨 두면 다음에 로그인 상태가 유지될 수 있다.
  // headless:false — 사람이 로그인해야 하고, 무엇이 입력되는지 보여야 한다.
  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false, slowMo: 120, viewport: { width: 1400, height: 900 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });

    console.log('브라우저가 열렸습니다.');
    console.log('  → 화면에서 **직접 로그인**하세요. (이 스크립트는 계정 정보를 다루지 않습니다)');
    console.log('  → 딜러 목록 화면이 보이면 여기로 돌아와 Enter 를 누르세요.\n');
    await ask('로그인이 끝났으면 Enter: ');

    for (const [n, i] of idx.entries()) {
      const d = dealers[i];
      console.log(`[${n + 1}/${idx.length}] ${d.name} · ${d.dealer} (${d.country})`);

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
        if (level) await page.selectOption(sel, level);
      }

      /* ⚠ 저장하지 않습니다.
         기획서 요구: "최종 Save 전 검토 단계 필요 — 사람이 확인 후 저장".
         자동으로 저장하면 잘못 들어간 것을 되돌리기가 훨씬 번거롭습니다. */
      console.log('    입력을 마쳤습니다 — 화면에서 확인하고 **직접 Save** 를 누르세요.');
      const go = await ask('    다음으로 넘어가려면 Enter (그만두려면 q): ');
      if (/^q/i.test(go)) { console.log('    중단합니다.'); break; }
    }

    console.log('\n끝났습니다. 저장 여부는 각 화면에서 확인하세요.');
  } catch (e) {
    console.error('\n실패:', e.message);
    console.error('입력칸 이름(SELECTORS)이 화면과 맞는지 확인하세요. 포털이 개편되면 바뀝니다.');
  } finally {
    console.log('브라우저는 열어 둡니다. 확인이 끝나면 직접 닫으세요.');
    console.log(`세션은 ${SESSION_DIR} 에 남습니다 — 공용 PC 라면 지우세요.`);
  }
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
