// ===== CONSTANTS =====
const OPERATION_DURATION = 10 * 60 * 1000;
const REST_DURATION = 5 * 60 * 1000;
const FULL_CYCLE_DURATION = OPERATION_DURATION + REST_DURATION;
const TIMER_TICK_INTERVAL = 1000;
const MAX_POINTS = 12;
const MAX_RECORD_LOG = 10000;

const UI_STORAGE_KEY = "pbrUiSettingsCodePenV5_InfoLinks";
const HISTORY_STORAGE_KEY = "pbrSensorHistoryCodePenV4_LedSimple";
const RECORD_LOG_STORAGE_KEY = "pbrSpreadsheetRecordsCodePenV4_LedSimple";
const LED_STORAGE_KEY = "pbrLedLightingSettingsV1";

const LED_PAR_MIN = 0;
const LED_PAR_MAX = 1000;
const LED_PAR_STEP = 10;
const LED_RED_RATIO = 0.75;
const LED_BLUE_RATIO = 0.25;

// PERMANENT FIREBASE URL
const FIREBASE_DATABASE_URL = "https://photobioreactor-monitoring-sys-default-rtdb.asia-southeast1.firebasedatabase.app";
const SETTINGS_FIREBASE_PATH = "/pbr/dashboardSettings";
const RECIPIENTS_FIREBASE_PATH = "/pbr/alertRecipients";

// ===== PERMANENT BACKGROUND IMAGE (hardcoded) =====
const BACKGROUND_IMAGE_URL = "https://i.imgur.com/BYpTmrC.png";

// ===== HARDCODED ADMIN CREDENTIALS =====
const ADMIN_USERNAME = "pbr-admin";
const ADMIN_PASSWORD = "RJGscs123";
let isAdmin = false;

// ===== FIREBASE INIT =====
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: FIREBASE_DATABASE_URL,
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== DEFAULTS =====
const defaultSettings = {
  title: "PBR - Nannochloropsis",
  subtitle: "Sensor & Relay Systems",
  accent: "#22d3ee",
  pageBg: "#050816",
  cardBg: "#0f172a",
  cardOpacity: 86,
  textColor: "#e5faff",
  valueSize: 48,
  columns: 5,
  wiringManualUrl: "",
  calibrationProceduresUrl: "",
  troubleshootingInstructionsUrl: ""
};

const thresholds = {
  ph: { optimalMin: 7.5, optimalMax: 9.0, criticalHigh: 9.5 },
  temperature: { optimalMin: 16, optimalMax: 27, criticalHigh: 33 },
  dissolvedOxygen: { optimalMin: 80, optimalMax: 130, criticalHigh: 250 },
  co2: { optimalMin: 1, optimalMax: 5, criticalHigh: 10 },
  waterLevel: { lowCritical: 40, highCritical: 90 }
};

const sensorDetails = {
  ph: { name: "pH Level", unit: "pH", decimals: 2, chartId: "phChart", tagId: "phThresholdTag" },
  temperature: { name: "Temperature", unit: "°C", decimals: 1, chartId: "tempChart", tagId: "temperatureThresholdTag" },
  dissolvedOxygen: { name: "Dissolved Oxygen", unit: "% saturation", decimals: 1, chartId: "doChart", tagId: "doThresholdTag" },
  co2: { name: "CO₂ Concentration", unit: "ppm", decimals: 0, chartId: "co2Chart", tagId: "co2ThresholdTag" },
  waterLevel: { name: "Water Level", unit: "cm", decimals: 2, chartId: "waterLevelChart", tagId: "waterThresholdTag" }
};

// ===== STATE =====
let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || {
  ph: [],
  temperature: [],
  dissolvedOxygen: [],
  co2: [],
  waterLevel: []
};
let recordLog = JSON.parse(localStorage.getItem(RECORD_LOG_STORAGE_KEY)) || [];
let savedSettings = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
let uiSettings = savedSettings ? { ...defaultSettings, ...savedSettings } : { ...defaultSettings };
let firebaseDatabaseUrl = FIREBASE_DATABASE_URL;
let lastRecordedFirebaseFingerprint = "";
let selectedDetailedSensor = "ph";
let cycleStartTime = Date.now();
let lastCyclePhase = null;
let cycleTimerInterval = null;
let ledSettings = JSON.parse(localStorage.getItem(LED_STORAGE_KEY)) || { enabled: false, targetPAR: 500 };
let alertRecipients = [];

// ===== CYCLE SYNC – base for local simulation =====
let baseTimestamp = Date.now();           // reference time (ms)
let lastFirebaseUpdate = null;            // timestamp of last Firebase cycle update
let localCycleStatus = "ACTIVE";
let baseRemaining = OPERATION_DURATION;   // remaining time at baseTimestamp

// ===== UTILITY =====
function $(id) { return document.getElementById(id); }

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function hexToRgb(hex) {
  let cleanHex = String(hex || "#0f172a").replace("#", "");
  if (cleanHex.length === 3) cleanHex = cleanHex.split("").map(c => c + c).join("");
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16)
  };
}

// ===== FIREBASE REST HELPERS =====
function firebaseUrl(path) {
  const baseUrl = FIREBASE_DATABASE_URL;
  if (!baseUrl) throw new Error("Firebase Database URL is empty.");
  let cleanPath = String(path || "");
  if (!cleanPath.startsWith("/")) cleanPath = "/" + cleanPath;
  if (!cleanPath.endsWith(".json")) cleanPath += ".json";
  return baseUrl + cleanPath;
}

async function firebaseGet(path) {
  const response = await fetch(firebaseUrl(path) + "?t=" + Date.now(), { method: "GET", cache: "no-store" });
  if (!response.ok) throw new Error("Firebase returned HTTP " + response.status);
  return await response.json();
}

