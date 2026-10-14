import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

test('Host mobile: salta la prima classifica, mostra la seconda, conserva punti e sincronizza le viste', async ({ browser, request }) => {
  const auth = await (await request.post('http://127.0.0.1:54325/auth/v1/token', { data: {} })).json();
  const quiz = await (await request.post('http://127.0.0.1:54325/rest/v1/quizzes', { data: { title: 'Scelta host', owner_id: auth.user.id } })).json();
  await request.post('http://127.0.0.1:54325/rest/v1/rpc/save_quiz', { data: {
    p_quiz_id: quiz.id, p_expected_updated_at: quiz.updated_at, p_title: 'Scelta host', p_description: '',
    p_questions: [1, 2].map(i => ({ id: randomUUID(), question_text: `Scelta domanda ${i}`, preview_seconds: 0, answer_seconds: 30, correct_points: 100, wrong_points: 0,
      answers: [{ id: randomUUID(), answer_text: 'Giusta', is_correct: true }, { id: randomUUID(), answer_text: 'Errata', is_correct: false }] })),
  } });
  const socket = io('http://127.0.0.1:3101', { auth: { accessToken: auth.access_token }, reconnection: false });
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const created = await socket.timeout(5000).emitWithAck('admin:create_game', { quizId: quiz.id });
  expect(created.ok).toBe(true);
  const { gameId, gameCode } = created.data.state;
  socket.disconnect();
  const hostContext = await browser.newContext({ ...devices['Pixel 7'] });
  const playerContext = await browser.newContext({ ...devices['iPhone SE'] });
  const host = await hostContext.newPage(), player = await playerContext.newPage();
  const screen = await browser.newPage();
  try {
    await host.goto('http://127.0.0.1:3100/login');
    await host.getByLabel('Email').fill('host@example.test');
    await host.getByLabel('Password', { exact: true }).fill('test-password');
    await host.getByRole('button', { name: 'Accedi', exact: true }).tap();
    await expect(host).toHaveURL(/dashboard/);
    await host.goto(`http://127.0.0.1:3100/game/${gameId}/admin`);
    await screen.goto(`http://127.0.0.1:3100/game/${gameId}/presentation`);
    await player.goto(`http://127.0.0.1:3100/play/${gameCode}`);
    await player.getByLabel('Come ti chiami?').fill('Anna scelta');
    await player.getByRole('button', { name: 'Partecipa', exact: true }).tap();
    await expect(player.getByText('Sei dentro!', { exact: false })).toBeVisible();
    await host.getByRole('button', { name: 'Inizia il quiz' }).tap();
    for (let i = 1; i <= 2; i++) {
      await expect(player.getByRole('heading', { name: `Scelta domanda ${i}` })).toBeVisible();
      await player.getByRole('button', { name: 'A Giusta', exact: true }).tap();
      for (const page of [host, player, screen]) {
        await expect(page.getByRole('heading', { name: 'Risposte concluse' })).toBeVisible();
        await expect(page.getByText(/^\d+ punti$/)).toHaveCount(0);
      }
      await expect(player.getByRole('button', { name: 'Mostra classifica', exact: true })).toHaveCount(0);
      await expect(screen.getByRole('button', { name: 'Mostra classifica', exact: true })).toHaveCount(0);
      if (i === 1) {
        // Due click nello stesso task del browser: il busyRef deve bloccare il secondo.
        await host.getByRole('button', { name: 'Prossima domanda', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        for (const page of [host, player, screen]) {
          await expect(page.getByRole('heading', { name: 'Scelta domanda 2' })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Classifica', exact: true })).toHaveCount(0);
        }
      } else {
        await host.reload();
        await expect(host.getByRole('button', { name: 'Mostra classifica', exact: true })).toBeEnabled();
        await host.getByRole('button', { name: 'Mostra classifica', exact: true }).tap();
        await expect(screen.getByText(/^\d+ punti$/)).toBeVisible();
        const scoreText = await screen.getByText(/^\d+ punti$/).innerText();
        const score = Number(scoreText.split(' ')[0]);
        expect(score).toBeGreaterThanOrEqual(2); expect(score).toBeLessThanOrEqual(200);
        for (const page of [host, player]) await expect(page.getByText(scoreText, { exact: true })).toBeVisible();
        await host.getByRole('button', { name: 'Mostra risultati finali' }).tap();
        for (const page of [host, player, screen]) {
          await expect(page.getByRole('heading', { name: 'Il podio finale' })).toBeVisible();
          await expect(page.getByText(scoreText, { exact: true })).toBeVisible();
        }
        await host.getByRole('button', { name: 'Concludi e archivia' }).tap();
        await expect(player.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
        const archives = await (await request.get('http://127.0.0.1:54325/test/archive')).json();
        const archive = archives.find((g: { id: string }) => g.id === gameId);
        expect(archive.players[0].score).toBe(score);
        expect(archive.submissions).toHaveLength(2);
        expect(archive.submissions.reduce((sum: number, a: { points_awarded: number }) => sum + a.points_awarded, 0)).toBe(score);
      }
    }
  } finally { socket.disconnect(); await hostContext.close(); await playerContext.close(); await screen.close(); }
});
