/**
 * Prove touch con profili iPhone e Pixel, eseguite nel browser configurato
 * in Playwright. Verificano QR renderizzato, codice, nickname e partita completa.
 * L’emulazione non riproduce fotocamera reale, tastiera nativa o Safari su iPhone.
 */
import { test, expect, devices, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import jsQR from 'jsqr';

// Prepara un quiz con due domande e mantiene un socket conduttore per guidare la prova.
async function lobby(request: APIRequestContext) {
  const auth = await (await request.post('http://127.0.0.1:54325/auth/v1/token', { data: {} })).json();
  const quiz = await (await request.post('http://127.0.0.1:54325/rest/v1/quizzes', { data: { title: 'Quiz mobile', owner_id: auth.user.id, status: 'draft' } })).json();
  await request.post('http://127.0.0.1:54325/rest/v1/rpc/save_quiz', { data: {
    p_quiz_id: quiz.id, p_expected_updated_at: quiz.updated_at, p_title: 'Quiz mobile', p_description: '',
    p_questions: [0, 1].map(i => ({ id: randomUUID(), question_text: `Domanda mobile ${i + 1}`, preview_seconds: 0, answer_seconds: 60, correct_points: 100, wrong_points: 0,
      answers: [{ id: randomUUID(), answer_text: 'Corretta', is_correct: true }, { id: randomUUID(), answer_text: 'Errata', is_correct: false }] })),
  } });
  const socket = io('http://127.0.0.1:3101', { autoConnect: false, auth: { accessToken: auth.access_token }, reconnection: false });
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
  const result = await socket.timeout(5000).emitWithAck('admin:create_game', { quizId: quiz.id });
  expect(result.ok).toBe(true);
  return { socket, ...result.data.state } as { socket: Socket; gameId: string; gameCode: string };
}
// Sincronizza la revisione prima del comando, come richiesto dal protocollo del motore.
async function command(socket: Socket, event: string, playerId?: string) {
  const synced = await socket.timeout(5000).emitWithAck('game:sync', {});
  const result = await socket.timeout(5000).emitWithAck(event, { revision: synced.data.state.revision, playerId });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.data.state;
}
// Rileva contenuti più larghi della viewport, inclusi nickname lunghi nelle classifiche.
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
// Verifica che i principali pulsanti siano attivi e abbiano un’area di almeno 44×44 pixel.
async function touchTarget(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  const bounds = await button.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  return button;
}
// Rasterizza il vero SVG tramite screenshot e canvas; jsQR ne legge i pixel risultanti.
async function decodeQR(page: Page) {
  const png = await page.locator('aside svg').screenshot();
  const raster = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { pixels: [...ctx.getImageData(0, 0, image.width, image.height).data], width: image.width, height: image.height };
  }, png.toString('base64'));
  const decoded = jsQR(new Uint8ClampedArray(raster.pixels), raster.width, raster.height);
  expect(decoded, 'The rendered QR must be decodable').not.toBeNull();
  return decoded!.data;
}
// Esegue l’accesso dalla UI con l’account simulato prima dei comandi del conduttore.
async function signedIn(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('host@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Accedi', exact: true }).tap();
  await expect(page).toHaveURL(/dashboard/);
  return page;
}

