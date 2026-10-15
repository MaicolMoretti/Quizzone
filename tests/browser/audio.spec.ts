import { test, expect } from '@playwright/test';

// WAV PCM deterministico, senza servizi esterni né tracce protette.
function wav() {
  const rate = 8000, samples = rate * 10;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 1000), 44 + i * 2);
  return buffer;
}

test('Domanda audio: editor, salvataggio, riproduzione nelle tre viste e arresto al cambio domanda', async ({ page, browser }) => {
  const audioUrl = 'http://127.0.0.1:3100/test-audio.wav';
  const audioBytes = wav();
  await page.context().route('**/test-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audioBytes }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('host@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole('link', { name: /Nuovo quiz/ }).click();
  await page.getByLabel('Titolo del Quiz').fill('Indovina la canzone');
  await page.getByRole('button', { name: /Crea e procedi/ }).click();
  await expect(page).toHaveURL(/\/edit$/, { timeout: 15000 });
  const fillQuestion = async (text: string) => {
    await page.getByLabel('Testo della domanda').fill(text);
    for (const [i, letter] of ['A', 'B', 'C', 'D'].entries()) await page.getByLabel(`Risposta ${letter}`, { exact: true }).fill(`Titolo ${i + 1}`);
    await page.getByLabel('Corretta', { exact: true }).first().check();
    await page.getByLabel('Tempo lettura').fill('0');
    await page.getByLabel('Tempo risposta').fill('60');
  };
  await fillQuestion('Qual è il titolo della canzone?');
  await page.getByLabel('URL traccia audio (opzionale)').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Salva quiz' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'URL audio' })).toBeVisible();
  await page.getByLabel('URL traccia audio (opzionale)').fill(audioUrl);
  const preview = page.getByLabel('Traccia audio della domanda');
  await preview.evaluate(async (element: HTMLAudioElement) => { await element.play(); });
  await expect.poll(() => preview.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '+ Aggiungi domanda', exact: true }).click();
  await fillQuestion('Domanda senza audio');
  await page.getByRole('button', { name: 'Salva quiz' }).click();
  await expect(page.getByText('Nessuna modifica da salvare', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('URL traccia audio (opzionale)')).toHaveValue(audioUrl);
  await page.getByRole('link', { name: /Dashboard/ }).click();
  await page.locator('article').filter({ hasText: 'Indovina la canzone' }).getByRole('button', { name: 'Avvia', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const link = await page.locator('a[href*="/play/"]').getAttribute('href');
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await playerContext.route('**/test-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audioBytes }));
  const player = await playerContext.newPage(), screen = await page.context().newPage();
  try {
    await player.goto(link!);
    await player.getByLabel('Come ti chiami?').fill('Ascoltatore');
    await player.getByRole('button', { name: 'Partecipa', exact: true }).click();
    await expect(player.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await screen.goto(page.url().replace('/admin', '/presentation'));
    await page.getByRole('button', { name: 'Inizia il quiz' }).click();
    for (const view of [page, player, screen]) {
      const audio = view.getByLabel('Traccia audio della domanda');
      await expect(audio).toBeVisible();
      await expect(audio.locator('source')).toHaveAttribute('src', audioUrl);
    }
    const oldAudio = await player.getByLabel('Traccia audio della domanda').elementHandle();
    await oldAudio!.evaluate(async (element: HTMLAudioElement) => { await element.play(); });
    await player.getByRole('button', { name: 'A Titolo 1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prossima domanda', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Prossima domanda', exact: true }).click();
    for (const view of [page, player, screen]) {
      await expect(view.getByRole('heading', { name: 'Domanda senza audio' })).toBeVisible();
      await expect(view.getByLabel('Traccia audio della domanda')).toHaveCount(0);
    }
    expect(await oldAudio!.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  } finally { await playerContext.close(); await screen.close(); }
});

test('Traccia audio non disponibile: errore leggibile nell’anteprima', async ({ page }) => {
  await page.route('**/missing-audio.mp3', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('host@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole('link', { name: /Nuovo quiz/ }).click();
  await page.getByLabel('Titolo del Quiz').fill('Audio mancante');
  await page.getByRole('button', { name: /Crea e procedi/ }).click();
  await expect(page).toHaveURL(/\/edit$/, { timeout: 15000 });
  await page.getByLabel('URL traccia audio (opzionale)').fill('http://127.0.0.1:3100/missing-audio.mp3');
  await page.getByLabel('Traccia audio della domanda').evaluate((element: HTMLAudioElement) => { void element.play().catch(() => {}); });
  await expect(page.getByRole('alert').filter({ hasText: 'Impossibile riprodurre' })).toBeVisible();
});