async function firebasePut(path, data) {
  const response = await fetch(firebaseUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error("Firebase PUT failed: HTTP " + response.status);
  return await response.json();
}

// ===== ADMIN AUTH =====
function enableEditing(enabled) {
  const inputs = document.querySelectorAll('.editor-panel input, .editor-panel select, .editor-panel button');
  inputs.forEach(el => {
    if (el.id === 'loginBtn' || el.id === 'logoutBtn') return;
    el.disabled = !enabled;
  });
  const addBtn = document.querySelector('button[onclick="addRecipient()"]');
  if (addBtn) addBtn.disabled = !enabled;
  const syncBtn = document.querySelector('button[onclick="syncRecipientsToFirebase()"]');
  if (syncBtn) syncBtn.disabled = !enabled;
  document.querySelectorAll('button[onclick="saveUiSettings()"]').forEach(b => b.disabled = !enabled);
  const resetBtn = document.querySelector('button[onclick="resetUiSettings()"]');
  if (resetBtn) resetBtn.disabled = !enabled;
  if ($('recipientEmailInput')) $('recipientEmailInput').disabled = !enabled;
  if ($('recipientPhoneInput')) $('recipientPhoneInput').disabled = !enabled;
  const lockStatus = $('settingsLockStatus');
  if (lockStatus) {
    lockStatus.textContent = enabled ? '🔓 Editing enabled' : '🔒 Read-only (login to edit)';
  }
  
  // Show/hide the Settings gear button based on login state
  const gearBtn = document.getElementById('settingsGearBtn');
  if (gearBtn) {
    gearBtn.style.display = enabled ? 'inline-block' : 'none';
  }
}

function openLoginModal() {
  $('loginModal').style.display = 'flex';
  $('loginError').style.display = 'none';
}

function closeLoginModal() {
  $('loginModal').style.display = 'none';
}

function login() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();
  if (!username || !password) {
    $('loginError').textContent = 'Please enter username and password.';
    $('loginError').style.display = 'block';
    return;
  }
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    isAdmin = true;
    closeLoginModal();
    enableEditing(true);
    $('authStatus').textContent = '';
    $('loginBtn').style.display = 'none';
    $('logoutBtn').style.display = 'inline-block';
    loadRecipientsFromFirebase();
  } else {
    $('loginError').textContent = 'Invalid username or password.';
    $('loginError').style.display = 'block';
  }
}

function logout() {
  isAdmin = false;
  $('authStatus').textContent = 'Not logged in';
  $('loginBtn').style.display = 'inline-block';
  $('logoutBtn').style.display = 'none';
  enableEditing(false);
}

// ===== SETTINGS SYNC =====
async function loadSettingsFromFirebase() {
  try {
    const data = await firebaseGet(SETTINGS_FIREBASE_PATH);
    if (data && Object.keys(data).length) {
      uiSettings = { ...defaultSettings, ...data };
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiSettings));
      applyUiSettings();
      return true;
    }
    return false;
  } catch (e) {
    console.warn("Could not load settings from Firebase:", e);
    return false;
  }
}

async function saveSettingsToFirebase() {
  try {
    await firebasePut(SETTINGS_FIREBASE_PATH, uiSettings);
    console.log("Settings saved to Firebase.");
  } catch (e) {
    console.error("Failed to save settings to Firebase:", e);
  }
}

// ===== RECIPIENTS =====
async function loadRecipientsFromFirebase() {
  try {
    const data = await firebaseGet(RECIPIENTS_FIREBASE_PATH);
    if (data && Array.isArray(data)) {
      alertRecipients = data;
    } else {
      alertRecipients = [];
    }
    renderRecipients();
    return alertRecipients;
  } catch (e) {
    console.warn("Could not load recipients:", e);
    alertRecipients = [];
    renderRecipients();
    return [];
  }
}

async function saveRecipientsToFirebase() {
  try {
    await firebasePut(RECIPIENTS_FIREBASE_PATH, alertRecipients);
    console.log("Recipients saved to Firebase");
  } catch (e) {
    console.error("Failed to save recipients:", e);
  }
}

// ===== UPDATED addRecipient function =====
function addRecipient() {
  const email = $('recipientEmailInput').value.trim();
  let phone = $('recipientPhoneInput').value.trim();

  if (!email && !phone) {
    alert("Please enter at least an email or phone number.");
    return;
  }

  if (phone) {
    // Remove spaces, dashes, parentheses, dots, etc.
    phone = phone.replace(/[\s\-\(\)\.]/g, '');

    // Reject numbers that start with 0 (like 09171234567)
    if (/^0/.test(phone)) {
      alert("Phone number cannot start with 0. Please enter a valid number (e.g., 9171234567 or +639171234567).");
      return;
    }

    // If it's a 10-digit number starting with 9 (Philippine mobile), prepend +63
    if (/^9\d{9}$/.test(phone)) {
      phone = '+63' + phone;
    }
    // If it's not already in E.164 format, reject it
    else if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      alert("Phone number must be a valid Philippine number (e.g., 9171234567) or in E.164 format (e.g., +639171234567).");
      return;
    }
  }

  // Check duplicate (using normalized phone)
  const duplicate = alertRecipients.some(r => r.email === email && r.phone === phone);
  if (duplicate) {
    alert("This recipient is already in the list.");
    return;
  }

  alertRecipients.push({ email, phone });
  renderRecipients();
  saveRecipientsToFirebase();

  $('recipientEmailInput').value = '';
  $('recipientPhoneInput').value = '';
}

function removeRecipient(index) {
  alertRecipients.splice(index, 1);
  renderRecipients();
  saveRecipientsToFirebase();
}

