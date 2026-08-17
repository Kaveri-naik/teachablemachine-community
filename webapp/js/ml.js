import {
  cosineSimilarity,
  decideDetection,
  meanVector,
  DEFAULT_THRESHOLDS,
} from './decision.js';

const IMAGE_SIZE = 224;
const AUGMENTATIONS_PER_IMAGE = 24;

let featureModel = null;
let denseModel = null;

const embeddings = {
  1: [],
  2: [],
};

const prototypes = {
  1: null,
  2: null,
};

function requireTf() {
  if (typeof tf === 'undefined') {
    throw new Error('TensorFlow.js is not loaded');
  }
}

function requireFeatureModel() {
  if (!featureModel) {
    throw new Error('Feature model is not ready yet');
  }
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a source image onto a 224×224 canvas with light random transforms
 * so two photos can still train a small classifier.
 */
export function createAugmentedCanvas(source, rng = Math.random) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const flip = rng() > 0.5;
  const angle = (rng() - 0.5) * 0.3;
  const scale = 0.92 + rng() * 0.16;
  const tx = (rng() - 0.5) * 20;
  const ty = (rng() - 0.5) * 20;
  const brightness = 0.88 + rng() * 0.24;
  const contrast = 0.9 + rng() * 0.2;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  ctx.save();
  ctx.translate(IMAGE_SIZE / 2 + tx, IMAGE_SIZE / 2 + ty);
  ctx.rotate(angle);
  ctx.scale(flip ? -scale : scale, scale);
  ctx.filter = `brightness(${brightness}) contrast(${contrast})`;
  ctx.drawImage(source, -IMAGE_SIZE / 2, -IMAGE_SIZE / 2, IMAGE_SIZE, IMAGE_SIZE);
  ctx.restore();
  ctx.filter = 'none';
  return canvas;
}

function drawCentered(source) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);

  const scale = Math.max(
    IMAGE_SIZE / source.width,
    IMAGE_SIZE / source.height,
  );
  const width = source.width * scale;
  const height = source.height * scale;
  ctx.drawImage(
    source,
    (IMAGE_SIZE - width) / 2,
    (IMAGE_SIZE - height) / 2,
    width,
    height,
  );
  return canvas;
}

async function embedCanvas(canvas) {
  requireTf();
  requireFeatureModel();

  const tensor = featureModel.infer(canvas, true);
  const squeezed = tensor.squeeze();
  const values = await squeezed.data();
  tensor.dispose();
  squeezed.dispose();
  return Float32Array.from(values);
}

export async function loadFeatureModel(onProgress) {
  if (featureModel) {
    return featureModel;
  }

  if (typeof mobilenet === 'undefined') {
    throw new Error('MobileNet is not loaded');
  }

  featureModel = await mobilenet.load({
    version: 2,
    alpha: 0.5,
  });

  if (typeof onProgress === 'function') {
    onProgress(1);
  }

  return featureModel;
}

export function isFeatureModelReady() {
  return Boolean(featureModel);
}

export function hasLearnedBothModules() {
  return embeddings[1].length > 0 && embeddings[2].length > 0;
}

export function getPrototype(moduleId) {
  return prototypes[moduleId];
}

/**
 * Learn one module from a single image by embedding the original plus
 * several augmented copies.
 */
export async function learnModule(moduleId, image, onProgress) {
  requireFeatureModel();

  const collected = [];
  const base = drawCentered(image);
  collected.push(await embedCanvas(base));

  const rng = mulberry32(moduleId * 997 + collected[0].length);
  for (let i = 0; i < AUGMENTATIONS_PER_IMAGE; i += 1) {
    const canvas = createAugmentedCanvas(base, rng);
    collected.push(await embedCanvas(canvas));
    if (typeof onProgress === 'function') {
      onProgress((i + 2) / (AUGMENTATIONS_PER_IMAGE + 1));
    }
  }

  embeddings[moduleId] = collected;
  prototypes[moduleId] = meanVector(collected);
  return collected.length;
}

export async function trainClassifier(onEpoch) {
  requireTf();

  if (!hasLearnedBothModules()) {
    throw new Error('Learn Module 1 and Module 2 before training');
  }

  const xsData = [...embeddings[1], ...embeddings[2]];
  const ysData = [
    ...embeddings[1].map(() => [1, 0]),
    ...embeddings[2].map(() => [0, 1]),
  ];

  const xs = tf.tensor2d(xsData);
  const ys = tf.tensor2d(ysData);

  if (denseModel) {
    denseModel.dispose();
    denseModel = null;
  }

  denseModel = tf.sequential();
  denseModel.add(tf.layers.dense({
    inputShape: [xsData[0].length],
    units: 64,
    activation: 'relu',
  }));
  denseModel.add(tf.layers.dropout({ rate: 0.25 }));
  denseModel.add(tf.layers.dense({
    units: 2,
    activation: 'softmax',
  }));
  denseModel.compile({
    optimizer: tf.train.adam(0.008),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  await denseModel.fit(xs, ys, {
    epochs: 35,
    batchSize: 16,
    shuffle: true,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (typeof onEpoch === 'function') {
          onEpoch(epoch + 1, 35, logs);
        }
      },
    },
  });

  xs.dispose();
  ys.dispose();
  return denseModel;
}

export function isClassifierReady() {
  return Boolean(denseModel) && hasLearnedBothModules();
}

async function classifyEmbedding(embedding) {
  if (!denseModel) {
    return { probability1: 0.5, probability2: 0.5 };
  }

  const input = tf.tensor2d([Array.from(embedding)]);
  const output = denseModel.predict(input);
  const values = await output.data();
  input.dispose();
  output.dispose();
  return {
    probability1: values[0],
    probability2: values[1],
  };
}

/**
 * Classify a query image against the two learned modules.
 */
export async function detectImage(image, thresholds = DEFAULT_THRESHOLDS) {
  if (!isClassifierReady()) {
    throw new Error('The model has not finished learning yet');
  }

  const canvas = drawCentered(image);
  const embedding = await embedCanvas(canvas);
  const probabilities = await classifyEmbedding(embedding);

  const scores = {
    similarity1: cosineSimilarity(embedding, prototypes[1]),
    similarity2: cosineSimilarity(embedding, prototypes[2]),
    ...probabilities,
  };

  const decision = decideDetection(scores, thresholds);
  return {
    ...decision,
    scores,
  };
}

export function resetLearning() {
  embeddings[1] = [];
  embeddings[2] = [];
  prototypes[1] = null;
  prototypes[2] = null;
  if (denseModel) {
    denseModel.dispose();
    denseModel = null;
  }
}
