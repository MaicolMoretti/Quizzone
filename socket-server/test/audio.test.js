const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, snapshot, validateQuiz } = require('../lib/engine');
const { fixture, quiz } = require('./helpers');

test('Domande audio: URL validi, URL pericolosi rifiutati, compatibilità senza audio', () => {
  const data = quiz();
  assert.doesNotThrow(() => validateQuiz(data));
  for (const url of ['https://example.test/traccia.mp3', 'http://example.test/audio.wav', null, '']) {
    data.questions[0].audio_url = url;
    assert.doesNotThrow(() => validateQuiz(data));
  }
  for (const url of ['javascript:alert(1)', 'data:audio/wav;base64,abc', 'file:///tmp/song.mp3', 'https://', 'x'.repeat(2049), 123]) {
    data.questions[0].audio_url = url;
    assert.throws(() => validateQuiz(data), e => e.code === 'INVALID_QUIZ');
  }
});

test('Traccia corrente negli snapshot e nel ripristino, nessuna anticipazione della prossima', async () => {
  const f = await fixture();
  const data = f.engine.get(f.code);
  data.questions[0].audio_url = 'https://example.test/prima.mp3';
  data.questions[1].audio_url = 'https://example.test/seconda.mp3';
  assert.equal(snapshot(data).question, undefined);
  await f.command('start');
  const state = snapshot(f.engine.get(f.code));
  assert.equal(state.question.audio_url, data.questions[0].audio_url);
  assert.ok(!JSON.stringify(state).includes('seconda.mp3'));
  assert.equal(state.question.answers, undefined);
  const restored = new GameEngine({ store: f.store, repository: f.repo, now: f.now });
  await restored.restore();
  assert.equal(snapshot(restored.get(f.code)).question.audio_url, data.questions[0].audio_url);
  await f.command(); await f.command(); await f.command('next_question');
  assert.equal(snapshot(f.engine.get(f.code)).question.audio_url, data.questions[1].audio_url);
});
