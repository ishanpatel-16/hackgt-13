// net0 SOS page (design from the initial user portal in user-end/node-esp).
// 1. Pick an emergency type + number of people, add location/details.
// 2. SEND posts to the node (/send); the node floods it and retries until the
//    gateway ACKs. We poll /status and flip the confirmation to "Delivered".
const $ = (id) => document.getElementById(id);

// Backend Category numbers (portal-end/backend/packets/serial_schema.py).
const CATEGORY = { medical: 1, trapped: 2, fire: 3, other: 8 };
const LABELS = { medical: "Medical", fire: "Fire", trapped: "Trapped", other: "Other" };

const state = { emergency: null, people: 1 };

// ---------- user ID ----------
// Kept in localStorage + a cookie so it stays the same while the page is open.
// The Wi-Fi sign-in popup wipes these when it reopens, so we also ask the node:
// it remembers this phone (by Wi-Fi MAC) and hands back the same ID on reconnect.
let userId = loadStoredId();

function loadStoredId() {
  // ?id= carries the ID over when switching from the http:// to the https:// page
  // (they are different sites to the browser, so they don't share storage).
  let id = new URLSearchParams(location.search).get("id");
  try { id = id || localStorage.getItem("net0_user_id"); } catch (e) {}
  if (!id) {
    const m = document.cookie.match(/(?:^|; )net0_user_id=(\d+)/);
    if (m) id = m[1];
  }
  id = parseInt(id, 10);
  return id >= 1 && id <= 65535 ? id : 0;
}

function saveId(id) {
  userId = id;
  try { localStorage.setItem("net0_user_id", id); } catch (e) {}
  document.cookie = `net0_user_id=${id}; max-age=31536000; path=/`;
  $("user-id").textContent = id;
}

async function syncUserId() {
  try {
    const res = await fetch(`/whoami?id=${userId}`);
    const data = await res.json();
    saveId(data.user_id);
    if (data.node) $("node-status").textContent = `Connected to local node ${data.node}`;
    return data;
  } catch (e) {
    // node unreachable: keep what we have, or make one up
    saveId(userId || 1 + Math.floor(Math.random() * 65535));
    return {};
  }
}

// ---------- GPS ----------
// Browsers only give location to secure (https://) pages. On the http:// page
// we show a link to the node's https:// page instead. Phone GPS works without
// internet, but the first fix can take a while (and may fail indoors).
//
// The phone's Wi-Fi sign-in popup can't ask for location permission at all
// (iPhone especially): the request just never answers. So we detect the popup
// and tell the user to switch to their real browser, and never wait forever.
const gpsLabel = $("gps");
let fix = null;

