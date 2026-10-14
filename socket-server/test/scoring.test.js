const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timeScore } = require('../lib/scoring');

test('Formula lineare: esempi su 30 secondi, estremi e limiti', () => {
  for (const [seconds, points] of [[0, 100], [5, 83], [10, 67], [15, 50], [20, 33], [25, 17], [29, 3], [30, 1]]) {
    assert.equal(timeScore(seconds * 1000, 30000), points);
  }
  assert.equal(timeScore(-500, 30000), 100);
  assert.equal(timeScore(50000, 30000), 1);
});

test('Durate diverse: punteggio limitato, intero e monotono', () => {
  for (const duration of [1000, 5000, 30000, 600000]) {
    let previous = 100;
    for (let i = 0; i <= 1000; i++) {
      const score = timeScore(duration * i / 1000, duration);
      assert.ok(Number.isInteger(score) && score >= 1 && score <= 100 && score <= previous);
      previous = score;
    }
    assert.equal(timeScore(duration / 2, duration), 50);
  }
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => timeScore(0, duration), RangeError);
});