for (const [device, entry] of [['iPhone 13', 'qr'], ['Pixel 7', 'code'], ['iPhone SE', 'code']] as const) {
  test(`${device}: ingresso ${entry}, nickname con tocco, risposte, ricarica, riconnessione e punteggi`, async ({ browser, request }, testInfo) => {
    const game = await lobby(request);
    const emulation = devices[device];
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...emulation });
    const screen = await browser.newPage({ baseURL: 'http://127.0.0.1:3100' });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await screen.goto(`/game/${game.gameId}/presentation`);
      await expect(screen.getByRole('heading', { name: 'Aspettiamo i giocatori' })).toBeVisible();
      // Decodifica i pixel del QR per verificare anche la leggibilità, il codice e l’origine pubblica.
      const invite = await decodeQR(screen);
      expect(invite).toBe(`http://localhost:3100/play/${game.gameCode}`);
      await expect(screen.locator('aside a')).toHaveAttribute('href', invite);
      await expect(screen.locator('aside')).toContainText(game.gameCode);
      if (entry === 'qr') await page.goto(invite);
      else {
        await page.goto('http://localhost:3100/');
        const input = page.getByLabel('Codice partita');
        await expect(input).toHaveAttribute('inputmode', 'numeric');
        await expect(page.getByRole('button', { name: 'Entra in partita' })).toBeDisabled();
        await input.fill('12a'); await expect(input).toHaveValue('12');
        await expect(page.getByRole('button', { name: 'Entra in partita' })).toBeDisabled();
        await input.fill(game.gameCode);
        await noOverflow(page);
        await page.getByRole('button', { name: 'Entra in partita' }).tap();
      }
      await expect(page).toHaveURL(new RegExp(`/play/${game.gameCode}$`));
      const nickname = page.getByLabel('Come ti chiami?');
      await expect(nickname).toHaveAttribute('enterkeyhint', 'go');
      await nickname.fill('   ');
      await expect(page.getByRole('button', { name: 'Partecipa', exact: true })).toBeDisabled();
      await nickname.fill('GiocatriceMobileConNicknameLungo');
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('nickname.png'), fullPage: true });
      await (await touchTarget(page, 'Partecipa')).tap();
      await expect(page.getByText('Sei dentro!', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
      await noOverflow(page);
      await command(game.socket, 'admin:start_game');
      await expect(page.getByRole('heading', { name: 'Scegli la tua risposta' })).toBeVisible();
      await noOverflow(page);
      await (await touchTarget(page, 'A Corretta')).tap();
      await expect(page.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'B Errata', exact: true })).toBeDisabled();
      await page.reload();
      await expect(page.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
      await context.setOffline(true);
      // Interrompe esplicitamente il trasporto per verificare il recupero senza attendere il timeout del ping.
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(page.getByRole('status').filter({ hasText: 'Connessione in corso' })).toBeVisible();
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.getByRole('status').filter({ hasText: /^Connesso$/ })).toBeVisible();
      await expect(page.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
      await command(game.socket, 'admin:next_state');
      await command(game.socket, 'admin:next_state');
      await expect(page.getByText('Risposta corretta!', { exact: true })).toBeVisible();
      await command(game.socket, 'admin:next_state');
      await expect(page.getByText('100 punti', { exact: true })).toBeVisible();
      await noOverflow(page);
      await command(game.socket, 'admin:next_state');
      await expect(page.getByRole('heading', { name: 'Domanda mobile 2' })).toBeVisible();
      await (await touchTarget(page, 'B Errata')).tap();
      await expect(page.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
      for (let i = 0; i < 4; i++) await command(game.socket, 'admin:next_state');
      await expect(page.getByRole('heading', { name: 'Il podio finale' })).toBeVisible();
      await noOverflow(page);
      await command(game.socket, 'admin:next_state');
      await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
      await noOverflow(page);
      await expect(page.getByText('100 punti', { exact: true })).toBeVisible();
      const archives = await (await request.get('http://127.0.0.1:54325/test/archive')).json();
      const archive = archives.find((g: { id: string }) => g.id === game.gameId);
      expect(archive.players).toHaveLength(1); expect(archive.submissions).toHaveLength(2);
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('final-mobile.png'), fullPage: true });
    } finally { game.socket.disconnect(); await context.close(); await screen.close(); }
  });
}

test('Touch: nickname duplicato correggibile; Invio e doppio tocco creano un solo giocatore', async ({ browser, request }) => {
  const game = await lobby(request);
  const contexts = await Promise.all([browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['Pixel 7'] }), browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['Pixel 7'] })]);
  try {
    const first = await contexts[0].newPage(), second = await contexts[1].newPage();
    await first.goto(`/play/${game.gameCode}`); await first.getByLabel('Come ti chiami?').fill('Anna');
    const button = await touchTarget(first, 'Partecipa');
    const box = (await button.boundingBox())!;
    await first.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await first.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(first.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await second.goto(`/play/${game.gameCode}`); await second.getByLabel('Come ti chiami?').fill('ANNA');
    await (await touchTarget(second, 'Partecipa')).tap();
    await expect(second.getByRole('alert').filter({ hasText: 'Nickname già utilizzato' })).toBeVisible();
    await second.getByLabel('Come ti chiami?').fill('Bruno');
    await second.getByLabel('Come ti chiami?').press('Enter');
    await expect(second.getByText('Sei dentro!', { exact: false })).toBeVisible();
    const state = (await game.socket.timeout(5000).emitWithAck('game:sync', {})).data.state;
    expect(state.playersCount).toBe(2);
  } finally { game.socket.disconnect(); await Promise.all(contexts.map(c => c.close())); }
});