function renderRecipients() {
  const container = $('recipientList');
  if (!container) return;
  if (alertRecipients.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;">No recipients added yet.</p>';
    return;
  }
  container.innerHTML = alertRecipients.map((r, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:10px; background:rgba(2,6,23,0.52); border:1px solid rgba(34,211,238,0.18);">
      <span>${r.email ? `📧 ${r.email}` : ''} ${r.phone ? `📱 ${r.phone}` : ''}</span>
      <button onclick="removeRecipient(${i})" style="background:#ef4444; color:#fff; padding:4px 12px; border-radius:8px; font-size:14px;">✕</button>
    </div>
  `).join('');
}

function syncRecipientsToFirebase() {
  saveRecipientsToFirebase();
}

// ===== UI SETTINGS =====
function applyUiSettings() {
  const rgb = hexToRgb(uiSettings.cardBg);
  const cardOpacity = Number(uiSettings.cardOpacity) / 100;
  document.documentElement.style.setProperty("--accent", uiSettings.accent);
  document.documentElement.style.setProperty("--page-bg", uiSettings.pageBg);
  document.documentElement.style.setProperty("--card-bg", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  document.documentElement.style.setProperty("--card-opacity", cardOpacity);
  document.documentElement.style.setProperty("--text-color", uiSettings.textColor);
  document.documentElement.style.setProperty("--value-size", uiSettings.valueSize + "px");
  document.documentElement.style.setProperty("--columns", uiSettings.columns);
  $("dashboardTitle").textContent = uiSettings.title;
  $("dashboardSubtitle").textContent = uiSettings.subtitle;
  $("titleInput").value = uiSettings.title;
  $("subtitleInput").value = uiSettings.subtitle;
  $("accentInput").value = uiSettings.accent;
  $("pageBgInput").value = uiSettings.pageBg;
  $("cardBgInput").value = uiSettings.cardBg;
  $("textColorInput").value = uiSettings.textColor;
  $("cardOpacityInput").value = uiSettings.cardOpacity;
  $("cardOpacityValue").textContent = uiSettings.cardOpacity + "%";
  $("valueSizeInput").value = uiSettings.valueSize;
  $("columnsInput").value = uiSettings.columns;
  $("wiringManualUrlInput").value = uiSettings.wiringManualUrl || "";
  $("calibrationProceduresUrlInput").value = uiSettings.calibrationProceduresUrl || "";
  $("troubleshootingInstructionsUrlInput").value = uiSettings.troubleshootingInstructionsUrl || "";

  applyBackgroundImage();
  updateAdditionalInfoLinks();
}

function applyBackgroundImage() {
  const bg = $("backgroundPhoto");
  if (!bg) return;
  bg.style.backgroundImage = `url(${BACKGROUND_IMAGE_URL})`;
}

function saveUiSettings() {
  uiSettings = {
    title: $("titleInput").value,
    subtitle: $("subtitleInput").value,
    accent: $("accentInput").value,
    pageBg: $("pageBgInput").value,
    cardBg: $("cardBgInput").value,
    textColor: $("textColorInput").value,
    cardOpacity: Number($("cardOpacityInput").value),
    valueSize: Number($("valueSizeInput").value),
    columns: Number($("columnsInput").value),
    wiringManualUrl: normalizeReferenceUrl($("wiringManualUrlInput").value),
    calibrationProceduresUrl: normalizeReferenceUrl($("calibrationProceduresUrlInput").value),
    troubleshootingInstructionsUrl: normalizeReferenceUrl($("troubleshootingInstructionsUrlInput").value)
  };
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiSettings));
  applyUiSettings();
  saveSettingsToFirebase();
}

function resetUiSettings() {
  uiSettings = { ...defaultSettings };
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiSettings));
  applyUiSettings();
  saveSettingsToFirebase();
}

// ===== REFERENCE LINKS =====
function normalizeReferenceUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return "https://" + value;
}

function setInfoLink(linkId, statusId, rawUrl) {
  const link = $(linkId);
  const status = $(statusId);
  const url = normalizeReferenceUrl(rawUrl);
  if (!link || !status) return;
  if (!url) {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
    status.textContent = "No link set";
    return;
  }
  link.href = url;
  link.setAttribute("aria-disabled", "false");
  status.textContent = url;
}

function updateAdditionalInfoLinks() {
  setInfoLink("wiringManualLink", "wiringManualLinkStatus", uiSettings.wiringManualUrl);
  setInfoLink("calibrationProceduresLink", "calibrationProceduresLinkStatus", uiSettings.calibrationProceduresUrl);
  setInfoLink("troubleshootingInstructionsLink", "troubleshootingInstructionsLinkStatus", uiSettings.troubleshootingInstructionsUrl);
}

// ===== CONNECTION STATUS =====
function setConnectionStatus(message, status = "warning") {
  const box = $("firebaseConnectionStatus");
  if (!box) return;
  box.textContent = message;
  box.className = "connection-status " + status;
}

// ===== LED LIGHTING =====
function clampLedPAR(value) {
  const number = Number(value);
  if (isNaN(number)) return 500;
  return Math.min(LED_PAR_MAX, Math.max(LED_PAR_MIN, number));
}

function calculateLedOutput(targetPAR) {
  const safePAR = clampLedPAR(targetPAR);
  const normalized = (safePAR - LED_PAR_MIN) / (LED_PAR_MAX - LED_PAR_MIN || 1);
  const totalIntensity = normalized * 100;
  const redOutput = totalIntensity * LED_RED_RATIO;
  const blueOutput = totalIntensity * LED_BLUE_RATIO;
  return {
    targetPAR: safePAR,
    totalIntensity,
    redOutput,
    blueOutput,
    redRatio: LED_RED_RATIO,
    blueRatio: LED_BLUE_RATIO
  };
}

function saveLedLightingSettings() {
  localStorage.setItem(LED_STORAGE_KEY, JSON.stringify(ledSettings));
}

function updateLedLightingUI() {
  const output = calculateLedOutput(ledSettings.targetPAR);
  const parValue = $("ledParTargetValue");
  const parRange = $("ledParTargetRange");
  const status = $("ledLightingStatus");
  const parDisplay = $("ledParDisplay");
  const redDisplay = $("ledRedDisplay");
  const blueDisplay = $("ledBlueDisplay");
  
  if (parValue) parValue.textContent = output.targetPAR;
  if (parRange) parRange.value = output.targetPAR;
  if (parDisplay) parDisplay.textContent = output.targetPAR;
  if (redDisplay) redDisplay.textContent = output.redOutput.toFixed(1);
  if (blueDisplay) blueDisplay.textContent = output.blueOutput.toFixed(1);
  
  if (status) {
    status.textContent = ledSettings.enabled ? "LED ON" : "LED OFF";
    status.classList.toggle("on", ledSettings.enabled);
  }
}

function setLedTargetPAR(value, shouldSync = true) {
  ledSettings.targetPAR = clampLedPAR(value);
  saveLedLightingSettings();
  updateLedLightingUI();
  if (shouldSync) syncLedLightingToFirebase();
}

function dimLedLighting() {
  setLedTargetPAR(ledSettings.targetPAR - LED_PAR_STEP);
}

function brightenLedLighting() {
  setLedTargetPAR(ledSettings.targetPAR + LED_PAR_STEP);
}

function toggleLedLighting() {
  ledSettings.enabled = !ledSettings.enabled;
  saveLedLightingSettings();
  updateLedLightingUI();
  syncLedLightingToFirebase();
}

async function syncLedLightingToFirebase() {
  const output = calculateLedOutput(ledSettings.targetPAR);
  const command = {
    enabled: ledSettings.enabled,
    targetPAR: output.targetPAR,
    ratioMode: "3:1 red-blue",
    redRatio: output.redRatio,
    blueRatio: output.blueRatio,
    totalIntensityPercent: Number(output.totalIntensity.toFixed(2)),
    redIntensityPercent: Number(output.redOutput.toFixed(2)),
    blueIntensityPercent: Number(output.blueOutput.toFixed(2)),
    parMinimum: LED_PAR_MIN,
    parMaximum: LED_PAR_MAX,
    requestedAt: new Date().toISOString(),
    source: "dashboard-led-control",
    nonce: Date.now()
  };
  try {
    await firebasePut("/pbr/commands/ledLighting", command);
    setConnectionStatus("LED lighting settings sent to Firebase.", "ok");
  } catch (error) {
    console.error(error);
    setConnectionStatus("LED lighting sync failed: " + error.message, "error");
  }
}

// ===== SENSOR DATA PROCESSING =====
function getFirebaseReadingFingerprint(data) {
  if (!data) return "";
  return [
    data.timestampMs,
    data.readingSource,
    data.ph,
    data.temperature,
    data.doSaturationPercent,
    data.co2,
    data.waterLevel
  ].join("|");
}

function toNumberOrNull(value) {
  const number = Number(value);
  return value === undefined || value === null || isNaN(number) ? null : number;
}

function normalizeSensorData(rawData) {
  if (!rawData) return null;
  
  const ph = toNumberOrNull(rawData.ph);
  const temperature = toNumberOrNull(rawData.temperature);
  const dissolvedOxygen = toNumberOrNull(rawData.doSaturationPercent ?? rawData.dissolvedOxygen);
  const doMgL = toNumberOrNull(rawData.doMgL);
  const co2 = toNumberOrNull(rawData.co2);
  const co2PercentRaw = toNumberOrNull(rawData.co2Percent);
  const co2Percent = co2PercentRaw !== null ? co2PercentRaw : (co2 !== null ? co2 / 10000 : null);
  const waterLevel = toNumberOrNull(rawData.waterLevel);
  const waterLevelCmRaw = toNumberOrNull(rawData.waterLevelCm);
  const waterLevelCm = waterLevelCmRaw !== null ? waterLevelCmRaw : waterLevel;
  const phVoltage = toNumberOrNull(rawData.phVoltage);
  const phType = rawData.phType || "--";
  const phStatus = rawData.phStatus || "--";
  const temperatureStatus = rawData.temperatureStatus || "--";
  const doStatus = rawData.doStatus || "--";
  const co2Status = rawData.co2Status || "--";
  const co2PwmHigh = toNumberOrNull(rawData.co2PwmHigh);
  const doVoltage = toNumberOrNull(rawData.doVoltage);
  const waterA2Voltage = toNumberOrNull(rawData.waterA2Voltage);
  const waterStatus = rawData.waterStatus || "--";
  const ads1115Status = rawData.ads1115Status || "--";
  const ds18b20Count = rawData.ds18b20Count ?? "--";
  const readingSource = rawData.readingSource || "Firebase";
  const cycleStatus = rawData.cycleStatus || "UNKNOWN";
  const cycleRemainingMs = toNumberOrNull(rawData.cycleRemainingMs);
  const relayGrowLight = rawData.relayGrowLight === true;
  const relayAerator = rawData.relayAerator === true;
  const relayWaterPump = rawData.relayWaterPump === true;
  const ledEnabled = rawData.ledLightingEnabled === true;
  const ledTargetPAR = toNumberOrNull(rawData.ledTargetPAR);
  const ledTotalIntensity = toNumberOrNull(rawData.ledTotalIntensityPercent);
  const ledRedIntensity = toNumberOrNull(rawData.ledRedIntensityPercent);
  const ledBlueIntensity = toNumberOrNull(rawData.ledBlueIntensityPercent);
  const timestampMs = toNumberOrNull(rawData.timestampMs);

  return {
    ph,
    temperature,
    dissolvedOxygen,
    doMgL,
    co2,
    co2Percent,
    waterLevel,
    waterLevelCm,
    phVoltage,
    phType,
    phStatus,
    temperatureStatus,
    doStatus,
    co2Status,
    co2PwmHigh,
    doVoltage,
    waterA2Voltage,
    waterStatus,
    ads1115Status,
    ds18b20Count,
    readingSource,
    cycleStatus,
    cycleRemainingMs,
    relayGrowLight,
    relayAerator,
    relayWaterPump,
    ledEnabled,
    ledTargetPAR,
    ledTotalIntensity,
    ledRedIntensity,
    ledBlueIntensity,
    timestampISO: rawData.timestampISO,
    timestampMs: timestampMs
  };
}

// ===== THRESHOLD EVALUATION =====
function evaluateThreshold(sensorName, value) {
  if (value === null || value === undefined || isNaN(Number(value))) return { label: "NO DATA", level: "warning" };
  const number = Number(value);
  if (sensorName === "waterLevel") {
    if (number < thresholds.waterLevel.lowCritical) return { label: "LOW", level: "critical" };
    if (number > thresholds.waterLevel.highCritical) return { label: "HIGH", level: "critical" };
    return { label: "NORMAL", level: "optimal" };
  }
  const rule = thresholds[sensorName];
  if (number > rule.criticalHigh) return { label: "CRITICAL HIGH", level: "critical" };
  if (number < rule.optimalMin) return { label: "LOW", level: "warning" };
  if (number > rule.optimalMax) return { label: "HIGH", level: "warning" };
  return { label: "OPTIMAL", level: "optimal" };
}

function setThresholdTag(tagId, result) {
  const tag = $(tagId);
  if (!tag) return;
  tag.textContent = result.label;
  tag.classList.remove("optimal", "warning", "critical");
  tag.classList.add(result.level);
}

function setCardState(cardId, statusText) {
  const card = $(cardId);
  if (!card) return;
  card.classList.remove("normal", "warning", "alert");
  const status = String(statusText).toUpperCase();
  if (status.includes("CRITICAL") || status.includes("HIGH")) card.classList.add("alert");
  else if (status.includes("LOW") || status.includes("WARNING")) card.classList.add("warning");
  else if (status.includes("NORMAL") || status.includes("OK") || status.includes("OPTIMAL")) card.classList.add("normal");
}

function formatOptionalNumber(value, decimals) {
  if (value === undefined || value === null || isNaN(Number(value))) return "--";
  return Number(value).toFixed(decimals);
}

// ===== UI UPDATES =====
function updateCards(data) {
  $("phValue").textContent = formatOptionalNumber(data.ph, 2);
  $("tempValue").textContent = formatOptionalNumber(data.temperature, 1);
  $("doValue").textContent = formatOptionalNumber(data.dissolvedOxygen, 1);
  $("co2Value").textContent = formatOptionalNumber(data.co2, 0);
  $("waterLevelValue").textContent = formatOptionalNumber(data.waterLevelCm, 2);
  $("lastUpdate").textContent = new Date().toLocaleString();
  
  $("phVoltageDisplay").textContent = formatOptionalNumber(data.phVoltage, 4);
  $("phTypeDisplay").textContent = data.phType || "--";
  $("ds18b20CountDisplay").textContent = data.ds18b20Count;
  $("doMgLDisplay").textContent = formatOptionalNumber(data.doMgL, 2);
  $("doVoltageDisplay").textContent = formatOptionalNumber(data.doVoltage, 3);
  $("co2PercentDisplay").textContent = formatOptionalNumber(data.co2Percent, 3);
  $("co2PwmDisplay").textContent = formatOptionalNumber(data.co2PwmHigh, 2);
  $("waterDetectedDisplay").textContent = (data.waterLevel === 100) ? "YES" : "NO";
  $("waterVoltageDisplay").textContent = formatOptionalNumber(data.waterA2Voltage, 3);
  $("waterMarkDisplay").textContent = "20.00";
  
  Object.keys(sensorDetails).forEach(sensorName => {
    let value = data[sensorName];
    if (sensorName === "waterLevel") value = data.waterLevelCm;
    if (sensorName === "co2") value = data.co2Percent;
    setThresholdTag(sensorDetails[sensorName].tagId, evaluateThreshold(sensorName, value));
  });
}

function updateDiagnostics(data) {
  $("phVoltage").textContent = formatOptionalNumber(data.phVoltage, 4) + " V";
  $("phType").textContent = data.phType || "--";
  $("phStatus").textContent = data.phStatus || "--";
  $("temperatureStatus").textContent = data.temperatureStatus || "--";
  $("doStatus").textContent = data.doStatus || "--";
  $("co2Status").textContent = data.co2Status || "--";
  $("waterStatus").textContent = data.waterStatus || "--";
  $("ads1115Status").textContent = data.ads1115Status || "--";
  $("ds18b20Count").textContent = data.ds18b20Count ?? "--";
  $("readingSource").textContent = data.readingSource || "--";
  
  setCardState("phStatusCard", data.phStatus);
  setCardState("temperatureStatusCard", data.temperatureStatus);
  setCardState("doStatusCard", data.doStatus);
  setCardState("co2StatusCard", data.co2Status);
  setCardState("waterStatusCard", data.waterStatus);
  setCardState("ads1115StatusCard", data.ads1115Status);
}

function updateRelayUI(data) {
  const glState = $("relayGrowLightState");
  if (glState) {
    glState.textContent = data.relayGrowLight ? "ON" : "OFF";
    glState.className = "relay-state " + (data.relayGrowLight ? "on" : "off");
  }
  $("relayGrowLightMode").textContent = "AUTO";
  $("relayGrowLightReason").textContent = "—";
  
  const arState = $("relayAeratorState");
  if (arState) {
    arState.textContent = data.relayAerator ? "ON" : "OFF";
    arState.className = "relay-state " + (data.relayAerator ? "on" : "off");
  }
  $("relayAeratorMode").textContent = "AUTO";
  $("relayAeratorReason").textContent = "—";
  
  const wpState = $("relayPumpState");
  if (wpState) {
    wpState.textContent = data.relayWaterPump ? "ON" : "OFF";
    wpState.className = "relay-state " + (data.relayWaterPump ? "on" : "off");
  }
  $("relayPumpMode").textContent = "AUTO";
  $("relayPumpReason").textContent = "—";
}

function updateLedDisplay(data) {
  if (data.ledEnabled !== undefined) {
    ledSettings.enabled = data.ledEnabled;
    if (data.ledTargetPAR) ledSettings.targetPAR = clampLedPAR(data.ledTargetPAR);
    updateLedLightingUI();
  }
}

// ===== CYCLE UI =====
function updateCycleUI(data) {
  if (data && data.cycleStatus !== undefined && data.cycleRemainingMs !== undefined && data.cycleRemainingMs !== null && !isNaN(data.cycleRemainingMs)) {
    localCycleStatus = data.cycleStatus;
    let now = Date.now();
    let ts = data.timestampMs;
    if (ts !== undefined && ts !== null && !isNaN(ts) && ts > 0) {
      baseTimestamp = ts;
    } else {
      baseTimestamp = now;
    }
    baseRemaining = Math.max(0, data.cycleRemainingMs);
    lastFirebaseUpdate = now;
  } else {
    let now = Date.now();
    let elapsed = now - baseTimestamp;
    let phase = elapsed % FULL_CYCLE_DURATION;
    let remaining;
    let status;
    if (phase < OPERATION_DURATION) {
      status = "ACTIVE";
      remaining = OPERATION_DURATION - phase;
    } else {
      status = "COOL";
      remaining = FULL_CYCLE_DURATION - phase;
    }
    if (remaining < 0) remaining = 0;
    localCycleStatus = status;
    renderCycleUI(remaining);
    return;
  }

  let now = Date.now();
  let elapsed = now - baseTimestamp;
  let remaining = baseRemaining - elapsed;
  if (remaining < 0) remaining = 0;
  renderCycleUI(remaining);
}

function renderCycleUI(remainingMs) {
  const badge = $("cycleStatusBadge");
  const remaining = $("cycleRemainingDisplay");
  const opTimer = $("operationTimer");
  const restTimer = $("restTimer");
  const fullTimer = $("fullCycleTimer");
  const opCard = $("operationTimerCard");
  const restCard = $("restTimerCard");
  const statusPill = $("systemStatusPill");
  const statusText = $("systemStatusText");

  let displayStatus = localCycleStatus;

  if (badge) {
    if (displayStatus === "ACTIVE") {
      badge.textContent = "ACTIVE";
      badge.className = "cycle-status-badge";
    } else if (displayStatus === "COOL") {
      badge.textContent = "RESTING";
      badge.className = "cycle-status-badge resting";
    } else {
      badge.textContent = displayStatus;
      badge.className = "cycle-status-badge";
    }
  }

  if (remaining) {
    remaining.textContent = formatTime(remainingMs);
  }

  if (displayStatus === "ACTIVE") {
    if (opTimer) opTimer.textContent = formatTime(remainingMs);
    if (restTimer) restTimer.textContent = formatTime(REST_DURATION);
    if (fullTimer) fullTimer.textContent = formatTime(remainingMs + REST_DURATION);
    if (opCard) opCard.classList.add("active");
    if (restCard) restCard.classList.remove("resting");
    if (statusPill) {
      statusPill.className = "status-pill operating";
      if (statusText) statusText.textContent = "OPERATING";
    }
  } else if (displayStatus === "COOL") {
    if (opTimer) opTimer.textContent = formatTime(0);
    if (restTimer) restTimer.textContent = formatTime(remainingMs);
    if (fullTimer) fullTimer.textContent = formatTime(remainingMs);
    if (opCard) opCard.classList.remove("active");
    if (restCard) restCard.classList.add("resting");
    if (statusPill) {
      statusPill.className = "status-pill resting";
      if (statusText) statusText.textContent = "RESTING";
    }
  } else {
    if (opTimer) opTimer.textContent = "--:--";
    if (restTimer) restTimer.textContent = "--:--";
    if (fullTimer) fullTimer.textContent = "--:--";
    if (statusPill) {
      statusPill.className = "status-pill standby";
      if (statusText) statusText.textContent = "STANDBY";
    }
  }
}

function formatTime(milliseconds) {
  if (milliseconds === undefined || milliseconds === null || isNaN(milliseconds) || milliseconds < 0) return "--:--";
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function setSystemStatus(status) {
  const pill = $("systemStatusPill");
  const text = $("systemStatusText");
  if (!pill || !text) return;
  let displayStatus = status;
  if (status === "COOL") displayStatus = "RESTING";
  else if (status === "ACTIVE") displayStatus = "OPERATING";
  text.textContent = displayStatus;
  pill.classList.remove("standby", "operating", "resting");
  if (status === "ACTIVE") pill.classList.add("operating");
  else if (status === "COOL") pill.classList.add("resting");
  else pill.classList.add("standby");
}

// ===== DASHBOARD UPDATE =====
function updateDashboard(rawData, readingSource = "Firebase") {
  const data = normalizeSensorData(rawData);
  if (!data) {
    setSystemStatus("STANDBY");
    return false;
  }
  
  updateCycleUI(data);
  updateCards(data);
  updateDiagnostics(data);
  updateRelayUI(data);
  updateLedDisplay(data);
  
  Object.keys(sensorDetails).forEach(sensorName => {
    let value = data[sensorName];
    if (sensorName === "waterLevel") value = data.waterLevelCm;
    addHistory(sensorName, value);
  });
  addRecordLog(data, readingSource);
  saveHistory();
  updateCharts();
  updateDetailedChart();

  let anyAlert = false;
  Object.keys(sensorDetails).forEach(sensorName => {
    let value = data[sensorName];
    if (sensorName === "waterLevel") value = data.waterLevelCm;
    if (sensorName === "co2") value = data.co2Percent;
    const result = evaluateThreshold(sensorName, value);
    if (result.level === 'critical') anyAlert = true;
  });
  const banner = $('alertBanner');
  if (banner) {
    banner.style.display = anyAlert ? 'block' : 'none';
  }
  return true;
}

// ===== HISTORY & RECORD LOG =====
function saveHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function saveRecordLog() {
  localStorage.setItem(RECORD_LOG_STORAGE_KEY, JSON.stringify(recordLog));
}

function addHistory(sensorName, value) {
  if (value === undefined || value === null || isNaN(Number(value))) return;
  history[sensorName].push(Number(value));
  if (history[sensorName].length > MAX_POINTS) history[sensorName].shift();
}

function addRecordLog(data, readingSource = "Firebase") {
  const now = new Date();
  recordLog.push({
    timestampISO: data.timestampISO || now.toISOString(),
    timestampLocal: now.toLocaleString(),
    readingSource: data.readingSource || readingSource,
    ph: data.ph,
    temperature: data.temperature,
    dissolvedOxygen: data.dissolvedOxygen,
    doMgL: data.doMgL,
    co2: data.co2,
    co2Percent: data.co2Percent,
    waterLevel: data.waterLevel,
    waterLevelCm: data.waterLevelCm,
    phStatus: data.phStatus,
    temperatureStatus: data.temperatureStatus,
    doStatus: data.doStatus,
    co2Status: data.co2Status,
    waterStatus: data.waterStatus,
    cycleStatus: data.cycleStatus
  });
  if (recordLog.length > MAX_RECORD_LOG) recordLog.shift();
  saveRecordLog();
}

// ===== CSV EXPORT =====
function escapeCsv(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map(row => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportAllRecordsToCSV() {
  if (!recordLog.length) {
    alert("No records available to export yet.");
    return;
  }
  const rows = [[
    "Timestamp ISO", "Timestamp Local", "Reading Source", "pH", "pH Status", "Temperature C", "Temperature Status",
    "DO % Saturation", "DO Status", "DO mg/L", "CO2 ppm", "CO2 % v/v", "CO2 Status", "Water Level %", "Water Level cm", "Water Status", "Cycle Status"
  ]];
  recordLog.forEach(record => {
    rows.push([
      record.timestampISO, record.timestampLocal, record.readingSource, record.ph, record.phStatus,
      record.temperature, record.temperatureStatus, record.dissolvedOxygen, record.doStatus, record.doMgL,
      record.co2, record.co2Percent, record.co2Status, record.waterLevel, record.waterLevelCm, record.waterStatus, record.cycleStatus
    ]);
  });
  downloadCsv("pbr_all_sensor_records.csv", rows);
}

function exportRecordsUpToYesterdayToCSV() {
  if (!recordLog.length) {
    alert("No records available to export yet.");
    return;
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const completedRecords = recordLog.filter(record => new Date(record.timestampISO) < startOfToday);
  if (!completedRecords.length) {
    alert("No completed records up to yesterday are available yet.");
    return;
  }
  const originalRecordLog = recordLog;
  recordLog = completedRecords;
  exportAllRecordsToCSV();
  recordLog = originalRecordLog;
}

function exportSelectedSensorToCSV() {
  if (!recordLog.length) {
    alert("No records available to export yet.");
    return;
  }
  const detail = sensorDetails[selectedDetailedSensor];
  const rows = [["Timestamp ISO", "Timestamp Local", "Reading Source", "Sensor", "Value", "Unit"]];
  recordLog.forEach(record => {
    let value = record[selectedDetailedSensor];
    if (selectedDetailedSensor === "waterLevel") value = record.waterLevelCm;
    rows.push([record.timestampISO, record.timestampLocal, record.readingSource, detail.name, value, detail.unit]);
  });
  downloadCsv(`pbr_${selectedDetailedSensor}_records.csv`, rows);
}

function clearPastRecords() {
  if (!confirm("Clear all saved past records and chart history?")) return;
  recordLog = [];
  history = { ph: [], temperature: [], dissolvedOxygen: [], co2: [], waterLevel: [] };
  saveRecordLog();
  saveHistory();
  updateCharts();
  updateDetailedChart();
  alert("Past records cleared.");
}

// ===== CHART DRAWING =====
function drawChart(svgId, values) {
  const svg = $(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  const width = 300;
  const height = 110;
  const padding = 18;
  for (let i = 0; i < 4; i++) {
    const y = padding + i * 25;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding);
    line.setAttribute("y1", y);
    line.setAttribute("x2", width - padding);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid-line");
    svg.appendChild(line);
  }
  if (!values || values.length === 0) return;
  if (values.length === 1) values = [values[0], values[0]];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const points = values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / (values.length - 1);
    const y = height - padding - ((value - minValue) / range) * (height - padding * 2);
    return { x, y, value };
  });
  const linePoints = points.map(point => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${padding},${height - padding} ${linePoints} ${width - padding},${height - padding}`;
  const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  area.setAttribute("points", areaPoints);
  area.setAttribute("class", "chart-area");
  svg.appendChild(area);
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", linePoints);
  polyline.setAttribute("class", "chart-line");
  svg.appendChild(polyline);
  points.forEach(point => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", 4);
    circle.setAttribute("class", "chart-dot");
    svg.appendChild(circle);
  });
}

function updateCharts() {
  Object.keys(sensorDetails).forEach(sensorName => drawChart(sensorDetails[sensorName].chartId, history[sensorName]));
}

function formatSensorValue(sensorName, value) {
  const detail = sensorDetails[sensorName];
  if (value === undefined || value === null || isNaN(value)) return "--";
  return Number(value).toFixed(detail.decimals);
}

function drawLargeChart(svgId, values, sensorName) {
  const svg = $(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  const width = 900;
  const height = 320;
  const paddingLeft = 58;
  const paddingRight = 32;
  const paddingTop = 32;
  const paddingBottom = 48;
  for (let i = 0; i <= 5; i++) {
    const y = paddingTop + i * ((height - paddingTop - paddingBottom) / 5);
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
    grid.setAttribute("x1", paddingLeft);
    grid.setAttribute("y1", y);
    grid.setAttribute("x2", width - paddingRight);
    grid.setAttribute("y2", y);
    grid.setAttribute("class", "large-chart-grid");
    svg.appendChild(grid);
  }
  if (!values || values.length === 0) {
    const empty = document.createElementNS("http://www.w3.org/2000/svg", "text");
    empty.setAttribute("x", width / 2);
    empty.setAttribute("y", height / 2);
    empty.setAttribute("text-anchor", "middle");
    empty.setAttribute("class", "large-chart-text");
    empty.textContent = "No recorded values yet";
    svg.appendChild(empty);
    return;
  }
  if (values.length === 1) values = [values[0], values[0]];
  const detail = sensorDetails[sensorName];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const points = values.map((value, index) => {
    const x = paddingLeft + (index * (width - paddingLeft - paddingRight)) / (values.length - 1);
    const y = height - paddingBottom - ((value - minValue) / range) * (height - paddingTop - paddingBottom);
    return { x, y, value, index };
  });
  const linePoints = points.map(point => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${paddingLeft},${height - paddingBottom} ${linePoints} ${width - paddingRight},${height - paddingBottom}`;
  const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  area.setAttribute("points", areaPoints);
  area.setAttribute("class", "large-chart-area");
  svg.appendChild(area);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", linePoints);
  line.setAttribute("class", "large-chart-line");
  svg.appendChild(line);
  points.forEach((point, index) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", index === points.length - 1 ? 8 : 5);
    circle.setAttribute("class", index === points.length - 1 ? "large-chart-current-dot" : "large-chart-dot");
    svg.appendChild(circle);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", point.x);
    label.setAttribute("y", point.y - 12);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "large-chart-text");
    label.textContent = Number(point.value).toFixed(detail.decimals);
    svg.appendChild(label);
  });
  const minLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  minLabel.setAttribute("x", paddingLeft);
  minLabel.setAttribute("y", height - 12);
  minLabel.setAttribute("class", "large-chart-label");
  minLabel.textContent = `Min: ${minValue.toFixed(detail.decimals)} ${detail.unit}`;
  svg.appendChild(minLabel);
  const maxLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  maxLabel.setAttribute("x", width - paddingRight);
  maxLabel.setAttribute("y", 22);
  maxLabel.setAttribute("text-anchor", "end");
  maxLabel.setAttribute("class", "large-chart-label");
  maxLabel.textContent = `Max: ${maxValue.toFixed(detail.decimals)} ${detail.unit}`;
  svg.appendChild(maxLabel);
}

function updateDetailedChart() {
  const sensorName = selectedDetailedSensor;
  const detail = sensorDetails[sensorName];
  const values = history[sensorName] || [];
  const currentValue = values.length ? values[values.length - 1] : null;
  const minValue = values.length ? Math.min(...values) : null;
  const maxValue = values.length ? Math.max(...values) : null;
  const averageValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  $("detailSensorName").textContent = detail.name;
  $("detailCurrentValue").textContent = currentValue === null ? "--" : formatSensorValue(sensorName, currentValue);
  $("detailCurrentUnit").textContent = detail.unit;
  $("detailStatCurrent").textContent = currentValue === null ? "--" : `${formatSensorValue(sensorName, currentValue)} ${detail.unit}`;
  $("detailStatMin").textContent = minValue === null ? "--" : `${formatSensorValue(sensorName, minValue)} ${detail.unit}`;
  $("detailStatMax").textContent = maxValue === null ? "--" : `${formatSensorValue(sensorName, maxValue)} ${detail.unit}`;
  $("detailStatAverage").textContent = averageValue === null ? "--" : `${formatSensorValue(sensorName, averageValue)} ${detail.unit}`;
  $("detailStatRecords").textContent = values.length;
  const historyValues = $("detailHistoryValues");
  if (!values.length) historyValues.textContent = "No records yet";
  else {
    historyValues.innerHTML = values.map((value, index) => {
      const label = index === values.length - 1 ? "Current" : `#${index + 1}`;
      return `<span class="history-chip">${label}: ${formatSensorValue(sensorName, value)} ${detail.unit}</span>`;
    }).join("");
  }
  drawLargeChart("largeDetailChart", values, sensorName);
}

