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
const PREDICT_EVERY_MS = 280;

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
  eventTape: document.getElementById("event-tape"),
  streamStatus: document.getElementById("stream-status"),
  btnCamera: document.getElementById("btn-camera"),
  btnDemo: document.getElementById("btn-demo"),
  btnStop: document.getElementById("btn-stop"),
  btnLoadModel: document.getElementById("btn-load-model"),
  btnTestEmail: document.getElementById("btn-test-email"),
  btnRefreshLog: document.getElementById("btn-refresh-log"),
  fileInput: document.getElementById("file-input"),
  uptime: document.getElementById("stat-uptime"),
  fps: document.getElementById("stat-fps"),
  frames: document.getElementById("stat-frames"),
  present: document.getElementById("stat-present"),
  timecode: document.getElementById("timecode"),
  sparkline: document.getElementById("sparkline"),
};

const state = {
  mode: "coco",
  coco: null,
  teachable: null,
  stream: null,
  looping: false,
  source: "idle",
  lastPredict: 0,
  lastAlertAt: 0,
  startedAt: 0,
  frames: 0,
  ticks: [],
  histogram: new Array(60).fill(0),
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
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      mode: selectedMode(),
      tmUrl: els.tmUrl.value,
      watched: els.watched.value,
      threshold: els.threshold.value,
      cooldown: els.cooldown.value,
      alertsEnabled: els.alertsEnabled.checked,
      includeSnapshot: els.includeSnapshot.checked,
      emailTo: els.emailTo.value,
    })
  );
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
  const teachable = selectedMode() === "teachable";
  els.tmField.hidden = !teachable;
  els.modelHelp.textContent = teachable
    ? "Paste the share URL from Teachable Machine’s Export panel. It should end with /models/MODEL_ID/."
    : "Detects people, cars, animals, and 80 everyday objects in the browser. Demo feed needs no model.";
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
      els.watched.value = exists
        ? current.filter((item) => item.toLowerCase() !== name.toLowerCase()).join(", ")
        : [...current, name].join(", ");
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
  if (els.overlay.width !== width || els.overlay.height !== height) {
    els.overlay.width = width;
    els.overlay.height = height;
  }
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function formatUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function currentFps() {
  const cutoff = Date.now() - 2000;
  state.ticks = state.ticks.filter((time) => time >= cutoff);
  return state.ticks.length / 2;
}

function drawHud(ctx, detections) {
  ctx.fillStyle = "rgba(20, 17, 13, 0.55)";
  ctx.fillRect(0, 0, ctx.canvas.width, 28);
  ctx.fillRect(0, ctx.canvas.height - 28, ctx.canvas.width, 28);
  ctx.fillStyle = "#d9ccb4";
  ctx.font = "12px monospace";
  ctx.fillText(`CAM-01  ${formatClock()}  ${state.source.toUpperCase()}`, 10, 18);
  ctx.fillText(
    `${detections.length} objects  fps ${currentFps().toFixed(1)}`,
    10,
    ctx.canvas.height - 10
  );
}

function drawBoxes(detections) {
  const ctx = els.overlay.getContext("2d");
  ctx.font = "14px Arial";
  for (const detection of detections) {
    if (!detection.bbox) continue;
    const [x, y, width, height] = detection.bbox;
    ctx.strokeStyle = "#d4522b";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    const label = `${detection.className} ${Math.round(detection.probability * 100)}%`;
    ctx.fillStyle = "#14110d";
    ctx.fillRect(x, Math.max(0, y - 20), ctx.measureText(label).width + 10, 20);
    ctx.fillStyle = "#ece4d4";
    ctx.fillText(label, x + 5, Math.max(14, y - 6));
  }
}

function drawDemoScene(detections, timestamp) {
  const canvas = els.overlay;
  fitCanvas(960, 540);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b1210";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(61, 186, 122, 0.12)";
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  const scan = (timestamp / 18) % canvas.height;
  ctx.fillStyle = "rgba(61, 186, 122, 0.08)";
  ctx.fillRect(0, scan, canvas.width, 18);
  drawBoxes(detections);
  drawHud(ctx, detections);
}

