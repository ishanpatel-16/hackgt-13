// Sends the report with fetch() so the page doesn't reload, then polls
// /status until the node hears the gateway's ACK ("Delivered").
const form = document.getElementById("report");
const message = document.getElementById("message");
const count = document.getElementById("count");
const button = document.getElementById("send");
const result = document.getElementById("result");

// ---------- user ID ----------
// Kept in localStorage + a cookie so it stays the same while the page is open.
// The Wi-Fi sign-in popup wipes these when it reopens, so we also ask the node:
// it remembers this phone (by Wi-Fi MAC) and hands back the same ID on reconnect.
const userIdLabel = document.getElementById("user-id");
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
  userIdLabel.textContent = id;
}

async function syncUserId() {
  try {
    const res = await fetch(`/whoami?id=${userId}`);
    const data = await res.json();
    saveId(data.user_id);
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
const gpsLabel = document.getElementById("gps");
const locationInput = document.getElementById("location");
let fix = null;

const ua = navigator.userAgent;
const isIphone = /iPhone|iPad|iPod/.test(ua);
// iPhone popup has no "Safari/" in its user agent; Android's popup is a WebView ("; wv)").
const inSignInPopup = (isIphone && !/Safari\//.test(ua)) || /; wv\)/.test(ua);

function showOpenBrowserHelp() {
  const steps = isIphone
    ? "tap Cancel (top right) \u2192 \"Use Without Internet\", then open Safari"
    : "close this window (stay connected), then open Chrome";
  gpsLabel.className = "gps";
  gpsLabel.textContent =
    `\u{1F4CD} GPS doesn't work in this sign-in window. To add it: ${steps} and go to ` +
    `https://192.168.4.1 (tap "Show details" \u2192 "visit this website" if warned). ` +
    `You can still send your report here without GPS.`;
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
      locationInput.required = false;  // coordinates are enough; text is a bonus
    },
    (err) => {
      answered = true;
      if (!fix) gpsLabel.textContent = err.code === err.PERMISSION_DENIED
        ? (isIphone
            ? "Location blocked. Turn on Settings \u2192 Privacy \u2192 Location Services \u2192 Safari Websites, then reload. Or describe where you are."
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

// ---------- form ----------
message.addEventListener("input", () => {
  count.textContent = message.value.length;
});

function show(text, kind) {
  result.textContent = text;
  result.className = `result ${kind}`;
  result.hidden = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The node keeps resending until the gateway ACKs, even if this page closes.
async function waitForDelivery(msgId) {
  for (let i = 0; i < 60; i++) {  // poll for ~2 minutes
    await sleep(2000);
    try {
      const res = await fetch(`/status?id=${msgId}`);
      const data = await res.json();
      if (data.delivered) {
        show(`Delivered to responders (ID ${msgId}). Stay where you are if it is safe.`, "ok");
        return;
      }
      show(`Sent (ID ${msgId}). Waiting for confirmation... attempt ${data.attempts}`, "wait");
    } catch (e) {
      // lost Wi-Fi for a moment; keep trying
    }
  }
  show(`Not confirmed yet (ID ${msgId}). The node will keep retrying on its own.`, "wait");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  button.disabled = true;
  button.textContent = "Sending...";

  const body = new URLSearchParams(new FormData(form));
  body.set("id", userId);
  if (fix) {
    body.set("lat", fix.latitude);
    body.set("lon", fix.longitude);
    body.set("acc", Math.round(fix.accuracy));
  }

  try {
    const res = await fetch("/send", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Send failed");

    show(`Sent (ID ${data.msg_id})${data.gps ? " with GPS location" : ""}. Waiting for confirmation...`, "wait");
    saveId(data.user_id);
    form.reset();
    count.textContent = "0";
    waitForDelivery(data.msg_id);
  } catch (err) {
    show(`Could not send: ${err.message}. Try again.`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send report";
  }
});
