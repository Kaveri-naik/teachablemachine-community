import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cosineSimilarity,
  decideDetection,
  DEFAULT_THRESHOLDS,
  LABELS,
  meanVector,
} from '../js/decision.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  });

  it('returns 0 for orthogonal vectors', () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it('returns a high score for near-matching fingerprints', () => {
    const a = [0.9, 0.1, 0.05];
    const b = [0.88, 0.12, 0.04];
    assert.ok(cosineSimilarity(a, b) > 0.99);
  });

  it('rejects mismatched lengths', () => {
    assert.throws(() => cosineSimilarity([1, 2], [1]));
  });
});

describe('meanVector', () => {
  it('averages each component', () => {
    const mean = meanVector([
      [1, 2, 3],
      [3, 2, 1],
    ]);
    assert.equal(mean[0], 2);
    assert.equal(mean[1], 2);
    assert.equal(mean[2], 2);
  });

  it('rejects an empty list', () => {
    assert.throws(() => meanVector([]));
  });
});

describe('decideDetection', () => {
  const thresholds = DEFAULT_THRESHOLDS;

  it('reports Module 1 when the query matches prototype 1', () => {
    const result = decideDetection({
      similarity1: 0.91,
      similarity2: 0.42,
      probability1: 0.88,
      probability2: 0.12,
    }, thresholds);
    assert.equal(result.label, LABELS.MODULE_1);
    assert.equal(result.module, 1);
    assert.equal(result.reason, 'match');
  });

  it('reports Module 2 when the query matches prototype 2', () => {
    const result = decideDetection({
      similarity1: 0.33,
      similarity2: 0.86,
      probability1: 0.2,
      probability2: 0.8,
    }, thresholds);
    assert.equal(result.label, LABELS.MODULE_2);
    assert.equal(result.module, 2);
  });

  it('returns not a valid detection when both similarities are low', () => {
    const result = decideDetection({
      similarity1: 0.21,
      similarity2: 0.19,
      probability1: 0.7,
      probability2: 0.3,
    }, thresholds);
    assert.equal(result.label, LABELS.INVALID);
    assert.equal(result.reason, 'low_similarity');
  });

  it('returns not a valid detection when the two modules are too close', () => {
    const result = decideDetection({
      similarity1: 0.71,
      similarity2: 0.70,
      probability1: 0.51,
      probability2: 0.49,
    }, thresholds);
    assert.equal(result.label, LABELS.INVALID);
    assert.equal(result.reason, 'ambiguous');
  });

  it('returns not a valid detection on strong classifier disagreement', () => {
    const result = decideDetection({
      similarity1: 0.64,
      similarity2: 0.60,
      probability1: 0.05,
      probability2: 0.95,
    }, thresholds);
    assert.equal(result.label, LABELS.INVALID);
    assert.equal(result.reason, 'disagreement');
  });

  it('returns not a valid detection when confidence is weak and the margin is small', () => {
    const result = decideDetection({
      similarity1: 0.66,
      similarity2: 0.60,
      probability1: 0.52,
      probability2: 0.48,
    }, thresholds);
    assert.equal(result.label, LABELS.INVALID);
    assert.equal(result.reason, 'low_confidence');
  });

  it('uses the exact user-facing phrases', () => {
    assert.equal(LABELS.MODULE_1, 'Module 1 image detected');
    assert.equal(LABELS.MODULE_2, 'Module 2 image detected');
    assert.equal(LABELS.INVALID, 'not a valid detection');
  });
});
