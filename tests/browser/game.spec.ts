import { test, expect } from '@playwright/test';

test('create, save, reload, launch and play through final archive across three roles', async ({ page, browser, request }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('host@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: /Accedi/ }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole('link', { name: /Nuovo quiz/ }).click();
  await page.getByLabel('Titolo del Quiz').fill('Quiz browser');
  await page.getByRole('button', { name: /Crea e procedi/ }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Testo della domanda').fill('La capitale d’Italia?');
  for (const [letter, answer] of [['A', 'Roma'], ['B', 'Milano'], ['C', 'Torino'], ['D', 'Napoli']]) {
    await page.getByLabel(`Risposta ${letter}`, { exact: true }).fill(answer);
  }
  await page.getByLabel('Corretta', { exact: true }).first().check();
  await page.getByLabel('Tempo lettura').fill('0');
  await page.getByLabel('Tempo risposta').fill('60');
  await page.getByRole('button', { name: 'Salva quiz' }).click();
  await expect(page.getByText('Nessuna modifica da salvare', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Testo della domanda')).toHaveValue('La capitale d’Italia?');
  await expect(page.getByLabel('Risposta A', { exact: true })).toHaveValue('Roma');
  await expect(page.getByLabel('Corretta', { exact: true }).first()).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
  await page.getByRole('link', { name: /Dashboard/ }).click();
  await page.getByRole('button', { name: 'Avvia', exact: true }).click();
  await expect(page).toHaveURL(/\/game\/.*\/admin$/);
  await expect(page.getByRole('heading', { name: 'Aspettiamo i giocatori' })).toBeVisible();
  const link = await page.locator('a[href*="/play/"]').getAttribute('href');
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const player = await playerContext.newPage();
  const screen = await page.context().newPage();
  try {
    await player.goto(link!);
    await player.getByLabel('Come ti chiami?').fill('Anna');
    await player.getByRole('button', { name: 'Partecipa', exact: true }).click();
    await expect(player.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await screen.goto(page.url().replace('/admin', '/presentation'));
    await expect(screen.getByRole('heading', { name: 'Aspettiamo i giocatori' })).toBeVisible();
    await page.getByRole('button', { name: 'Inizia il quiz' }).click();
    await expect(player.getByRole('heading', { name: 'Scegli la tua risposta' })).toBeVisible();
    await player.screenshot({ path: testInfo.outputPath('player.png'), fullPage: true });
    await player.getByRole('button', { name: /A Roma/ }).click();
    await expect(player.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
    await player.reload();
    await expect(player.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi le risposte' }).click();
    await page.getByRole('button', { name: 'Rivela la soluzione' }).click();
    await expect(player.getByText('Risposta corretta!', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mostra la classifica' }).click();
    await expect(screen.getByText('100 punti', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Prosegui' }).click();
    await expect(player.getByRole('heading', { name: 'Il podio finale' })).toBeVisible();
    await page.getByRole('button', { name: 'Concludi e archivia' }).click();
    await expect(player.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
    const archive = await (await request.get('http://127.0.0.1:54325/test/archive')).json();
    expect(archive).toHaveLength(1);
    expect(archive[0].players[0].score).toBe(100);
    expect(archive[0].submissions).toHaveLength(1);
  } finally { await playerContext.close(); await screen.close(); }
});

test('home accepts a code; invalid game displays a recoverable error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Codice partita').fill('000000');
  await page.getByRole('button', { name: 'Entra in partita' }).click();
  await page.getByLabel('Come ti chiami?').fill('Ospite');
  await page.getByRole('button', { name: 'Partecipa', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Partita non trovata' })).toBeVisible();
});