// ===== FIREBASE SYNC =====
function recordFirebaseReading(firebaseData, sourceLabel = "Firebase Latest") {
  const fingerprint = getFirebaseReadingFingerprint(firebaseData);
  if (!fingerprint) return false;
  if (fingerprint === lastRecordedFirebaseFingerprint) {
    const data = normalizeSensorData(firebaseData);
    if (data) {
      updateCards(data);
      updateDiagnostics(data);
      updateRelayUI(data);
      updateLedDisplay(data);
      updateCycleUI(data);
    }
    return false;
  }
  lastRecordedFirebaseFingerprint = fingerprint;
  return updateDashboard(firebaseData, sourceLabel);
}

async function testFirebaseConnection() {
  setConnectionStatus("Testing Firebase connection...", "warning");
  try {
    const latest = await firebaseGet("/pbr/latest");
    if (latest) {
      setConnectionStatus("Connected to Firebase. Latest reading found.", "ok");
      recordFirebaseReading(latest, latest.readingSource || "Firebase Latest");
    } else {
      setConnectionStatus("Connected, but /pbr/latest is empty. Upload one ESP32 reading first.", "warning");
    }
  } catch (error) {
    console.error(error);
    setConnectionStatus("Firebase test failed: " + error.message, "error");
  }
}