function renderPredictions(detections) {
  const watched = new Set(parseWatched().map((name) => name.toLowerCase()));
  const threshold = Number(els.threshold.value);
  els.predictions.innerHTML = "";
  const top = detections.slice(0, 6);
  if (!top.length) {
    els.predictions.innerHTML = `<p class="help">Scene is clear.</p>`;
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

function drawSparkline(values) {
  const canvas = els.sparkline;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const max = Math.max(1, ...values);
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * canvas.width;
    const y = canvas.height - (value / max) * (canvas.height - 4) - 2;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#d4522b";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function demoDetections(timestamp, width, height) {
  const cycle = 8000;
  const phase = timestamp % cycle;
  const x = 120 + Math.sin(timestamp / 900) * 160;
  const y = 150 + Math.cos(timestamp / 1100) * 50;
  const detections = [];
  if (phase < 5200) {
    detections.push({
      className: "person",
      probability: 0.88 + Math.sin(timestamp / 400) * 0.04,
      bbox: [x, y, 92, 188],
    });
  }
  if (phase > 2800 && phase < 7200) {
    detections.push({
      className: "car",
      probability: 0.74,
      bbox: [width - 260, height - 140, 190, 86],
    });
  }
  return detections;
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
    .map((className, index) => ({ className, probability: probabilities[index] || 0 }))
    .sort((a, b) => b.probability - a.probability);
}

async function recognize(source) {
  if (selectedMode() === "teachable") {
    if (!state.teachable) await loadTeachableModel();
    return predictTeachable(source);
  }
  if (!state.coco) await loadCocoModel();
  return predictCoco(source);
}

function updateHud(present) {
  els.uptime.textContent = state.startedAt ? formatUptime(Date.now() - state.startedAt) : "00:00:00";
  els.fps.textContent = currentFps().toFixed(1);
  els.frames.textContent = String(state.frames);
  els.present.textContent = present.length ? present.join(", ") : "—";
  els.timecode.textContent = formatClock();
  els.timecode.dateTime = new Date().toISOString();
}

async function publishTick(detections) {
  const response = await fetch("/api/monitor/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: state.source,
      detections: detections.map(({ className, probability, bbox }) => ({ className, probability, bbox })),
      watchedClasses: parseWatched(),
      threshold: Number(els.threshold.value),
      fps: currentFps(),
    }),
  });
  return response.json();
}

async function maybeAlert(detections, enteredHits) {
  if (!els.alertsEnabled.checked || !enteredHits?.length) return;
  const cooldownMs = Number(els.cooldown.value) * 1000;
  if (Date.now() - state.lastAlertAt < cooldownMs) return;

  const response = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: els.emailTo.value.trim(),
      detections: detections.map(({ className, probability }) => ({ className, probability })),
      watchedClasses: parseWatched(),
      threshold: Number(els.threshold.value),
      cooldownMs,
      source: state.source,
      snapshot: els.includeSnapshot.checked ? els.overlay.toDataURL("image/jpeg", 0.7) : undefined,
      notes: `Presence enter: ${enteredHits.map((hit) => hit.className).join(", ")}`,
    }),
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
  setStatus("alert", `Alert: ${enteredHits[0].className}`);
  const mode = payload.alert?.delivery?.mode === "smtp" ? "emailed" : "saved to outbox";
  els.mailStatus.textContent = `Alert ${mode}: ${payload.alert.subject}`;
  await refreshLog();
}

async function runFrame(sourceEl, origin, timestamp = performance.now()) {
  let detections;
  if (origin === "demo") {
    detections = demoDetections(timestamp, els.overlay.width, els.overlay.height);
    drawDemoScene(detections, timestamp);
  } else {
    const ctx = els.overlay.getContext("2d");
    fitCanvas(
      sourceEl.videoWidth || sourceEl.naturalWidth || sourceEl.width,
      sourceEl.videoHeight || sourceEl.naturalHeight || sourceEl.height
    );
    ctx.drawImage(sourceEl, 0, 0, els.overlay.width, els.overlay.height);
    detections = await recognize(els.overlay);
    ctx.drawImage(sourceEl, 0, 0, els.overlay.width, els.overlay.height);
    drawBoxes(detections);
    drawHud(ctx, detections);
  }

  state.frames += 1;
  state.ticks.push(Date.now());
  renderPredictions(detections);
  const tick = await publishTick(detections);
  updateHud(tick.present || []);
  if (tick.enteredHits?.length) {
    setStatus("alert", `Entered: ${tick.enteredHits.map((hit) => hit.className).join(", ")}`);
  } else if (state.looping) {
    setStatus("live", origin === "demo" ? "Demo live" : "Monitoring");
  }
  await maybeAlert(detections, tick.enteredHits);
  return detections;
}

async function loop(timestamp) {
  if (!state.looping) return;
  if (timestamp - state.lastPredict >= PREDICT_EVERY_MS) {
    state.lastPredict = timestamp;
    try {
      if (state.source === "demo") {
        await runFrame(null, "demo", timestamp);
      } else if (els.video.readyState >= 2) {
        await runFrame(els.video, "webcam", timestamp);
      }
    } catch (error) {
      els.modelStatus.textContent = error.message;
    }
  }
  requestAnimationFrame(loop);
}

