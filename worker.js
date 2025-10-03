// Web Worker: performs hashing and candidate generation without blocking UI

let cancelRequested = false;
let delayPerAttemptMs = 0; // throttle
let recentRing = [];
const RECENT_LIMIT = 50;

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};
  try {
    if (type === 'cancel') {
      cancelRequested = true;
      return;
    }
    if (type === 'set-delay') {
      delayPerAttemptMs = Math.max(0, Math.min(1000, Number(payload?.delayMs) || 0));
      return;
    }
    cancelRequested = false;
    if (type === 'start-dictionary') {
      const { algorithm, targetHash, candidates } = payload;
      await runDictionary(algorithm, targetHash, candidates);
    } else if (type === 'start-bruteforce') {
      const { algorithm, targetHash, charset, minLength, maxLength } = payload;
      await runBruteforce(algorithm, targetHash, charset, minLength || 1, maxLength);
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: { message: (err && err.message) || String(err) } });
  }
};

async function runDictionary(algorithm, targetHex, candidates) {
  let tried = 0;
  const batchSize = 100;
  let lastReport = performance.now();
  let lastTried = 0;
  recentRing = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (cancelRequested) return;
    const candidate = candidates[i];
    const digestHex = await digestStringHex(algorithm, candidate);
    tried++;
    trackRecent(candidate);
    self.postMessage({ type: 'attempt', payload: { candidate, tried } });
    if (delayPerAttemptMs > 0) await delay(delayPerAttemptMs);
    if (digestHex === targetHex) {
      self.postMessage({ type: 'result', payload: { found: true, plaintext: candidate, tried } });
      return;
    }
    if (tried % batchSize === 0) {
      const now = performance.now();
      const dt = (now - lastReport) / 1000;
      const cps = dt > 0 ? (tried - lastTried) / dt : 0;
      lastReport = now;
      lastTried = tried;
      self.postMessage({ type: 'progress', payload: { tried, batchPerSecond: cps, recent: recentRing.slice(-RECENT_LIMIT) } });
      await yieldToEventLoop();
    }
  }
  self.postMessage({ type: 'result', payload: { found: false, plaintext: null, tried } });
}

async function runBruteforce(algorithm, targetHex, charset, minLength, maxLength) {
  const characters = Array.from(new Set(charset.split('')));
  let tried = 0;
  const batchSize = 1000;
  let lastReport = performance.now();
  let lastTried = 0;
  recentRing = [];

  const startLen = Math.max(1, minLength || 1);
  for (let length = startLen; length <= maxLength; length++) {
    const indices = new Array(length).fill(0);
    while (true) {
      if (cancelRequested) return;
      const candidate = indices.map(i => characters[i]).join('');
      const digestHex = await digestStringHex(algorithm, candidate);
      tried++;
      trackRecent(candidate);
      self.postMessage({ type: 'attempt', payload: { candidate, tried } });
      if (delayPerAttemptMs > 0) await delay(delayPerAttemptMs);
      if (digestHex === targetHex) {
        self.postMessage({ type: 'result', payload: { found: true, plaintext: candidate, tried } });
        return;
      }

      if (tried % batchSize === 0) {
        const now = performance.now();
        const dt = (now - lastReport) / 1000;
        const cps = dt > 0 ? (tried - lastTried) / dt : 0;
        lastReport = now;
        lastTried = tried;
        self.postMessage({ type: 'progress', payload: { tried, batchPerSecond: cps, recent: recentRing.slice(-RECENT_LIMIT) } });
        await yieldToEventLoop();
      }

      // increment indices like a number in base N
      let pos = length - 1;
      while (pos >= 0) {
        indices[pos]++;
        if (indices[pos] < characters.length) break;
        indices[pos] = 0;
        pos--;
      }
      if (pos < 0) break; // exhausted this length
    }
  }

  self.postMessage({ type: 'result', payload: { found: false, plaintext: null, tried } });
}

async function digestStringHex(algorithm, input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  // WebCrypto supports SHA-1/256/384/512. MD5 is not supported.
  const algo = algorithm;
  const digest = await crypto.subtle.digest(algo, data);
  return bufferToHex(digest).toLowerCase();
}

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i].toString(16).padStart(2, '0');
    hex += b;
  }
  return hex;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve));
}

function trackRecent(candidate) {
  recentRing.push(candidate);
  if (recentRing.length > RECENT_LIMIT) recentRing.splice(0, recentRing.length - RECENT_LIMIT);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


