/* global document, window, performance, getComputedStyle -- page callbacks run in the browser */
// #183 e2e: real app, real Toaster, real layout. Toasts are raised through the app's own
// react-hot-toast module instance (same Vite dep URL), so they go through PassThroughToaster.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/183-e2e.cjs <baseUrl> <screenshotDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  await p.waitForFunction(() => document.querySelector('[data-rht-toaster]'), null, {
    timeout: 90000,
  });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${out}/0-ohne-toast.png` });

  // Raise a toast; `action` adds a button like undoToast in useBoard.tsx
  const raise = (text, action) =>
    p.evaluate(
      async ([text, action]) => {
        const url = (name) =>
          performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .find((n) => n.includes(`/deps/${name}.js`));
        const { default: toast } = await import(url('react-hot-toast'));
        const React = (await import(url('react'))).default;
        window.__actionClicks = 0;
        const id = action
          ? toast(
              () =>
                React.createElement(
                  'span',
                  { className: 'text-xs' },
                  text,
                  React.createElement(
                    'button',
                    { className: 'ml-3', onClick: () => window.__actionClicks++ },
                    action
                  )
                ),
              { duration: 60000 }
            )
          : toast(text, { duration: 60000 });
        return id;
      },
      [text, action]
    );
  // Visible opacity of the toast body: CSS opacity times a filter: opacity(…)
  const seen = (loc) =>
    loc.evaluate((e) => {
      const s = getComputedStyle(e);
      const f = /opacity\(([\d.]+)\)/.exec(s.filter);
      return Number(s.opacity) * (f ? Number(f[1]) : 1);
    });
  const bar = () => p.locator('[data-toast-close]').first().locator('..');

  // AC-1: a real control under the toast body receives the click
  await raise('Agent fertig: Board aktualisiert – dieser Toast liegt über den Controls');
  await bar().waitFor();
  await p.waitForTimeout(600); // enter animation
  const box = await bar().boundingBox();
  const x = box.x + 20,
    y = box.y + box.height / 2;
  const under = await p.evaluate(
    ([x, y]) => {
      window.__clicked = null;
      document.addEventListener(
        'click',
        (e) => (window.__clicked = e.target.outerHTML.slice(0, 80)),
        { capture: true, once: true }
      );
      const el = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-rht-toaster]'));
      return el ? el.outerHTML.slice(0, 80) : null;
    },
    [x, y]
  );
  check(
    'AC-1 topmost hit element at toast is not the toast',
    await p.evaluate(
      ([x, y]) => !document.elementFromPoint(x, y)?.closest('[data-rht-toaster]'),
      [x, y]
    )
  );
  await p.mouse.move(x, y);
  await p.waitForTimeout(300);
  const opacity = await seen(bar());
  check('AC-1 toast fades while hovered (opacity <= 0.2)', opacity <= 0.2, `opacity ${opacity}`);
  await p.screenshot({ path: `${out}/2-hover-durchsichtig.png` });
  await p.mouse.down();
  await p.mouse.up();
  const clicked = await p.evaluate(() => window.__clicked);
  check(
    'AC-1 click reaches the element below',
    !!clicked && clicked === under,
    `under ${under} / clicked ${clicked}`
  );

  // AC-2: back to full opacity once the pointer leaves
  await p.mouse.move(box.x - 200, box.y + box.height + 200);
  await p.waitForTimeout(300);
  const back = await seen(bar());
  check('AC-2 full opacity after leaving', back === 1, `opacity ${back}`);
  await p.screenshot({ path: `${out}/1-toast-sichtbar.png` });

  // AC-3: × closes the toast
  await p.getByRole('button', { name: 'Benachrichtigung schließen' }).first().click();
  await p.waitForTimeout(2500); // exit animation + removeDelay
  check('AC-3 × removes the toast', (await p.locator('[data-toast-close]').count()) === 0);

  // AC-4: action button stays opaque and clickable
  await raise('Status geändert', 'Rückgängig');
  const action = p.getByRole('button', { name: 'Rückgängig' });
  await action.waitFor();
  await p.waitForTimeout(600);
  await action.hover();
  await p.waitForTimeout(300);
  const actOpacity = await seen(bar());
  check(
    'AC-4 toast stays opaque over its action button',
    actOpacity === 1,
    `opacity ${actOpacity}`
  );
  await p.screenshot({ path: `${out}/3-aktion.png` });
  await action.click();
  check('AC-4 action button click fires', (await p.evaluate(() => window.__actionClicks)) === 1);

  await b.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
