import {
  detectImage,
  hasLearnedBothModules,
  isClassifierReady,
  isFeatureModelReady,
  learnModule,
  loadFeatureModel,
  resetLearning,
  trainClassifier,
} from './ml.js';
import { DEFAULT_THRESHOLDS, LABELS } from './decision.js';

const statusPill = document.getElementById('status-pill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayCopy = document.getElementById('overlay-copy');
const overlayBar = document.getElementById('overlay-bar');
const resultCard = document.getElementById('result');
const resultLabel = document.getElementById('result-label');
const queryDrop = document.getElementById('query-drop');
const queryPlaceholder = document.getElementById('query-placeholder');
const cameraBtn = document.getElementById('camera-btn');
const captureBtn = document.getElementById('capture-btn');
const resetBtn = document.getElementById('reset-btn');
const retrainBtn = document.getElementById('retrain-btn');
const minSimInput = document.getElementById('min-sim');
const minMarginInput = document.getElementById('min-margin');

const learned = {
  1: false,
  2: false,
};

const images = {
  1: null,
  2: null,
};

let cameraStream = null;
let lastQueryImage = null;

function setStatus(text, kind = '') {
  statusPill.textContent = text;
  statusPill.classList.remove('ready', 'busy');
  if (kind) {
    statusPill.classList.add(kind);
  }
}

function showOverlay(title, copy, progress = 0.12) {
  overlayTitle.textContent = title;
  overlayCopy.textContent = copy;
  overlayBar.style.width = `${Math.round(progress * 100)}%`;
  overlay.classList.add('visible');
}

function hideOverlay() {
  overlay.classList.remove('visible');
}

function currentThresholds() {
  return {
    ...DEFAULT_THRESHOLDS,
    minSimilarity: Number(minSimInput.value),
    minMargin: Number(minMarginInput.value),
  };
}

function previewInZone(zone, source) {
  zone.querySelectorAll('img, video, canvas').forEach((node) => node.remove());
  const placeholder = zone.querySelector('.placeholder');
  if (placeholder) {
    placeholder.hidden = true;
  }
  zone.appendChild(source);
}

function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.alt = file.name;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

async function maybeTrain() {
  if (!hasLearnedBothModules()) {
    retrainBtn.disabled = true;
    return;
  }

  showOverlay('Training', 'Fitting a small classifier on the learned fingerprints…', 0.2);
  setStatus('Training classifier…', 'busy');
  try {
    await trainClassifier((epoch, total) => {
      overlayBar.style.width = `${Math.round((epoch / total) * 100)}%`;
      overlayCopy.textContent = `Epoch ${epoch} of ${total}`;
    });
    setStatus('Model ready', 'ready');
    resultLabel.textContent = 'Model ready — drop a photo to classify';
    retrainBtn.disabled = false;
    updateDetectEnabled();
  } catch (error) {
    setStatus('Training failed');
    resultLabel.textContent = error.message;
  } finally {
    hideOverlay();
  }
}

let bootPromise = null;

async function learnFromCard(moduleId) {
  if (bootPromise) {
    await bootPromise;
  }
  const image = images[moduleId];
  if (!image || !isFeatureModelReady()) {
    return;
  }

  showOverlay(
    `Learning Module ${moduleId}`,
    'Extracting MobileNet embeddings and augmenting the photo…',
    0.08,
  );
  setStatus(`Learning Module ${moduleId}…`, 'busy');
  try {
    await learnModule(moduleId, image, (progress) => {
      overlayBar.style.width = `${Math.round(progress * 100)}%`;
    });
    learned[moduleId] = true;
    document.getElementById(`meta-${moduleId}`).textContent = 'Learned';
    hideOverlay();
    await maybeTrain();
  } catch (error) {
    hideOverlay();
    setStatus('Learning failed');
    resultLabel.textContent = error.message;
  }
}

function updateDetectEnabled() {
  const ready = isClassifierReady();
  document.getElementById('file-query').disabled = !ready;
  cameraBtn.disabled = !ready;
}

async function runDetection(image) {
  lastQueryImage = image;
  const result = await detectImage(image, currentThresholds());
  const similarityTotal = Math.max(
    result.scores.similarity1 + result.scores.similarity2,
    0.0001,
  );
  const pct1 = Math.max(0, result.scores.similarity1) / similarityTotal;
  const pct2 = Math.max(0, result.scores.similarity2) / similarityTotal;

  document.getElementById('bar-1').style.width = `${Math.round(pct1 * 100)}%`;
  document.getElementById('bar-2').style.width = `${Math.round(pct2 * 100)}%`;
  document.getElementById('pct-1').textContent = `${Math.round(result.scores.similarity1 * 100)}%`;
  document.getElementById('pct-2').textContent = `${Math.round(result.scores.similarity2 * 100)}%`;

  resultLabel.textContent = result.label;
  resultCard.classList.remove('match-1', 'match-2', 'invalid');
  if (result.label === LABELS.MODULE_1) {
    resultCard.classList.add('match-1');
  } else if (result.label === LABELS.MODULE_2) {
    resultCard.classList.add('match-2');
  } else {
    resultCard.classList.add('invalid');
  }
}

async function handleQueryFile(file) {
  if (!isClassifierReady()) {
    resultLabel.textContent = 'Learn both modules before detecting';
    return;
  }
  try {
    stopCamera();
    const img = await loadFileAsImage(file);
    img.style.width = '100%';
    img.style.height = '220px';
    img.style.objectFit = 'cover';
    previewInZone(queryDrop, img);
    queryPlaceholder.hidden = true;
    await runDetection(img);
  } catch (error) {
    resultLabel.textContent = error.message;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  captureBtn.hidden = true;
  cameraBtn.hidden = false;
}

async function startCamera() {
  if (!isClassifierReady()) {
    return;
  }
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = cameraStream;
    previewInZone(queryDrop, video);
    queryPlaceholder.hidden = true;
    captureBtn.hidden = false;
    cameraBtn.hidden = true;
  } catch (error) {
    resultLabel.textContent = error.message || 'Camera is not available';
  }
}

function captureFromCamera() {
  const video = queryDrop.querySelector('video');
  if (!video) {
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const img = new Image();
  img.onload = async () => {
    stopCamera();
    img.style.width = '100%';
    img.style.height = '220px';
    img.style.objectFit = 'cover';
    previewInZone(queryDrop, img);
    await runDetection(img);
  };
  img.src = canvas.toDataURL('image/jpeg');
}

function bindDropzone(zone, onFile) {
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragover');
    const file = event.dataTransfer.files[0];
    if (file) {
      await onFile(file);
    }
  });
}