const ua = navigator.userAgent;
const isIphone = /iPhone|iPad|iPod/.test(ua);
// iPhone popup has no "Safari/" in its user agent; Android's popup is a WebView ("; wv)").
const inSignInPopup = (isIphone && !/Safari\//.test(ua)) || /; wv\)/.test(ua);

function showOpenBrowserHelp() {
  const steps = isIphone
    ? "tap Cancel (top right) → \"Use Without Internet\", then open Safari"
    : "close this window (stay connected), then open Chrome";
  gpsLabel.className = "gps";
  gpsLabel.textContent =
    `\u{1F4CD} GPS doesn't work in this sign-in window. To add it: ${steps} and go to ` +
    `https://192.168.4.1 (tap "Show details" → "visit this website" if warned). ` +
    `You can still send your SOS here without GPS.`;
}

function startGps() {
  if (!navigator.geolocation) {
    gpsLabel.textContent = "GPS not supported on this browser. Describe where you are.";
    return;
  }
  gpsLabel.textContent = "Getting GPS location... (allow location access)";
  let answered = false;
  navigator.geolocation.watchPosition(
    (pos) => {
      answered = true;
      fix = pos.coords;
      gpsLabel.textContent = `\u{1F4CD} GPS location found (within ${Math.round(fix.accuracy)} m)`;
      gpsLabel.className = "gps ok";
    },
    (err) => {
      answered = true;
      if (!fix) gpsLabel.textContent = err.code === err.PERMISSION_DENIED
        ? (isIphone
            ? "Location blocked. Turn on Settings → Privacy → Location Services → Safari Websites, then reload. Or describe where you are."
            : "Location blocked. Allow location for this site in the browser, then reload. Or describe where you are.")
        : "No GPS fix yet (try near a window). Describe where you are.";
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
  );
  // No permission prompt and no answer after 10 s: this browser can't do location.
  setTimeout(() => { if (!answered) showOpenBrowserHelp(); }, 10000);
}

syncUserId().then((info) => {
  if (inSignInPopup && info.https) {
    showOpenBrowserHelp();
  } else if (window.isSecureContext) {
    startGps();
  } else if (info.https) {
    gpsLabel.innerHTML = "";
    const link = document.createElement("a");
    link.href = `${info.https}?id=${userId}`;
    link.textContent = "\u{1F4CD} Share my GPS location (opens secure page)";
    gpsLabel.appendChild(link);
  } else {
    gpsLabel.textContent = "GPS not available on this node. Describe where you are.";
  }
});

// ---------- request screen ----------
const emergencyButtons = [...document.querySelectorAll(".emergency-option")];
const details = $("details");

function showError(text) {
  $("emergency-message").textContent = text;
  $("emergency-message").classList.toggle("visible", Boolean(text));
}

function selectEmergency(type) {
  state.emergency = type;
  emergencyButtons.forEach((button) => {
    const selected = button.dataset.emergency === type;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  // "Other" needs a description; for the rest details are a bonus.
  $("details-label").textContent = type === "other" ? "Describe the issue" : "Details (optional)";
  if (type === "other") details.focus();
  $("emergency-selection").classList.remove("invalid");
  showError("");
}

function changePeople(delta) {
  state.people = Math.min(255, Math.max(1, state.people + delta));
  $("people-count").textContent = String(state.people);
}

emergencyButtons.forEach((button) => {
  button.addEventListener("click", () => selectEmergency(button.dataset.emergency));
});
$("decrement-people").addEventListener("click", () => changePeople(-1));
$("increment-people").addEventListener("click", () => changePeople(1));
details.addEventListener("input", () => {
  $("details-count").textContent = details.value.length;
});

// ---------- sending ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pollingFor = null;  // msg_id we're currently waiting on

function setDeliveryStatus(text, delivered) {
  const note = $("delivery-status");
  note.textContent = text;
  note.className = delivered ? "status-note" : "status-note waiting";
  $("confirmation-mark").textContent = delivered ? "✓" : "…";
  $("confirmation-mark").className = delivered ? "confirmation-mark" : "confirmation-mark pending";
  $("confirmation-header").textContent = delivered ? "SOS DELIVERED" : "SOS SENT";
  $("confirmation-text").textContent = delivered
    ? "Responders have received your emergency request."
    : "Your request is on its way through the local emergency network.";
}

// The node keeps resending until the gateway ACKs, even if this page closes.
async function waitForDelivery(msgId) {
  pollingFor = msgId;
  for (let i = 0; i < 60 && pollingFor === msgId; i++) {  // poll for ~2 minutes
    await sleep(2000);
    try {
      const res = await fetch(`/status?id=${msgId}`);
      const data = await res.json();
      if (pollingFor !== msgId) return;
      if (data.delivered) {
        setDeliveryStatus("Delivered to responders.", true);
        return;
      }
      setDeliveryStatus(`Transmitting through the local emergency network... (attempt ${data.attempts})`, false);
    } catch (e) {
      // lost Wi-Fi for a moment; keep trying
    }
  }
  if (pollingFor === msgId)
    setDeliveryStatus("Not confirmed yet. The node will keep retrying on its own, even if you close this page.", false);
}

function showConfirmation(msgId, sentWithGps) {
  $("confirmation-emergency").textContent = LABELS[state.emergency];
  $("confirmation-people").textContent = String(state.people);

  const place = $("location").value.trim();
  const where = [place, sentWithGps ? "GPS location shared" : ""].filter(Boolean).join(" · ");
  $("confirmation-location-row").hidden = !where;
  $("confirmation-location").textContent = where;

  const text = details.value.trim();
  $("confirmation-issue-row").hidden = !text;
  $("confirmation-issue").textContent = text;

  $("report-id").textContent = msgId;
  setDeliveryStatus("Transmitting through the local emergency network...", false);
  $("request-screen").classList.remove("active");
  $("confirmation-screen").classList.add("active");
  window.scrollTo(0, 0);
}

async function sendSos() {
  if (!state.emergency) {
    $("emergency-selection").classList.add("invalid");
    showError("Please select an emergency type first.");
    return;
  }
  if (state.emergency === "other" && !details.value.trim()) {
    showError("Please describe the issue.");
    details.focus();
    return;
  }

  const button = $("send-sos");
  button.disabled = true;
  button.textContent = "SENDING...";

  const body = new URLSearchParams({
    id: userId,
    category: CATEGORY[state.emergency],
    people: state.people,
    location: $("location").value.trim(),
    message: details.value.trim(),
  });
  if (fix) {
    body.set("lat", fix.latitude);
    body.set("lon", fix.longitude);
    body.set("acc", Math.round(fix.accuracy));
  }

  try {
    const res = await fetch("/send", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Send failed");
    saveId(data.user_id);
    showConfirmation(data.msg_id, data.gps);
    waitForDelivery(data.msg_id);
  } catch (err) {
    showError(`Could not send: ${err.message}. Try again.`);
  } finally {
    button.disabled = false;
    button.textContent = "SEND EMERGENCY SOS";
  }
}

$("send-sos").addEventListener("click", sendSos);

// "Send an update": back to the form, keeping type/people/location so the user
// only has to add what changed. (Sent as a new report for now; a proper
// follow-up message will use the reserved user_reply packet type.)
$("send-update").addEventListener("click", () => {
  pollingFor = null;
  details.value = "";
  $("details-count").textContent = "0";
  $("confirmation-screen").classList.remove("active");
  $("request-screen").classList.add("active");
  window.scrollTo(0, 0);
});