async function beginSession(source) {
  state.source = source;
  state.startedAt = Date.now();
  state.frames = 0;
  state.ticks = [];
  await fetch("/api/monitor/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
}

async function startCamera() {
  try {
    stopLocalMedia();
    await loadSelectedModel();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    els.still.hidden = true;
    setHint("");
    await beginSession("webcam");
    state.looping = true;
    els.btnStop.disabled = false;
    setStatus("live", "Monitoring");
    requestAnimationFrame(loop);
  } catch (error) {
    setStatus("idle", "Standby");
    els.modelStatus.textContent = error.message;
  }
}

async function startDemo() {
  stopLocalMedia();
  els.still.hidden = true;
  setHint("");
  await beginSession("demo");
  state.looping = true;
  els.btnStop.disabled = false;
  setStatus("live", "Demo live");
  els.modelStatus.textContent = "Demo feed armed — synthetic person/car presence, no camera required.";
  requestAnimationFrame(loop);
}

function stopLocalMedia() {
  state.looping = false;
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  els.video.srcObject = null;
}

async function stopMonitor() {
  stopLocalMedia();
  els.btnStop.disabled = true;
  state.source = "idle";
  setStatus("idle", "Standby");
  await fetch("/api/monitor/stop", { method: "POST" });
}

async function onFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await stopMonitor();
  const url = URL.createObjectURL(file);
  els.still.onload = async () => {
    setHint("");
    els.still.hidden = false;
    try {
      await beginSession("upload");
      await runFrame(els.still, "upload");
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

function renderTape(events) {
  els.eventTape.innerHTML = "";
  const items = (events || []).filter((event) => event.type !== "tick" && event.type !== "hello");
  if (!items.length) {
    els.eventTape.innerHTML = `<li class="meta">Waiting for presence events.</li>`;
    return;
  }
  for (const event of items.slice(0, 40)) {
    const item = document.createElement("li");
    item.className = event.type;
    const when = new Date(event.at).toLocaleTimeString(undefined, { hour12: false });
    if (event.type === "enter") {
      item.innerHTML = `<strong>ENTER ${event.classes.join(", ")}</strong><span class="meta">${when} · ${event.source || ""}</span>`;
    } else if (event.type === "exit") {
      item.innerHTML = `<strong>EXIT ${event.classes.join(", ")}</strong><span class="meta">${when}</span>`;
    } else if (event.type === "alert") {
      item.innerHTML = `<strong>${event.alert?.subject || "Alert"}</strong><span class="meta">${when} · ${event.alert?.delivery?.mode || ""}</span>`;
    } else {
      item.innerHTML = `<strong>${event.type}</strong><span class="meta">${when}</span>`;
    }
    els.eventTape.appendChild(item);
  }
}

function applySnapshot(snapshot) {
  if (snapshot.histogram) {
    state.histogram = snapshot.histogram;
    drawSparkline(snapshot.histogram);
  }
  if (snapshot.events) renderTape(snapshot.events);
  if (snapshot.session?.present) {
    els.present.textContent = snapshot.session.present.length ? snapshot.session.present.join(", ") : "—";
  }
}

function connectStream() {
  const source = new EventSource("/api/monitor/events");
  source.addEventListener("open", () => {
    els.streamStatus.textContent = "live";
  });
  source.onerror = () => {
    els.streamStatus.textContent = "reconnecting";
  };
  source.addEventListener("hello", (message) => {
    applySnapshot(JSON.parse(message.data));
  });
  source.addEventListener("tick", (message) => {
    const event = JSON.parse(message.data);
    if (event.histogram) {
      state.histogram = event.histogram;
      drawSparkline(event.histogram);
    }
  });
  for (const type of ["enter", "exit", "alert", "start", "stop"]) {
    source.addEventListener(type, async (message) => {
      const snapshot = await fetch("/api/monitor/status").then((response) => response.json());
      applySnapshot(snapshot);
      if (type === "alert") refreshLog();
      void message;
    });
  }
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
    payload.mode === "smtp"
      ? "Test email sent via SMTP."
      : "SMTP is not configured; test message saved to data/outbox.";
}

async function refreshLog() {
  const response = await fetch("/api/alerts");
  const payload = await response.json();
  els.alertLog.innerHTML = "";
  if (!payload.alerts?.length) {
    els.alertLog.innerHTML = `<li class="meta">No email alerts yet.</li>`;
    return;
  }
  for (const alert of payload.alerts) {
    const item = document.createElement("li");
    const hits = (alert.hits || [])
      .map((hit) => `${hit.className} ${Math.round(hit.probability * 100)}%`)
      .join(", ");
    item.innerHTML = `
      <strong>${alert.subject}</strong>
      <span class="meta">${new Date(alert.at).toLocaleString()} · ${alert.delivery?.mode || "unknown"} · ${alert.to}</span>
      <span>${hits}</span>
    `;
    els.alertLog.appendChild(item);
  }
}

async function loadConfig() {
  const config = await fetch("/api/config").then((response) => response.json());
  if (!els.emailTo.value && config.defaultTo) els.emailTo.value = config.defaultTo;
  els.smtpNote.textContent = config.smtpConfigured
    ? "SMTP is configured. Presence-enter events will send a real email."
    : "No SMTP yet. Alerts are written to data/outbox/ until you add SMTP to .env.";
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
  els.btnDemo.addEventListener("click", startDemo);
  els.btnStop.addEventListener("click", stopMonitor);
  els.btnLoadModel.addEventListener("click", () => loadSelectedModel().catch(() => {}));
  els.btnTestEmail.addEventListener("click", sendTestEmail);
  els.btnRefreshLog.addEventListener("click", refreshLog);
  els.fileInput.addEventListener("change", onFile);
  setInterval(() => {
    if (state.looping) updateHud(els.present.textContent === "—" ? [] : els.present.textContent.split(", "));
    els.timecode.textContent = formatClock();
  }, 250);
}

loadSettings();
bind();
loadConfig();
refreshLog();
connectStream();
drawSparkline(state.histogram);
