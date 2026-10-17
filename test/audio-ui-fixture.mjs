/** Browser-only adapter: verifies controls without changing a real Windows device. */
export async function checkAudioControls(browser, address, assert) {
  const page = await browser.newPage({ viewport: { width: 700, height: 600 }, reducedMotion: 'reduce' });
  try {
    await page.addInitScript(() => {
      const snapshot = { sequence: 1, status: 'ready', output: { id: 'out', name: 'Salida fixture', volume: .42, muted: false },
        input: { id: 'in', name: 'Entrada fixture', volume: .6, muted: false },
        devices: [{ id: 'out', name: 'Salida fixture' }], sessions: [{ id: 'session-fixture', name: 'Aplicación fixture', volume: .7, muted: false, active: true }], error: null };
      const listeners = new Map(); window.__audioTest = { calls: [], snapshot };
      window.__TAURI__ = {
        event: { async listen(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); } },
        core: { async invoke(command, args) {
          if (command === 'get_settings') return { schema_version: 1, audio_enabled: true, media_enabled: false, motion: 'reduced' };
          if (command === 'get_audio_snapshot') return snapshot;
          if (command === 'get_media_snapshot') return { sequence: 0, status: 'disabled', sessions: [], activeSessionId: null, error: null };
          if (command === 'get_displays') return [];
          if (command === 'get_autostart') return false;
          if (command === 'set_expanded') return 1;
          if (command === 'audio_control') {
            const action = args.action; window.__audioTest.calls.push(action);
            if (action.kind === 'outputVolume') snapshot.output.volume = action.value;
            if (action.kind === 'inputMute') snapshot.input.muted = action.muted;
            if (action.kind === 'sessionVolume') snapshot.sessions[0].volume = action.value;
            snapshot.sequence++;
            listeners.get('nivo://audio')?.({ payload: structuredClone(snapshot) });
          }
        } },
      };
    });
    await page.goto(address);
    await page.waitForFunction(() => !document.getElementById('toggle').disabled);
    await page.locator('#toggle').click();
    await page.getByRole('button', { name: 'Sonido', exact: true }).click();
    assert.equal(await page.locator('#output-name').textContent(), 'Salida fixture');
    assert.equal(await page.locator('#output-volume').inputValue(), '42');
    await page.locator('#output-volume').fill('35');
    await page.waitForFunction(() => window.__audioTest.calls.length >= 1);
    await page.locator('#toggle').click();
    await page.getByRole('button', { name: 'Sonido', exact: true }).click();
    await page.locator('#audio-sessions input').fill('25');
    await page.waitForFunction(() => window.__audioTest.calls.length >= 2);
    const calls = await page.evaluate(() => window.__audioTest.calls);
    assert.deepEqual(calls[0], { kind: 'outputVolume', id: 'out', value: .35 });
    assert.deepEqual(calls[1], { kind: 'sessionVolume', id: 'session-fixture', value: .25 });
    assert.equal(await page.locator('#audio-sessions .audio-session').count(), 1);
  } finally { await page.close(); }
}
