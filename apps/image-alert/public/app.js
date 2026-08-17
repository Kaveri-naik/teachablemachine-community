const COCO_CHIPS = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "bus",
  "truck",
  "dog",
  "cat",
  "bird",
  "backpack",
  "handbag",
  "cell phone",
  "laptop",
  "knife",
  "scissors",
];

const STORAGE_KEY = "lensalert-settings-v1";
const PREDICT_EVERY_MS = 350;

const els = {
  video: document.getElementById("video"),
  still: document.getElementById("still"),
  overlay: document.getElementById("overlay"),
  hint: document.getElementById("stage-hint"),
  status: document.getElementById("status-pill"),
  predictions: document.getElementById("predictions"),
  chips: document.getElementById("class-chips"),
  watched: document.getElementById("watched"),
  threshold: document.getElementById("threshold"),
  cooldown: document.getElementById("cooldown"),
  alertsEnabled: document.getElementById("alerts-enabled"),
  includeSnapshot: document.getElementById("include-snapshot"),
  emailTo: document.getElementById("email-to"),
  smtpNote: document.getElementById("smtp-note"),
  mailStatus: document.getElementById("mail-status"),
  modelHelp: document.getElementById("model-help"),
  modelStatus: document.getElementById("model-status"),
  tmField: document.getElementById("tm-field"),
  tmUrl: document.getElementById("tm-url"),
  alertLog: document.getElementById("alert-log"),
  btnCamera: document.getElementById("btn-camera"),
  btnStop: document.getElementById("btn-stop"),
  btnLoadModel: document.getElementById("btn-load-model"),
  btnTestEmail: document.getElementById("btn-test-email"),
  btnRefreshLog: document.getElementById("btn-refresh-log"),
  fileInput: document.getElementById("file-input"),
};

const state = {
  mode: "coco",
  coco: null,
  teachable: null,
  stream: null,
  looping: false,
  lastPredict: 0,
  lastAlertAt: 0,
  loadingScripts: false,
};

function selectedMode() {
  const checked = document.querySelector('input[name="model-mode"]:checked');
  return checked ? checked.value : "coco";
}

function setStatus(kind, text) {
  els.status.className = `pill ${kind}`;
  els.status.textContent = text;
}

function setHint(text) {
  els.hint.hidden = !text;
  els.hint.textContent = text || "";
}

function parseWatched() {
  return els.watched.value
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function saveSettings() {
  const payload = {
    mode: selectedMode(),
    tmUrl: els.tmUrl.value,
    watched: els.watched.value,
    threshold: els.threshold.value,
    cooldown: els.cooldown.value,
    alertsEnabled: els.alertsEnabled.checked,
    includeSnapshot: els.includeSnapshot.checked,
    emailTo: els.emailTo.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.mode) {
      const radio = document.querySelector(`input[name="model-mode"][value="${saved.mode}"]`);
      if (radio) radio.checked = true;
    }
    if (saved.tmUrl) els.tmUrl.value = saved.tmUrl;
    if (saved.watched) els.watched.value = saved.watched;
    if (saved.threshold) els.threshold.value = saved.threshold;
    if (saved.cooldown) els.cooldown.value = saved.cooldown;
    if (typeof saved.alertsEnabled === "boolean") els.alertsEnabled.checked = saved.alertsEnabled;
    if (typeof saved.includeSnapshot === "boolean") els.includeSnapshot.checked = saved.includeSnapshot;
    if (saved.emailTo) els.emailTo.value = saved.emailTo;
  } catch {
    // ignore malformed local settings
  }
  syncModeUi();
}

function syncModeUi() {
  const mode = selectedMode();
  const teachable = mode === "teachable";
  els.tmField.hidden = !teachable;
  els.modelHelp.textContent = teachable
    ? "Paste the share URL from Teachable Machine’s Export panel. It should end with /models/MODEL_ID/."
    : "Detects people, cars, animals, and 80 everyday objects in the browser. No training required.";
  renderChips(teachable && state.teachable ? state.teachable.labels : COCO_CHIPS);
}

