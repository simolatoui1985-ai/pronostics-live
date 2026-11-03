const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [dataF, rmsF, outDir, only] = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataF)), rms = JSON.parse(fs.readFileSync(rmsF));
  const total = Math.round(data.total * 30);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(([d, r]) => { window.DATA = d; window.RMS = r; }, [data, rms]);
  await p.goto('file://' + process.cwd() + '/scene2.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  fs.mkdirSync(outDir, { recursive: true });
  const list = only ? only.split(',').map(Number) : [...Array(total).keys()];
  for (const f of list) {
    await p.evaluate((f) => window.renderFrame(f), f);
    await p.screenshot({ path: `${outDir}/f${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 });
  }
  await b.close();
  console.log('ok', list.length);
})();