async function syncFirebaseLatest() {
  if (!firebaseDatabaseUrl) return null;
  try {
    const latest = await firebaseGet("/pbr/latest");
    if (!latest) {
      setConnectionStatus("Firebase connected, but no latest reading yet.", "warning");
      return null;
    }
    const recorded = recordFirebaseReading(latest, latest.readingSource || "Firebase Latest");
    setConnectionStatus(recorded ? "New Firebase reading recorded." : "Firebase latest reading already displayed.", "ok");
    return latest;
  } catch (error) {
    console.error(error);
    setConnectionStatus("Firebase latest read failed: " + error.message, "error");
    return null;
  }
}

async function sendFirebaseCommand(commandName, sourceLabel) {
  return await firebasePut("/pbr/commands/" + commandName, {
    requested: true,
    requestedAt: new Date().toISOString(),
    source: sourceLabel,
    nonce: Date.now()
  });
}

async function waitForNewFirebaseReading(previousFingerprint, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const latest = await firebaseGet("/pbr/latest");
    const nextFingerprint = getFirebaseReadingFingerprint(latest);
    if (latest && nextFingerprint && nextFingerprint !== previousFingerprint) return latest;
  }
  return null;
}

async function collectSensorReading() {
  await syncFirebaseLatest();
}

async function forceSensorReading() {
  const button = $("forceReadingButton");
  const badge = $("cycleStatusBadge");
  const operationTimerCard = $("operationTimerCard");
  const restTimerCard = $("restTimerCard");
  if (button) {
    button.disabled = true;
    button.textContent = "Requesting...";
  }
  setSystemStatus("OPERATING");
  setConnectionStatus("Manual reading command sent to Firebase...", "warning");
  if (badge) {
    badge.textContent = "MANUAL READING";
    badge.classList.remove("resting");
  }
  if (operationTimerCard && restTimerCard) {
    operationTimerCard.classList.add("active");
    restTimerCard.classList.remove("resting");
  }
  try {
    const previousLatest = await firebaseGet("/pbr/latest").catch(() => null);
    const previousFingerprint = getFirebaseReadingFingerprint(previousLatest);
    await sendFirebaseCommand("manualReading", "manual-override");
    if (button) button.textContent = "Waiting...";
    const latest = await waitForNewFirebaseReading(previousFingerprint, 20000);
    if (!latest) {
      if (button) button.textContent = "No New Data";
      setConnectionStatus("Manual command sent, but no new Firebase reading arrived yet.", "warning");
      return;
    }
    const recorded = recordFirebaseReading(latest, "Manual Override");
    if (button) button.textContent = recorded ? "Recorded" : "Already Updated";
    setConnectionStatus(recorded ? "Manual sensor reading recorded from Firebase." : "Manual command completed; latest reading already displayed.", "ok");
  } catch (error) {
    console.error(error);
    if (button) button.textContent = "Request Failed";
    setConnectionStatus("Manual reading failed: " + error.message, "error");
  } finally {
    if (button) {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Manual Sensor Reading";
      }, 1500);
    }
  }
}