test('Conduttore mobile: controlli touch, QR, ripresa dopo ricarica e rimozione partecipanti', async ({ browser, request }) => {
  const game = await lobby(request);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['Pixel 7'] });
  const playerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['iPhone SE'] });
  try {
    const admin = await signedIn(context);
    await admin.goto(`/game/${game.gameId}/admin`);
    await expect(admin.getByRole('heading', { name: 'Aspettiamo i giocatori' })).toBeVisible();
    await noOverflow(admin);
    const url = await decodeQR(admin);
    const player = await playerContext.newPage(); await player.goto(url);
    await player.getByLabel('Come ti chiami?').fill('Ospite'); await (await touchTarget(player, 'Partecipa')).tap();
    await expect(player.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await admin.reload();
    await expect(admin.getByRole('heading', { name: '1 partecipanti' })).toBeVisible();
    await admin.getByText('Gestisci partecipanti (1)', { exact: true }).tap();
    admin.once('dialog', dialog => dialog.accept());
    await admin.getByRole('button', { name: 'Rimuovi', exact: true }).tap();
    await expect(player.getByRole('alert').filter({ hasText: 'rimosso' })).toBeVisible();
    await (await touchTarget(admin, 'Inizia il quiz')).tap();
    await expect(admin.getByRole('button', { name: 'Chiudi le risposte' })).toBeVisible();
    admin.once('dialog', dialog => dialog.accept());
    await admin.getByRole('button', { name: 'Termina partita' }).tap();
    await expect(admin.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  } finally { game.socket.disconnect(); await context.close(); await playerContext.close(); }
});

test('Il nickname mobile funziona anche quando lo storage del browser è bloccato', async ({ browser, request }) => {
  const game = await lobby(request);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['iPhone 13'] });
  await context.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  try {
    const page = await context.newPage(); await page.goto(`/play/${game.gameCode}`);
    await page.getByLabel('Come ti chiami?').fill('Privato'); await (await touchTarget(page, 'Partecipa')).tap();
    await expect(page.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'non permette di conservare' })).toBeVisible();
  } finally { game.socket.disconnect(); await context.close(); }
});

test('Mobile: invio nickname abilitato dopo la connessione, senza ricaricare', async ({ browser, request }) => {
  const game = await lobby(request);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['Pixel 7'] });
  await context.route('**/socket.io/**', route => route.abort());
  try {
    const page = await context.newPage(); await page.goto(`/play/${game.gameCode}`);
    await page.getByLabel('Come ti chiami?').fill('InAttesa');
    await expect(page.getByRole('button', { name: 'Connessione…', exact: true })).toBeDisabled();
    await expect(page.getByText('Attendi la connessione alla partita.', { exact: false })).toBeVisible();
    await context.unroute('**/socket.io/**');
    await expect(page.getByRole('button', { name: 'Partecipa', exact: true })).toBeEnabled({ timeout: 15000 });
    await (await touchTarget(page, 'Partecipa')).tap();
    await expect(page.getByText('Sei dentro!', { exact: false })).toBeVisible();
  } finally { game.socket.disconnect(); await context.close(); }
});

test('Schermo piccolo e orizzontale: invio codice e nickname accessibili con altezza ridotta', async ({ browser, request }, testInfo) => {
  const game = await lobby(request);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', ...devices['iPhone SE'], viewport: { width: 320, height: 568 } });
  try {
    const page = await context.newPage(); await page.goto('/');
    await page.getByLabel('Codice partita').fill(game.gameCode);
    await noOverflow(page);
    await page.getByRole('button', { name: 'Entra in partita' }).tap();
    await page.setViewportSize({ width: 320, height: 300 });
    await page.getByLabel('Come ti chiami?').fill('PiccoloSchermo');
    await noOverflow(page);
    await (await touchTarget(page, 'Partecipa')).tap();
    await expect(page.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 568, height: 320 });
    await command(game.socket, 'admin:start_game');
    await expect(page.getByRole('heading', { name: 'Scegli la tua risposta' })).toBeVisible();
    await noOverflow(page);
    await (await touchTarget(page, 'A Corretta')).tap();
    await expect(page.getByText('Risposta inviata. Attendi la soluzione.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('landscape.png'), fullPage: true });
  } finally { game.socket.disconnect(); await context.close(); }
});
