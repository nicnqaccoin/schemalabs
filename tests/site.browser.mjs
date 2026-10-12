import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = process.env.SCHEMALABS_BASE || 'http://127.0.0.1:8768';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const check = (name, detail = true) => { checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)); };
const errors = [], failed = [];
const paths = ['/', '/playground.html', '/docs.html', '/about.html', '/privacy.html', '/terms.html', '/404.html'];
// Reject unrelated project identities, but allow this company's published registration details.
const unrelatedIdentity = /diffhaven|paytool|pages\.dev/i;
const registryUrl = 'https://find-and-update.company-information.service.gov.uk/company/15348827';
const assertCompanyFooter = async page => {
  const footer = page.locator('.site-footer .footer-company');
  assert.equal(await footer.count(), 1, 'One company disclosure per footer');
  assert.equal(await footer.isVisible(), true, 'Company disclosure is visible');
  assert.match(await footer.innerText(), /Website operated by Schema Labs Ltd\./);
  assert.match(await footer.innerText(), /Company No\. 15348827.*Registered in England and Wales/s);
  assert.match(await footer.innerText(), /Registered office: 20 Wenlock Road, London, England, N1 7GU/);
  assert.equal(await footer.locator('a').getAttribute('href'), '/about.html#company-information');
  assert.equal(await page.locator('.footer-bottom > span').first().innerText(), '© 2026 Schema Labs Ltd');
  assert.doesNotMatch(await page.locator('.footer-bottom').innerText(), /Developer preview/i);
};
assert.equal(unrelatedIdentity.test('Schema Labs Ltd 15348827 20 Wenlock Road'), false);
for (const foreign of ['DiffHaven', 'PayTool', 'schemalabs.pages.dev']) {
  assert.equal(unrelatedIdentity.test(foreign), true, 'Foreign identity matcher still rejects ' + foreign);
}
check('Identity matcher allows company registration and rejects unrelated projects');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  page.on('requestfailed', r => failed.push({ url: r.url(), error: r.failure()?.errorText }));
  const links = new Set();
  for (const path of paths) {
    const response = await page.goto(base + path, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    const state = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      canonical: document.querySelector('link[rel=canonical]')?.href,
      overflow: document.documentElement.scrollWidth > innerWidth,
      brand: document.querySelector('.brand')?.innerText,
      images: [...document.images].filter(x => !x.complete || !x.naturalWidth).map(x => x.src),
      hrefs: [...document.querySelectorAll('a[href]')].map(x => x.getAttribute('href')),
      bodyText: document.body.innerText,
      assets: [...document.querySelectorAll('link[href], script[src]')].map(el => el.getAttribute('href') || el.getAttribute('src')).filter(url => url.startsWith('/assets/')),
    }));
    assert.equal(state.h1, 1, path + ' one H1');
    assert.equal(state.overflow, false, path + ' desktop overflow');
    assert.equal(unrelatedIdentity.test(state.bodyText), false, path + ' identity consistency');
    assert.equal(state.brand?.trim(), 'Schema Labs', path + ' brand consistency');
    assert.equal(state.images.length, 0);
    assert.ok(state.canonical?.startsWith('https://schemalabs.co.uk/'));
    for (const h of state.hrefs) { if (h.startsWith('/')) links.add(h); }
    check('Desktop page ' + path, { status: response.status(), title: await page.title(), canonical: state.canonical });
    await assertCompanyFooter(page);
    check('Company footer ' + path);
    assert.ok(state.assets.length > 0, path + ' publishes assets');
    for (const ref of state.assets) {
      const asset = new URL(ref, base);
      const expected = createHash('sha256').update(await readFile(new URL('../public' + asset.pathname, import.meta.url))).digest('hex').slice(0, 12);
      assert.equal(asset.searchParams.get('v'), expected, path + ' cache version ' + asset.pathname);
    }
    check('Published asset URLs carry exact content versions ' + path, { assets: state.assets.length });
  }
  if (base.startsWith('https:')) {
    const response = await page.goto(base + '/', { waitUntil: 'networkidle' });
    const headers = response.headers();
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    for (const directive of ["style-src 'self'", "worker-src 'self'", "connect-src 'none'"]) {
      assert.ok(headers['content-security-policy']?.includes(directive), 'Production CSP includes ' + directive);
    }
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    check('Production security headers and browser-local CSP are present');
    for (const suffix of ['/', '/playground.html?mode=compare']) {
      const response = await context.request.get('https://www.schemalabs.co.uk' + suffix, { maxRedirects: 0 });
      assert.equal(response.status(), 301);
      assert.equal(response.headers().location, 'https://schemalabs.co.uk' + suffix);
    }
    check('WWW redirects to canonical hostname with path and query preserved');
  }
  await page.goto(base + '/about.html');
  const companySection = page.locator('#company-information');
  assert.equal(await companySection.isVisible(), true);
  assert.equal(await companySection.locator('h2').innerText(), 'Company information');
  assert.equal(await page.locator('.article-nav a[href="#company-information"]').count(), 1);
  const companyFacts = await companySection.locator('.detail-list').evaluate(dl =>
    Object.fromEntries([...dl.querySelectorAll('dt')].map(dt => [dt.innerText.trim(), dt.nextElementSibling.innerText.trim()]))
  );
  assert.deepEqual(companyFacts, {
    'Company name': 'SCHEMA LABS LTD',
    'Company number': '15348827',
    'Company status': 'Active',
    'Company type': 'Private limited company',
    'Incorporated on': '13 December 2023',
    'Jurisdiction': 'England and Wales',
    'Registered office': '20 Wenlock Road, London, England, N1 7GU',
    'Nature of business (SIC)': '62012 — Business and domestic software development',
  });
  assert.equal(await companySection.locator('a[data-company-record]').getAttribute('href'), registryUrl);
  assert.equal(await companySection.locator('a[data-company-record]').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.locator('.site-footer a[href="/about.html#company-information"]').count(), 1);
  check('About company information matches registry fields and exposes the public source');
  await companySection.screenshot({ path: new URL('desktop-company-information.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  await page.locator('.site-footer').screenshot({ path: new URL('desktop-company-footer.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  for (const path of ['/about.html', '/privacy.html', '/terms.html']) {
    await page.goto(base + path);
    assert.match(await page.locator('main [data-company-operator]').innerText(), /Schema Labs Ltd.*operates.*schemalabs\.co\.uk/s);
    assert.doesNotMatch(await page.locator('main').innerText(), /maintainer|Thanh Hưng Nguyễn|independent developer project/i);
    check('Corporate operator is explicit in main content ' + path);
  }
  for (const href of links) {
    const url = new URL(href, base);
    const response = await context.request.get(url.href);
    assert.equal(response.status(), 200, 'Internal link: ' + href);
    if (url.hash) {
      await page.goto(url.href);
      assert.equal(await page.locator('[id="' + decodeURIComponent(url.hash.slice(1)) + '"]').count(), 1);
    }
  }
  check('Every distinct internal link resolves', { count: links.size });
  await page.goto(base + '/');
  await page.locator('#demo-run').click();
  await page.locator('#demo-result').filter({ hasText: '4 breaking changes found.' }).waitFor();
  assert.equal(await page.locator('#demo-run').isEnabled(), true);
  check('Home example calculates actual tightened-schema findings');
  await page.locator('#demo-unchanged').click();
  await page.locator('#demo-run').click();
  await page.locator('#demo-result').filter({ hasText: 'No structural changes detected' }).waitFor();
  check('Home unchanged-schema example is computed');
  await page.locator('#demo-tightened').click();
  await page.locator('#demo-run').click();
  await page.locator('#demo-result').filter({ hasText: '4 breaking changes found' }).waitFor();
  await page.screenshot({ path: new URL('desktop-home.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.goto(base + '/playground.html');
  assert.equal(await page.locator('.pg-head .kicker').innerText(), 'Developer preview');
  check('Developer preview is disclosed in Playground, not the copyright line');
  await page.waitForFunction(() => document.querySelector('#left-editor').value.length > 0);
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'Payload satisfies' }).waitFor();
  check('Playground baseline sample validates');
  await page.locator('#right-editor').fill('{"id":"demo","total":"42.5"}');
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'needs attention' }).waitFor();
  assert.match(await page.locator('#results').innerText(), /\/total/);
  assert.equal(await page.locator('.change-row').count(), 1);
  check('Invalid payload returns exact field path and finding');
  await page.locator('#tab-compare').click();
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: '4 changes' }).waitFor();
  assert.equal(await page.locator('.change-row').count(), 4);
  assert.match(await page.locator('.results-meta').innerText(), /4 breaking/);
  check('Schema comparison reports four breaking findings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-report').click()]);
  const report = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(report.result.breaking, 4);
  assert.equal(report.mode, 'compare');
  assert.equal(Object.hasOwn(report, 'left'), false);
  assert.equal(Object.hasOwn(report, 'right'), false);
  check('Downloaded report contains computed result and no source documents');
  await page.locator('#right-editor').fill(await page.locator('#left-editor').inputValue());
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'No structural changes' }).waitFor();
  check('Identical schemas have no changes');
  await page.locator('#right-editor').fill('{');
  await page.locator('#run-check').click();
  await page.locator('.results-error').waitFor();
  assert.match(await page.locator('#results').innerText(), /not valid JSON/);
  assert.equal(await page.locator('#download-report').isVisible(), false);
  check('Malformed JSON gives clear error and no stale download');
  await page.locator('#clear-inputs').click();
  assert.equal(await page.locator('#left-editor').inputValue(), '');
  assert.equal(await page.locator('#right-editor').inputValue(), '');
  await page.locator('#run-check').click();
  assert.match(await page.locator('#results').innerText(), /empty/);
  check('Clear and empty-input checks work');
  await page.locator('#tab-validate').click();
  await page.locator('#left-editor').fill('{"$ref":"https://example.invalid/schema.json"}');
  await page.locator('#right-editor').fill('{}');
  await page.locator('#run-check').click();
  await page.locator('.results-error').waitFor();
  assert.match(await page.locator('#results').innerText(), /resolve reference/);
  check('Remote reference gives local resolution error');
  await page.locator('#left-editor').fill('{"$schema":"http://json-schema.org/draft-07/schema#","type":"integer"}');
  await page.locator('#right-editor').fill('2');
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'satisfies' }).waitFor();
  check('Draft-07 works through UI');
  await page.locator('#load-example').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#upload-right').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name: 'payload.json', mimeType: 'application/json', buffer: Buffer.from('{"id":"local-file","total":32.5}') });
  await page.waitForFunction(() => document.querySelector('#right-editor').value.includes('local-file'));
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'satisfies' }).waitFor();
  check('Local file input validates without uploading');
  const oversize = '"' + 'é'.repeat(270000) + '"';
  await page.locator('#right-editor').fill(oversize);
  await page.locator('#run-check').click();
  await page.locator('.results-error').waitFor();
  assert.match(await page.locator('#results').innerText(), /512 KB/);
  check('UTF-8 size limit rejects oversized input');
  await page.goto(base + '/playground.html?mode=compare');
  assert.equal(await page.locator('#tab-compare').getAttribute('aria-selected'), 'true');
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: '4 changes' }).waitFor();
  await page.screenshot({ path: new URL('desktop-playground.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  check('Direct comparison route works');
  const apiRequests = [];
  page.on('request', req => {
    if (['fetch', 'xhr'].includes(req.resourceType())) apiRequests.push(req.url());
    assert.equal(new URL(req.url()).origin, new URL(base).origin, 'Unexpected third-party request: ' + req.url());
  });
  await page.goto(base + '/playground.html');
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'satisfies' }).waitFor();
  await page.locator('#tab-compare').click();
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: '4 changes' }).waitFor();
  assert.deepEqual(apiRequests, []);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  assert.deepEqual(storage, { local: 0, session: 0, cookies: '' });
  check('Checks make no document API calls and persist no browser storage');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#right-editor').value.includes('currency'));
  assert.equal(await page.locator('#download-report').isVisible(), false);
  check('Reload clears results');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of paths) {
      await page.goto(base + path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path + ' overflow at ' + width);
      await assertCompanyFooter(page);
      if (path === '/about.html') assert.equal(await page.locator('#company-information').isVisible(), true);
    }
    check('All pages fit viewport', { width, pages: paths.length });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/about.html#company-information');
  await page.locator('#company-information').screenshot({ path: new URL('mobile-company-information.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  await page.locator('.site-footer').screenshot({ path: new URL('mobile-company-footer.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  await page.goto(base + '/');
  assert.equal(await page.locator('#site-nav').isVisible(), false);
  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('#site-nav').isVisible(), true);
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#site-nav').isVisible(), false);
  check('Mobile menu opens and closes via Escape');
  await page.reload();
  assert.equal(await page.locator('.skip').evaluate(e => e.getBoundingClientRect().width), 1);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip').evaluate(e => e === document.activeElement), true);
  assert.ok(await page.locator('.skip').evaluate(e => e.getBoundingClientRect().width) > 40);
  await page.keyboard.press('Tab');
  check('Skip link is hidden normally and keyboard accessible');
  await page.locator('#demo-run').click();
  await page.locator('#demo-result').filter({ hasText: '4 breaking' }).waitFor();
  await page.screenshot({ path: new URL('mobile-home.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.goto(base + '/playground.html');
  await page.locator('#run-check').click();
  await page.locator('.results-title').filter({ hasText: 'satisfies' }).waitFor();
  await page.screenshot({ path: new URL('mobile-playground.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  check('Mobile playground executes same real validator');
  await page.locator('#tab-validate').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-compare').getAttribute('aria-selected'), 'true');
  check('Tool tab keyboard navigation');
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(failed, [], 'Failed requests');
  check('No browser JavaScript, console or request failures');
  await writeFile(new URL('browser-checks.json', output), JSON.stringify({ base, total: checks.length, checks, errors, failed }, null, 2));
  console.log('RESULT', JSON.stringify({ base, checks: checks.length, errors: errors.length, failedRequests: failed.length }));
} finally { await browser.close(); }
