import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

test('Partita aperta: blocco esplicito e nuove domande conservate dopo la chiusura', async ({ page, request }) => {
  const auth = await (await request.post('http://127.0.0.1:54325/auth/v1/token', { data: {} })).json();
  const quiz = await (await request.post('http://127.0.0.1:54325/rest/v1/quizzes', { data: { title: 'Editor con partita aperta', owner_id: auth.user.id } })).json();
  await request.post('http://127.0.0.1:54325/rest/v1/rpc/save_quiz', { data: {
    p_quiz_id: quiz.id, p_expected_updated_at: quiz.updated_at, p_title: quiz.title, p_description: '',
    p_questions: [{ id: randomUUID(), question_text: 'Prima domanda', preview_seconds: 0, answer_seconds: 30, correct_points: 100, wrong_points: 0,
      answers: [{ id: randomUUID(), answer_text: 'Sì', is_correct: true }, { id: randomUUID(), answer_text: 'No', is_correct: false }] }],
  } });
  const socket = io('http://127.0.0.1:3101', { auth: { accessToken: auth.access_token }, reconnection: false });
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  try {
    const created = await socket.timeout(5000).emitWithAck('admin:create_game', { quizId: quiz.id });
    expect(created.ok).toBe(true);
    const { gameId, gameCode } = created.data.state;
    await page.goto('/login');
    await page.getByLabel('Email').fill('host@example.test');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Accedi', exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    // Compila la route admin prima di creare la bozza: Next dev può ricaricare
    // le altre schede quando compila una route per la prima volta.
    await page.goto(`/game/${gameId}/admin`);
    await expect(page.getByRole('heading', { name: 'Aspettiamo i giocatori' })).toBeVisible();
    await page.goto(`/quizzes/${quiz.id}/edit`);
    await expect(page.getByRole('region', { name: 'Partite che bloccano il salvataggio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salva quiz' })).toBeDisabled();
    await page.getByRole('button', { name: '+ Aggiungi domanda', exact: true }).click();
    await page.getByLabel('Testo della domanda').fill('Seconda domanda da conservare');
    for (const letter of ['A', 'B', 'C', 'D']) await page.getByLabel(`Risposta ${letter}`, { exact: true }).fill(`Risposta ${letter}`);
    await page.getByLabel('Corretta', { exact: true }).first().check();
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: new RegExp(`Apri partita ${gameCode}`) }).click();
    const host = await popup;
    await expect(host).toHaveURL(new RegExp(`/game/${gameId}/admin$`));
    host.once('dialog', dialog => dialog.accept());
    await host.getByRole('button', { name: 'Termina partita', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
    await host.close();
    await page.getByRole('button', { name: 'Ho concluso le partite: verifica' }).click();
    await expect(page.getByRole('region', { name: 'Partite che bloccano il salvataggio' })).toHaveCount(0);
    await expect(page.getByLabel('Testo della domanda')).toHaveValue('Seconda domanda da conservare');
    await page.getByRole('button', { name: 'Salva quiz' }).click();
    await expect(page.getByText('Nessuna modifica da salvare', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Domande (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Domanda 2 Seconda domanda da conservare' }).click();
    await expect(page.getByLabel('Testo della domanda')).toHaveValue('Seconda domanda da conservare');
  } finally { socket.disconnect(); }
});
