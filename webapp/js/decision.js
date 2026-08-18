/**
 * Pure detection logic for the two-module image classifier.
 * Kept free of TensorFlow and DOM so it can be unit-tested in Node.
 */

export const LABELS = {
  MODULE_1: 'Module 1 image detected',
  MODULE_2: 'Module 2 image detected',
  INVALID: 'not a valid detection',
};

export const DEFAULT_THRESHOLDS = {
  /** Minimum cosine similarity to the closer learned prototype. */
  minSimilarity: 0.58,
  /** Minimum gap between the two prototype similarities. */
  minMargin: 0.03,
  /**
   * Softmax confidence below which we only accept a call if the
   * embedding match is clearly stronger for one module.
   */
  minConfidence: 0.6,
};

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns a value in roughly [-1, 1].
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error('cosineSimilarity requires two equal-length vectors');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    return 0;
  }
  return dot / denom;
}

/**
 * Component-wise mean of a list of vectors.
 */
export function meanVector(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('meanVector requires at least one vector');
  }

  const dim = vectors[0].length;
  const acc = new Float32Array(dim);

  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error('meanVector requires vectors of equal length');
    }
    for (let i = 0; i < dim; i += 1) {
      acc[i] += vector[i];
    }
  }

  for (let i = 0; i < dim; i += 1) {
    acc[i] /= vectors.length;
  }

  return acc;
}

function packResult(label, module, reason) {
  return { label, module, reason };
}

/**
 * Decide which message to show for a query image.
 *
 * Few-shot transfer learning is noisy with only two examples, so prototype
 * cosine similarity is the primary vote. The trained softmax is a supporting
 * signal used to reject weak or contradictory calls.
 */
export function decideDetection(scores, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const { similarity1, similarity2, probability1, probability2 } = scores;

  const bestSim = Math.max(similarity1, similarity2);
  const simMargin = Math.abs(similarity1 - similarity2);
  const moduleBySim = similarity1 >= similarity2 ? 1 : 2;

  const bestProb = Math.max(probability1, probability2);
  const moduleByProb = probability1 >= probability2 ? 1 : 2;

  if (!Number.isFinite(bestSim) || bestSim < t.minSimilarity) {
    return packResult(LABELS.INVALID, null, 'low_similarity');
  }

  if (simMargin < t.minMargin) {
    return packResult(LABELS.INVALID, null, 'ambiguous');
  }

  const classifierStronglyDisagrees =
    moduleBySim !== moduleByProb &&
    bestProb >= 0.85 &&
    simMargin < 0.1;

  if (classifierStronglyDisagrees) {
    return packResult(LABELS.INVALID, null, 'disagreement');
  }

  if (bestProb < t.minConfidence && simMargin < 0.08) {
    return packResult(LABELS.INVALID, null, 'low_confidence');
  }

  const label = moduleBySim === 1 ? LABELS.MODULE_1 : LABELS.MODULE_2;
  return packResult(label, moduleBySim, 'match');
}
