/** Contract fixture; deliberately does not claim to exercise Windows OLE drag/drop. */
export async function checkDropControls(browser, address, assert, screenshotPath) {
  const page = await browser.newPage({ viewport: { width: 700, height: 600 }, reducedMotion: 'reduce' });
  try {
    await page.addInitScript(() => {
      const listeners = new Map(); window.__dropTest = { listeners, calls: [] };
      window.__TAURI__ = {
        event: { async listen(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); } },
        core: { async invoke(command, args) {
          if (command === 'get_settings') return { schema_version: 1, drop_enabled: true, media_enabled: false, motion: 'reduced', privacy_mode: true };
          if (command === 'get_audio_snapshot') return { sequence: 0, status: 'disabled', output: null, input: null, devices: [], sessions: [], error: null };
          if (command === 'get_media_snapshot') return { sequence: 0, status: 'disabled', sessions: [], activeSessionId: null, error: null };
          if (command === 'get_displays') return [];
          if (command === 'get_autostart') return false;
          if (command === 'set_expanded') return 1;
          if (command === 'drop_action') { window.__dropTest.calls.push(args); return {operationId:'action:1',outcome:'success',message:args.action==='zip'?'ZIP comprimido creado.':'Ruta copiada.',file:null}; }
        } },
      };
    });
    await page.goto(address);
    await page.waitForFunction(() => !document.getElementById('toggle').disabled);
    await page.evaluate(() => window.__dropTest.listeners.get('nivo://drop-phase')({ payload: 'enter' }));
    await page.locator('#drop').waitFor({ state: 'visible' });
    await page.evaluate(() => window.__dropTest.listeners.get('nivo://drop-phase')({ payload: 'leave' }));
    await page.waitForFunction(() => document.getElementById('toggle').getAttribute('aria-expanded') === 'false');
    await page.evaluate(() => window.__dropTest.listeners.get('nivo://drop-files')({ payload: [{ id: 'drop:7:0', name: 'private.txt', size: 5 }] }));
    await page.locator('#drop-list button').first().click();
    await page.waitForFunction(() => window.__dropTest.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__dropTest.calls[0]), { action: 'copyPath', id: 'drop:7:0' });
    assert.equal(await page.locator('#drop-list h2').textContent(), 'Archivo 1');
    assert.equal(await page.locator('#drop-list').textContent().then(value => value.includes('private.txt')), false);
    if (screenshotPath) await page.locator('#island').screenshot({ path: screenshotPath });
    await page.locator('#drop-zip').click();
    await page.waitForFunction(() => window.__dropTest.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__dropTest.calls[1]), { action: 'zip', id: null });
  } finally { await page.close(); }
}