// ===== TABS & CHART SELECTOR =====
function showPageTab(tabId, button) {
  document.querySelectorAll(".page-section").forEach(section => section.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  $(tabId).classList.add("active");
  if (button.classList.contains("tab-btn")) button.classList.add("active");
  if (tabId === "chartsTab") updateDetailedChart();
}

function selectDetailedSensor(sensorName, button) {
  selectedDetailedSensor = sensorName;
  document.querySelectorAll(".chart-select-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  updateDetailedChart();
}

// ===== SETTINGS MODAL TOGGLE =====
function toggleSettingsBox(forceOpen) {
  const modal = $("settingsModal");
  if (!modal) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !modal.classList.contains("active");
  modal.classList.toggle("active", shouldOpen);
  modal.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
}

// ===== EVENT LISTENERS =====
document.addEventListener("keydown", event => {
  if (event.key === "Escape") toggleSettingsBox(false);
});

document.addEventListener("click", event => {
  const modal = $("settingsModal");
  if (!modal || !modal.classList.contains("active")) return;
  if (event.target === modal) toggleSettingsBox(false);
});

document.querySelectorAll(".info-link-card").forEach(link => {
  link.addEventListener("click", event => {
    if (link.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      alert("No link has been set yet. Open Settings and paste the URL first.");
    }
  });
});

[
  "titleInput",
  "subtitleInput",
  "accentInput",
  "pageBgInput",
  "cardBgInput",
  "textColorInput",
  "cardOpacityInput",
  "valueSizeInput",
  "columnsInput",
  "wiringManualUrlInput",
  "calibrationProceduresUrlInput",
  "troubleshootingInstructionsUrlInput"
].forEach(id => $(id).addEventListener("input", saveUiSettings));

const ledParTargetRange = $("ledParTargetRange");
if (ledParTargetRange) {
  ledParTargetRange.addEventListener("input", event => {
    ledSettings.targetPAR = clampLedPAR(event.target.value);
    saveLedLightingSettings();
    updateLedLightingUI();
  });
  ledParTargetRange.addEventListener("change", event => setLedTargetPAR(event.target.value, true));
}

// ===== REAL-TIME LISTENERS (Firebase SDK) =====
db.ref(SETTINGS_FIREBASE_PATH).on('value', (snapshot) => {
  const remoteSettings = snapshot.val();
  if (remoteSettings && Object.keys(remoteSettings).length) {
    const currentStr = JSON.stringify(uiSettings);
    const remoteStr = JSON.stringify(remoteSettings);
    if (currentStr !== remoteStr) {
      uiSettings = { ...defaultSettings, ...remoteSettings };
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiSettings));
      applyUiSettings();
      console.log("Settings updated from Firebase.");
    }
  }
});

