// app.js — Jarvis voice/chat frontend logic
// Talks only to your own n8n webhook (configured in config.js). No API keys live here.

(function () {
  const els = {
    orbWrap: document.getElementById('orbWrap'),
    orbBtn: document.getElementById('orbBtn'),
    micHint: document.getElementById('micHint'),
    micBtn: document.getElementById('micBtn'),
    sendBtn: document.getElementById('sendBtn'),
    textInput: document.getElementById('textInput'),
    log: document.getElementById('log'),
    emptyState: document.getElementById('emptyState'),
    statusLine: document.getElementById('statusLine'),
    statusText: document.getElementById('statusText'),
  };

  // ---- config sanity check ----
  const WEBHOOK_URL = (window.JARVIS_CONFIG && window.JARVIS_CONFIG.WEBHOOK_URL) || '';
  const SPEAK_REPLIES = !!(window.JARVIS_CONFIG && window.JARVIS_CONFIG.SPEAK_REPLIES);

  if (!WEBHOOK_URL) {
    setStatus('error', 'WEBHOOK_URL missing — edit config.js');
  } else {
    setStatus('connected', 'ready');
  }

  // ---- session id (persisted so n8n Simple Memory keeps context) ----
  const SESSION_KEY = 'jarvis_session_id';
  let sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'web-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  function setStatus(kind, text) {
    els.statusLine.className = 'status-line ' + kind;
    els.statusText.textContent = text;
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addEntry(role, text) {
    els.emptyState.remove();
    const entry = document.createElement('div');
    entry.className = 'entry ' + role;
    entry.innerHTML =
      '<div class="meta">' + (role === 'user' ? 'you' : 'jarvis') + ' · ' + timeNow() + '</div>' +
      '<div class="bubble"></div>';
    entry.querySelector('.bubble').textContent = text;
    els.log.appendChild(entry);
    els.log.scrollTop = els.log.scrollHeight;
    return entry;
  }

  // ---- send message to n8n webhook ----
  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text) return;
    if (!WEBHOOK_URL) {
      addEntry('assistant', 'No webhook configured. Set WEBHOOK_URL in config.js first.');
      return;
    }

    addEntry('user', text);
    els.textInput.value = '';
    els.orbWrap.classList.add('thinking');
    setStatus('connected', 'thinking…');

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatInput: text, sessionId: sessionId }),
      });

      if (!res.ok) throw new Error('Webhook returned ' + res.status);

      const data = await res.json();
      // n8n's Respond to Webhook node — adjust key name if yours differs
      const reply = data.reply || data.output || data.text || JSON.stringify(data);

      addEntry('assistant', reply);
      if (SPEAK_REPLIES) speak(reply);
      setStatus('connected', 'ready');
    } catch (err) {
      console.error(err);
      addEntry('assistant', 'Error reaching Jarvis backend: ' + err.message);
      setStatus('error', 'connection error');
    } finally {
      els.orbWrap.classList.remove('thinking');
    }
  }

  els.sendBtn.addEventListener('click', () => sendMessage(els.textInput.value));
  els.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage(els.textInput.value);
  });

  // ---- speech recognition (mic input) ----
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      listening = true;
      els.orbWrap.classList.add('listening');
      els.micBtn.classList.add('active');
      els.micHint.textContent = 'listening… tap again to stop';
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      els.textInput.value = transcript;
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      els.micHint.textContent = 'mic error: ' + event.error;
    };

    recognition.onend = () => {
      listening = false;
      els.orbWrap.classList.remove('listening');
      els.micBtn.classList.remove('active');
      els.micHint.textContent = 'tap the orb and speak, or type below';
      const finalText = els.textInput.value.trim();
      if (finalText) sendMessage(finalText);
    };
  } else {
    els.micHint.textContent = 'voice input not supported in this browser — try Chrome or Edge';
    els.micBtn.disabled = true;
  }

  function toggleListening() {
    if (!recognition) return;
    if (listening) {
      recognition.stop();
    } else {
      els.textInput.value = '';
      recognition.start();
    }
  }

  els.orbBtn.addEventListener('click', toggleListening);
  els.micBtn.addEventListener('click', toggleListening);

  // ---- speech synthesis (spoken replies, optional) ----
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }
})();