function renderChips(classes) {
  els.chips.innerHTML = "";
  const watched = new Set(parseWatched().map((name) => name.toLowerCase()));
  for (const name of classes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.className = watched.has(name.toLowerCase()) ? "active" : "";
    button.addEventListener("click", () => {
      const current = parseWatched();
      const exists = current.some((item) => item.toLowerCase() === name.toLowerCase());
      const next = exists
        ? current.filter((item) => item.toLowerCase() !== name.toLowerCase())
        : [...current, name];
      els.watched.value = next.join(", ");
      saveSettings();
      renderChips(classes);
    });
    els.chips.appendChild(button);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((script) => script.src === src)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureTf() {
  if (window.tf) return;
  await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
}

async function loadCocoModel() {
  await ensureTf();
  if (!window.cocoSsd) {
    await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
  }
  els.modelStatus.textContent = "Loading COCO-SSD…";
  state.coco = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  state.mode = "coco";
  els.modelStatus.textContent = "COCO-SSD ready (80 object classes).";
}

function normalizeTeachableUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Enter a Teachable Machine model URL");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function loadTeachableModel() {
  await ensureTf();
  const base = normalizeTeachableUrl(els.tmUrl.value);
  els.modelStatus.textContent = "Loading Teachable Machine model…";
  const metadata = await fetch(`${base}metadata.json`).then((response) => {
    if (!response.ok) throw new Error("Could not load metadata.json for that model URL");
    return response.json();
  });
  const model = await window.tf.loadLayersModel(`${base}model.json`);
  state.teachable = {
    model,
    labels: metadata.labels || [],
    imageSize: metadata.imageSize || 224,
  };
  state.mode = "teachable";
  els.modelStatus.textContent = `Teachable Machine ready (${state.teachable.labels.join(", ") || "no labels"}).`;
  renderChips(state.teachable.labels);
}

async function loadSelectedModel() {
  try {
    els.btnLoadModel.disabled = true;
    if (selectedMode() === "teachable") {
      await loadTeachableModel();
    } else {
      await loadCocoModel();
    }
  } catch (error) {
    els.modelStatus.textContent = error.message;
    throw error;
  } finally {
    els.btnLoadModel.disabled = false;
  }
}

function fitCanvas(width, height) {
  const canvas = els.overlay;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawFrame(source) {
  const ctx = els.overlay.getContext("2d");
  fitCanvas(source.videoWidth || source.naturalWidth || source.width, source.videoHeight || source.naturalHeight || source.height);
  ctx.drawImage(source, 0, 0, els.overlay.width, els.overlay.height);
}

function drawBoxes(detections) {
  const ctx = els.overlay.getContext("2d");
  ctx.font = "14px Arial";
  for (const detection of detections) {
    if (!detection.bbox) continue;
    const [x, y, width, height] = detection.bbox;
    ctx.strokeStyle = "#f3ead8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    const label = `${detection.className} ${Math.round(detection.probability * 100)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#1c1914";
    ctx.fillRect(x, Math.max(0, y - 20), textWidth + 10, 20);
    ctx.fillStyle = "#f3ead8";
    ctx.fillText(label, x + 5, Math.max(14, y - 6));
  }
}

function renderPredictions(detections) {
  const watched = new Set(parseWatched().map((name) => name.toLowerCase()));
  const threshold = Number(els.threshold.value);
  els.predictions.innerHTML = "";
  const top = detections.slice(0, 6);
  if (!top.length) {
    els.predictions.innerHTML = `<p class="help">No detections in this frame.</p>`;
    return;
  }
  for (const detection of top) {
    const match =
      watched.has(detection.className.toLowerCase()) && detection.probability >= threshold;
    const row = document.createElement("div");
    row.className = "pred";
    row.innerHTML = `
      <strong>${detection.className}</strong>
      <span>${Math.round(detection.probability * 100)}%</span>
      <div class="bar${match ? " match" : ""}"><span style="width:${Math.round(
        detection.probability * 100
      )}%"></span></div>
    `;
    els.predictions.appendChild(row);
  }
}

async function predictCoco(source) {
  const raw = await state.coco.detect(source);
  return raw
    .map((item) => ({
      className: item.class,
      probability: item.score,
      bbox: item.bbox,
    }))
    .sort((a, b) => b.probability - a.probability);
}

async function predictTeachable(source) {
  const { model, labels, imageSize } = state.teachable;
  const probabilities = window.tf.tidy(() => {
    const tensor = window.tf.browser
      .fromPixels(source)
      .resizeBilinear([imageSize, imageSize])
      .toFloat()
      .div(127.5)
      .sub(1)
      .expandDims(0);
    const logits = model.predict(tensor);
    return Array.from(logits.dataSync());
  });
  return labels
    .map((className, index) => ({
      className,
      probability: probabilities[index] || 0,
    }))
    .sort((a, b) => b.probability - a.probability);
}

async function runPrediction(source, origin) {
  if (selectedMode() === "teachable") {
    if (!state.teachable) await loadTeachableModel();
  } else if (!state.coco) {
    await loadCocoModel();
  }

  drawFrame(source);
  const detections =
    selectedMode() === "teachable" ? await predictTeachable(els.overlay) : await predictCoco(els.overlay);
  if (selectedMode() === "coco") {
    drawFrame(source);
    drawBoxes(detections);
  }
  renderPredictions(detections);
  await maybeAlert(detections, origin);
  return detections;
}

async function maybeAlert(detections, source) {
  if (!els.alertsEnabled.checked) return;
  const watched = parseWatched();
  const threshold = Number(els.threshold.value);
  const hits = detections.filter(
    (item) =>
      watched.some((name) => name.toLowerCase() === item.className.toLowerCase()) &&
      item.probability >= threshold
  );
  if (!hits.length) return;

  const cooldownMs = Number(els.cooldown.value) * 1000;
  if (Date.now() - state.lastAlertAt < cooldownMs) return;

  const body = {
    to: els.emailTo.value.trim(),
    detections: detections.map(({ className, probability }) => ({ className, probability })),
    watchedClasses: watched,
    threshold,
    cooldownMs,
    source,
    snapshot: els.includeSnapshot.checked ? els.overlay.toDataURL("image/jpeg", 0.7) : undefined,
  };

  const response = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.status === 429) {
    els.mailStatus.textContent = "Cooldown active — email not sent again yet.";
    return;
  }
  if (!response.ok) {
    els.mailStatus.textContent = payload.error || "Could not send alert";
    return;
  }
  state.lastAlertAt = Date.now();
  setStatus("alert", `Alert: ${hits[0].className}`);
  const mode = payload.alert?.delivery?.mode === "smtp" ? "emailed" : "saved to outbox";
  els.mailStatus.textContent = `Alert ${mode}: ${payload.alert.subject}`;
  await refreshLog();
}

async function loop(timestamp) {
  if (!state.looping) return;
  if (timestamp - state.lastPredict >= PREDICT_EVERY_MS && els.video.readyState >= 2) {
    state.lastPredict = timestamp;
    try {
      await runPrediction(els.video, "webcam");
    } catch (error) {
      els.modelStatus.textContent = error.message;
    }
  }
  requestAnimationFrame(loop);
}

async function startCamera() {
  try {
    await loadSelectedModel();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    els.still.hidden = true;
    setHint("");
    state.looping = true;
    els.btnStop.disabled = false;
    setStatus("live", "Monitoring");
    requestAnimationFrame(loop);
  } catch (error) {
    setStatus("idle", "Idle");
    els.modelStatus.textContent = error.message;
  }
}

function stopCamera() {
  state.looping = false;
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  els.video.srcObject = null;
  els.btnStop.disabled = true;
  setStatus("idle", "Idle");
}

async function onFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  stopCamera();
  const url = URL.createObjectURL(file);
  els.still.onload = async () => {
    setHint("");
    els.still.hidden = false;
    try {
      await runPrediction(els.still, "upload");
      setStatus("live", "Image scanned");
    } catch (error) {
      els.modelStatus.textContent = error.message;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  els.still.src = url;
  event.target.value = "";
}

async function sendTestEmail() {
  els.mailStatus.textContent = "Sending test email…";
  const response = await fetch("/api/alerts/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: els.emailTo.value.trim() }),
  });
  const payload = await response.json();
  if (!response.ok) {
    els.mailStatus.textContent = payload.error || "Test email failed";
    return;
  }
  els.mailStatus.textContent =
    payload.mode === "smtp" ? "Test email sent via SMTP." : "SMTP is not configured; test message saved to data/outbox.";
}

async function refreshLog() {
  const response = await fetch("/api/alerts");
  const payload = await response.json();
  els.alertLog.innerHTML = "";
  if (!payload.alerts?.length) {
    els.alertLog.innerHTML = `<li class="meta">No alerts yet.</li>`;
    return;
  }
  for (const alert of payload.alerts) {
    const item = document.createElement("li");
    const hits = (alert.hits || []).map((hit) => `${hit.className} ${Math.round(hit.probability * 100)}%`).join(", ");
    item.innerHTML = `
      <strong>${alert.subject}</strong>
      <span class="meta">${new Date(alert.at).toLocaleString()} · ${alert.delivery?.mode || "unknown"} · ${alert.to}</span>
      <span>${hits}</span>
    `;
    els.alertLog.appendChild(item);
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  if (!els.emailTo.value && config.defaultTo) {
    els.emailTo.value = config.defaultTo;
  }
  els.smtpNote.textContent = config.smtpConfigured
    ? "SMTP is configured on the server. Matching detections will send a real email."
    : "No SMTP settings yet. Alerts are written to data/outbox/ as HTML until you add SMTP to .env.";
}

function bind() {
  for (const radio of document.querySelectorAll('input[name="model-mode"]')) {
    radio.addEventListener("change", () => {
      saveSettings();
      syncModeUi();
    });
  }
  for (const input of [els.watched, els.threshold, els.cooldown, els.emailTo, els.tmUrl]) {
    input.addEventListener("change", saveSettings);
    input.addEventListener("input", saveSettings);
  }
  els.alertsEnabled.addEventListener("change", saveSettings);
  els.includeSnapshot.addEventListener("change", saveSettings);
  els.watched.addEventListener("input", () =>
    renderChips(selectedMode() === "teachable" && state.teachable ? state.teachable.labels : COCO_CHIPS)
  );
  els.btnCamera.addEventListener("click", startCamera);
  els.btnStop.addEventListener("click", stopCamera);
  els.btnLoadModel.addEventListener("click", () => loadSelectedModel().catch(() => {}));
  els.btnTestEmail.addEventListener("click", sendTestEmail);
  els.btnRefreshLog.addEventListener("click", refreshLog);
  els.fileInput.addEventListener("change", onFile);
}

loadSettings();
bind();
loadConfig();
refreshLog();