db.ref(RECIPIENTS_FIREBASE_PATH).on('value', (snapshot) => {
  const data = snapshot.val();
  if (data && Array.isArray(data)) {
    alertRecipients = data;
    renderRecipients();
  }
});

// ===== TICKING TIMER =====
function startTickingTimer() {
  if (cycleTimerInterval) clearInterval(cycleTimerInterval);
  cycleTimerInterval = setInterval(() => {
    let now = Date.now();
    if (lastFirebaseUpdate && (now - lastFirebaseUpdate) < 10000) {
      updateCycleUI({});
    } else {
      updateCycleUI(null);
    }
  }, TIMER_TICK_INTERVAL);
}

// ===== INIT =====
baseTimestamp = Date.now();
localCycleStatus = "ACTIVE";
baseRemaining = OPERATION_DURATION;

applyBackgroundImage();
applyUiSettings();
updateCharts();
updateDetailedChart();
updateLedLightingUI();
setConnectionStatus("Connected to Firebase: " + FIREBASE_DATABASE_URL, "ok");

startTickingTimer();

setInterval(syncFirebaseLatest, 5000);
syncFirebaseLatest();

loadSettingsFromFirebase();
loadRecipientsFromFirebase();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLoginModal();
});

console.log("PBR Nannochloropsis Dashboard initialized.");
console.log("Admin login enabled.");