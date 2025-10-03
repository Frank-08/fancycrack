// UI wiring and worker orchestration for FancyCrack

const elements = {
  mode: document.getElementById('mode'),
  algorithm: document.getElementById('algorithm'),
  targetHash: document.getElementById('targetHash'),
  wordlist: document.getElementById('wordlist'),
  charset: document.getElementById('charset'),
  minLength: document.getElementById('minLength'),
  maxLength: document.getElementById('maxLength'),
  startBtn: document.getElementById('startBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  demoBtn: document.getElementById('demoBtn'),
  progressText: document.getElementById('progressText'),
  throughputText: document.getElementById('throughputText'),
  triedText: document.getElementById('triedText'),
  elapsedText: document.getElementById('elapsedText'),
  progressBar: document.getElementById('progressBar'),
  resultBox: document.getElementById('resultBox'),
  speedRange: document.getElementById('speedRange'),
  delayLabel: document.getElementById('delayLabel'),
  recentList: document.getElementById('recentList'),
  terminalLog: document.getElementById('terminalLog'),
  overlay: document.getElementById('overlay'),
  overlayLog: document.getElementById('overlayLog'),
  overlayClose: document.getElementById('overlayClose'),
  hashPlain: document.getElementById('hashPlain'),
  hashBtn: document.getElementById('hashBtn'),
  hashOutput: document.getElementById('hashOutput'),
};

const sections = {
  dictionaryOnly: document.querySelectorAll('.dictionary-only'),
  bruteforceOnly: document.querySelectorAll('.bruteforce-only'),
};

let worker = null;
let startTime = 0;
let totalCandidatesPlanned = 0;
let currentDelayMs = 0;

function setModeUI(mode) {
  const showDict = mode === 'dictionary';
  sections.dictionaryOnly.forEach(el => el.classList.toggle('hidden', !showDict));
  sections.bruteforceOnly.forEach(el => el.classList.toggle('hidden', showDict));
}

elements.mode.addEventListener('change', () => setModeUI(elements.mode.value));
setModeUI(elements.mode.value);

elements.demoBtn.addEventListener('click', () => {
  // Demo: hash of "password" using SHA-256
  elements.algorithm.value = 'SHA-256';
  elements.targetHash.value = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
  elements.mode.value = 'dictionary';
  setModeUI('dictionary');
  elements.resultBox.textContent = '—';
  setDelay(10);
  clearTerminal();
  printTerminal('> demo: loaded SHA-256(password)');
});

elements.startBtn.addEventListener('click', async () => {
  const mode = elements.mode.value;
  const algorithm = elements.algorithm.value;
  const targetHash = (elements.targetHash.value || '').trim().toLowerCase();

  if (!targetHash) {
    notify('Please provide a target hash.');
    return;
  }

  if (worker) {
    worker.terminate();
    worker = null;
  }
  worker = new Worker('./worker.js');
  wireWorker(worker);
  if (currentDelayMs > 0) {
    worker.postMessage({ type: 'set-delay', payload: { delayMs: currentDelayMs } });
  }

  elements.resultBox.textContent = 'Working…';
  resetProgress();
  startTime = performance.now();
  clearTerminal();
  printTerminal('> starting cracking session...');
  showOverlay();

  if (mode === 'dictionary') {
    const file = elements.wordlist.files && elements.wordlist.files[0];
    if (!file) {
      notify('Please select a wordlist file (.txt).');
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    totalCandidatesPlanned = lines.length;
    printTerminal(`> mode: dictionary, alg: ${algorithm}, candidates: ${lines.length.toLocaleString()}`);
    worker.postMessage({ type: 'start-dictionary', payload: { algorithm, targetHash, candidates: lines } });
  } else {
    const charset = (elements.charset.value || 'abcdefghijklmnopqrstuvwxyz0123456789');
    let minLength = Math.max(1, Math.min(7, parseInt(elements.minLength?.value || '1', 10)));
    let maxLength = Math.max(1, Math.min(7, parseInt(elements.maxLength.value || '5', 10)));
    if (minLength > maxLength) {
      const t = minLength; minLength = maxLength; maxLength = t;
    }
    totalCandidatesPlanned = estimateTotalRange(charset.length, minLength, maxLength);
    printTerminal(`> mode: bruteforce, alg: ${algorithm}, charset: ${charset.length} chars, len: ${minLength}-${maxLength}`);
    worker.postMessage({ type: 'start-bruteforce', payload: { algorithm, targetHash, charset, minLength, maxLength } });
  }
});

elements.cancelBtn.addEventListener('click', () => {
  if (worker) {
    worker.postMessage({ type: 'cancel' });
    worker.terminate();
    worker = null;
    finalize('Cancelled');
    printTerminal('> session cancelled.');
  }
});

// Hash Tool: compute hex digest of input using selected algorithm
elements.hashBtn?.addEventListener('click', async () => {
  const algorithm = elements.algorithm.value;
  const plaintext = (elements.hashPlain?.value || '').toString();
  if (!plaintext) {
    notify('Enter plaintext to hash.');
    return;
  }
  try {
    const hex = await digestStringHex(algorithm, plaintext);
    if (elements.hashOutput) elements.hashOutput.textContent = hex;
  } catch (e) {
    if (elements.hashOutput) elements.hashOutput.textContent = 'Error computing hash';
    notify('Error computing hash; try a different algorithm.');
  }
});

function wireWorker(w) {
  w.onmessage = (event) => {
    const { type, payload } = event.data || {};
    if (type === 'progress') {
      const { tried, batchPerSecond, recent } = payload;
      updateProgress(tried, batchPerSecond);
      if (recent && Array.isArray(recent)) setTerminalFromRecent(recent);
    } else if (type === 'attempt') {
      if (payload && payload.candidate != null) {
        printTerminal(`> trying: ${payload.candidate}`);
        printOverlay(`> trying: ${payload.candidate}`);
      }
    } else if (type === 'result') {
      const { found, plaintext, tried } = payload;
      if (found) {
        finalize(`FOUND: ${plaintext}`);
        printTerminal(`> FOUND -> ${plaintext}`);
        printOverlay(`> FOUND -> ${plaintext}`);
      } else {
        finalize('Not found');
        printTerminal('> not found in search space.');
        printOverlay('> not found in search space.');
      }
      updateProgress(tried, 0);
      if (worker) {
        worker.terminate();
        worker = null;
      }
    } else if (type === 'error') {
      finalize(`Error: ${payload.message || 'Unknown error'}`);
      printTerminal(`! error: ${payload.message || 'unknown error'}`);
      printOverlay(`! error: ${payload.message || 'unknown error'}`);
    }
  };
}

function estimateTotalRange(charsetLen, minLen, maxLen) {
  let total = 0;
  for (let len = minLen; len <= maxLen; len++) {
    total += Math.pow(charsetLen, len);
  }
  return total;
}

function resetProgress() {
  elements.progressBar.value = 0;
  elements.progressText.textContent = '0%';
  elements.triedText.textContent = '0';
  elements.elapsedText.textContent = '0.0s';
  elements.throughputText.textContent = '0 c/s';
  if (elements.recentList) elements.recentList.innerHTML = '';
  clearTerminal();
  clearOverlay();
}

function updateProgress(tried, cps) {
  const pct = totalCandidatesPlanned > 0 ? Math.min(100, (tried / totalCandidatesPlanned) * 100) : 0;
  elements.progressBar.value = Math.floor(pct);
  elements.progressText.textContent = `${pct.toFixed(1)}%`;
  elements.triedText.textContent = `${tried.toLocaleString()}`;
  const elapsedMs = performance.now() - startTime;
  elements.elapsedText.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
  if (cps && Number.isFinite(cps)) {
    elements.throughputText.textContent = `${Math.round(cps).toLocaleString()} c/s`;
  }
}

function finalize(text) {
  elements.resultBox.textContent = text;
}

function notify(message) {
  // lightweight toast using DaisyUI
  const toast = document.createElement('div');
  toast.className = 'toast toast-top toast-end';
  const alert = document.createElement('div');
  alert.className = 'alert alert-info shadow';
  alert.innerHTML = `<span>${escapeHtml(message)}</span>`;
  toast.appendChild(alert);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str) {
  return str.replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Speed control
function setDelay(ms) {
  currentDelayMs = Math.max(0, Math.min(1000, Number(ms) || 0));
  if (elements.delayLabel) elements.delayLabel.textContent = String(currentDelayMs);
  if (worker) {
    worker.postMessage({ type: 'set-delay', payload: { delayMs: currentDelayMs } });
  }
}

if (elements.speedRange) {
  elements.speedRange.addEventListener('input', (e) => setDelay(e.target.value));
}

// Terminal rendering (classic look)
function clearTerminal() {
  if (elements.terminalLog) elements.terminalLog.textContent = '';
}

function printTerminal(line) {
  if (!elements.terminalLog) return;
  elements.terminalLog.textContent += `${line}\n`;
  const scroller = elements.terminalLog.parentElement;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function setTerminalFromRecent(recentArray) {
  if (!elements.terminalLog) return;
  const lines = recentArray.map(s => `> trying: ${s}`);
  elements.terminalLog.textContent = lines.join('\n') + (lines.length ? '\n' : '');
  const scroller = elements.terminalLog.parentElement;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

// Local hashing using WebCrypto
async function digestStringHex(algorithm, input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest(algorithm, data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex.toLowerCase();
}

// Full-screen overlay terminal
function showOverlay() {
  if (elements.overlay) elements.overlay.classList.remove('hidden');
}

function hideOverlay() {
  if (elements.overlay) elements.overlay.classList.add('hidden');
}

elements.overlayClose?.addEventListener('click', hideOverlay);

function clearOverlay() {
  if (elements.overlayLog) elements.overlayLog.textContent = '';
}

function printOverlay(line) {
  if (!elements.overlayLog) return;
  elements.overlayLog.textContent += `${line}\n`;
  const scroller = elements.overlayLog.parentElement;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

// Recent tries UI (legacy list, unused when terminal is present)
function updateRecent(recentArray) {
  // Show newest first
  const items = recentArray.slice().reverse().map(s => `<li class="p-2 whitespace-pre-wrap"><span class=\"opacity-70\">${escapeHtml(s)}</span></li>`).join('');
  if (elements.recentList) elements.recentList.innerHTML = items;
}