function resetUi() {
  stopCamera();
  resetLearning();
  learned[1] = false;
  learned[2] = false;
  images[1] = null;
  images[2] = null;
  lastQueryImage = null;
  document.getElementById('learn-1').disabled = true;
  document.getElementById('learn-2').disabled = true;
  document.getElementById('meta-1').textContent = 'No image yet';
  document.getElementById('meta-2').textContent = 'No image yet';
  retrainBtn.disabled = true;
  document.querySelectorAll('.dropzone').forEach((zone) => {
    zone.querySelectorAll('img, video, canvas').forEach((node) => node.remove());
    const placeholder = zone.querySelector('.placeholder');
    if (placeholder) {
      placeholder.hidden = false;
    }
  });
  resultCard.classList.remove('match-1', 'match-2', 'invalid');
  resultLabel.textContent = 'Train both modules to begin';
  document.getElementById('bar-1').style.width = '0%';
  document.getElementById('bar-2').style.width = '0%';
  document.getElementById('pct-1').textContent = '0%';
  document.getElementById('pct-2').textContent = '0%';
  updateDetectEnabled();
  setStatus('Model ready to learn', 'ready');
}

async function onModuleFile(moduleId, file) {
  const img = await loadFileAsImage(file);
  img.style.width = '100%';
  img.style.height = '220px';
  img.style.objectFit = 'cover';
  const zone = document.querySelector(`[data-drop="${moduleId}"]`);
  previewInZone(zone, img);
  images[moduleId] = img;
  document.getElementById(`learn-${moduleId}`).disabled = false;
  document.getElementById(`meta-${moduleId}`).textContent = 'Ready to learn';
  await learnFromCard(moduleId);
  updateDetectEnabled();
}

document.getElementById('file-1').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    onModuleFile(1, file);
  }
});
document.getElementById('file-2').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    onModuleFile(2, file);
  }
});
document.getElementById('file-query').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    handleQueryFile(file);
  }
});

document.getElementById('learn-1').addEventListener('click', () => learnFromCard(1));
document.getElementById('learn-2').addEventListener('click', () => learnFromCard(2));
cameraBtn.addEventListener('click', startCamera);
captureBtn.addEventListener('click', captureFromCamera);
resetBtn.addEventListener('click', resetUi);
retrainBtn.addEventListener('click', maybeTrain);

bindDropzone(document.querySelector('[data-drop="1"]'), (file) => onModuleFile(1, file));
bindDropzone(document.querySelector('[data-drop="2"]'), (file) => onModuleFile(2, file));
bindDropzone(queryDrop, handleQueryFile);

minSimInput.addEventListener('input', () => {
  document.getElementById('min-sim-val').textContent = Number(minSimInput.value).toFixed(2);
  if (lastQueryImage && isClassifierReady()) {
    runDetection(lastQueryImage);
  }
});
minMarginInput.addEventListener('input', () => {
  document.getElementById('min-margin-val').textContent = Number(minMarginInput.value).toFixed(2);
  if (lastQueryImage && isClassifierReady()) {
    runDetection(lastQueryImage);
  }
});

async function boot() {
  try {
    setStatus('Loading MobileNet…', 'busy');
    showOverlay('Loading vision model', 'Downloading MobileNet in this browser…', 0.2);
    await loadFeatureModel();
    hideOverlay();
    setStatus('Ready to learn two images', 'ready');
    updateDetectEnabled();
  } catch (error) {
    hideOverlay();
    setStatus('Could not load MobileNet');
    resultLabel.textContent = error.message;
  }
}

window.addEventListener('error', (event) => {
  setStatus('Something went wrong');
  resultLabel.textContent = event.message || 'Unexpected error';
});

bootPromise = boot();
