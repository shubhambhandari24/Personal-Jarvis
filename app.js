// ================================================================
//  J.A.R.V.I.S — Enhanced Frontend Logic v2
//  Fixes: voice recognition, local keyword detection,
//         personal data integration, action dispatch
// ================================================================
(function () {
  'use strict';

  /* ── CONFIG ──────────────────────────────────────────────── */
  const CFG        = window.JARVIS_CONFIG   || {};
  const DATA       = window.JARVIS_PERSONAL || {};
  const WEBHOOK    = CFG.WEBHOOK_URL        || '';
  const SPEAK_BACK = !!CFG.SPEAK_REPLIES;

  const APP_URLS   = (DATA.apps) || {
    spotify:  'https://open.spotify.com',
    whatsapp: 'https://web.whatsapp.com',
    maps:     'https://maps.google.com',
    gmail:    'https://mail.google.com',
    linkedin: 'https://www.linkedin.com',
    github:   'https://github.com',
    youtube:  'https://youtube.com',
  };

  /* ── LOCAL KEYWORD MAP ───────────────────────────────────── */
  // NOTE: "play [anything]" is handled by the offline music engine below, NOT here
  // Only "open spotify" explicitly launches the Spotify web app
  const LOCAL_CMDS = [
    { test: /^open spotify$/i,                                     action: () => openApp('spotify') },
    { test: /open whatsapp|whatsapp/i,                             action: () => openApp('whatsapp') },
    { test: /open maps|google maps|open map/i,                     action: () => openApp('maps') },
    { test: /open gmail|check mail|open email/i,                   action: () => openApp('gmail') },
    { test: /open linkedin|linkedin/i,                             action: () => openApp('linkedin') },
    { test: /open github|github/i,                                 action: () => openApp('github') },
    { test: /open youtube|youtube/i,                               action: () => openApp('youtube') },
    { test: /navigate to (.+)|open map for (.+)|take me to (.+)/i, action: (m) => openMaps(m[1]||m[2]||m[3]) },
  ];


  /* ── ENGLISH LEARNING TRIGGERS ───────────────────────────── */
  // These enrich the prompt before sending to n8n AI
  const ENGLISH_TRIGGERS = [
    { test: /word of the day|teach me a word|new word/i,
      prompt: 'Give me the Word of the Day with full explanation, pronunciation, examples and memory tip.' },
    { test: /daily (english )?practice|english exercise/i,
      prompt: "Give me today's daily English practice session with exercises and tips." },
    { test: /english tips|improve (my )?english/i,
      prompt: '5 practical English tips I can use right now to sound more professional and confident.' },
    { test: /practice conversation|english roleplay|talk in english/i,
      prompt: "Let's practice English conversation. Start a fun roleplay scenario like a job interview or a phone call. You play the other person." },
    { test: /pronounce (.+)|pronunciation of (.+)/i,
      prompt: (m) => 'How do I pronounce "' + (m[1]||m[2]) + '"? Give syllable breakdown, stress pattern, and common Indian mistake with this word.' },
    { test: /formal version[:\s]+(.*)/i,
      prompt: (m) => 'Give casual, professional, and formal versions of: "' + m[1] + '". Explain when to use each.' },
    { test: /what does (.+) mean/i,
      prompt: (m) => 'What does "' + m[1] + '" mean? Give definition, usage examples, and synonyms.' },
    { test: /correct (this|my grammar|my english)[:\s]+(.*)/i,
      prompt: (m) => 'Correct my English sentence and explain the mistake clearly:\n"' + m[2] + '"' },
  ];

  /* ── DOM REFS ────────────────────────────────────────────── */
  const $  = id => document.getElementById(id);
  const el = {
    textInput:         $('textInput'),
    sendBtn:           $('sendBtn'),
    micBtn:            $('micBtn'),
    orbBtn:            $('orbBtn'),
    orbContainer:      $('orbContainer'),
    orbHint:           $('orbHint'),
    chatLog:           $('chatLog'),
    welcomeCard:       $('welcomeCard'),
    welcomeText:       $('welcomeText'),
    statusDot:         $('statusDot'),
    statusText:        $('statusText'),
    thinkingBar:       $('thinkingBar'),
    waveformContainer: $('waveformContainer'),
    waveform:          $('waveform'),
    sessionDisplay:    $('sessionDisplay'),
    charCount:         $('charCount'),
    toast:             $('toast'),
    confirmModal:      $('confirmModal'),
    modalTitle:        $('modalTitle'),
    modalMsg:          $('modalMsg'),
    modalYes:          $('modalYes'),
    modalNo:           $('modalNo'),
    timeDisplay:       $('timeDisplay'),
    bgCanvas:          $('bgCanvas'),
  };

  /* ── SESSION ─────────────────────────────────────────────── */
  const SK = 'jarvis_session_id';
  let sessionId = localStorage.getItem(SK);
  if (!sessionId) {
    sessionId = 'jrv-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SK, sessionId);
  }
  el.sessionDisplay.textContent = sessionId.slice(0, 14).toUpperCase();

  /* ── STATUS ──────────────────────────────────────────────── */
  function setStatus(state, label) {
    el.statusDot.className    = 'status-dot ' + state;
    el.statusText.textContent = label.toUpperCase();
  }
  setStatus(WEBHOOK ? 'connected' : 'error', WEBHOOK ? 'ONLINE' : 'WEBHOOK NOT SET');

  /* ── CLOCK ───────────────────────────────────────────────── */
  (function clock() {
    const pad = n => String(n).padStart(2, '0');
    function tick() {
      const d = new Date();
      el.timeDisplay.textContent =
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    tick(); setInterval(tick, 1000);
  })();

  /* ── PARTICLE CANVAS ─────────────────────────────────────── */
  (function particles() {
    const canvas = el.bgCanvas;
    const ctx    = canvas.getContext('2d');
    let W, H, pts = [];

    function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }

    function spawn() {
      pts = [];
      const n = Math.floor((W * H) / 13000);
      for (let i = 0; i < n; i++)
        pts.push({ x: Math.random()*W, y: Math.random()*H,
                   vx:(Math.random()-.5)*.28, vy:(Math.random()-.5)*.28,
                   r: Math.random()*1.3+.4,   a: Math.random()*.4+.08 });
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i+1; j < pts.length; j++) {
          const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
          if (d < 110) {
            ctx.beginPath();
            ctx.strokeStyle='rgba(0,212,255,'+(0.045*(1-d/110))+')';
            ctx.lineWidth=.5;
            ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, pts[i].r, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,212,255,'+pts[i].a+')';
        ctx.fill();
        pts[i].x += pts[i].vx; pts[i].y += pts[i].vy;
        if (pts[i].x<0||pts[i].x>W) pts[i].vx*=-1;
        if (pts[i].y<0||pts[i].y>H) pts[i].vy*=-1;
      }
      requestAnimationFrame(draw);
    }

    resize(); spawn(); draw();
    window.addEventListener('resize', () => { resize(); spawn(); });
  })();

  /* ── WAVEFORM BARS ───────────────────────────────────────── */
  (function buildBars() {
    for (let i = 0; i < 24; i++) {
      const b = document.createElement('div');
      b.className = 'waveform-bar';
      b.style.height = '4px';
      b.style.animationDelay    = (i/24*0.8)+'s';
      b.style.animationDuration = (0.4+Math.random()*0.55)+'s';
      el.waveform.appendChild(b);
    }
  })();

  let waveTimer;
  function startWave() {
    el.waveformContainer.classList.add('active');
    waveTimer = setInterval(() => {
      el.waveform.querySelectorAll('.waveform-bar').forEach(b => {
        b.style.height = (Math.random()*38+4)+'px';
      });
    }, 85);
  }
  function stopWave() {
    el.waveformContainer.classList.remove('active');
    clearInterval(waveTimer);
    el.waveform.querySelectorAll('.waveform-bar').forEach(b => { b.style.height='4px'; });
  }

  /* ── TYPEWRITER ──────────────────────────────────────────── */
  function typewrite(target, text, speed) {
    speed = speed || 15;
    return new Promise(res => {
      target.classList.add('typing');
      let i = 0; target.textContent = '';
      function tick() {
        if (i < text.length) {
          target.textContent += text[i++];
          el.chatLog.scrollTop = el.chatLog.scrollHeight;
          setTimeout(tick, speed);
        } else { target.classList.remove('typing'); res(); }
      }
      tick();
    });
  }

  /* ── ADD CHAT MESSAGE ────────────────────────────────────── */
  function addMsg(role, text, animate) {
    if (el.welcomeCard) { el.welcomeCard.remove(); el.welcomeCard = null; }

    const wrap   = document.createElement('div');
    wrap.className = 'msg ' + role;

    const meta   = document.createElement('div');
    meta.className = 'msg-meta';
    const t = new Date();
    meta.textContent =
      (role==='user' ? '[ YOU ]' : '[ JARVIS ]') + '  ' +
      String(t.getHours()).padStart(2,'0') + ':' +
      String(t.getMinutes()).padStart(2,'0');

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    el.chatLog.appendChild(wrap);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;

    if (animate && role==='assistant') return typewrite(bubble, text);
    bubble.textContent = text;
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    return Promise.resolve();
  }

  /* ── TOAST ───────────────────────────────────────────────── */
  let _tt;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(_tt);
    _tt = setTimeout(() => el.toast.classList.remove('show'), 3200);
  }

  /* ── OPEN APP ────────────────────────────────────────────── */
  function openApp(key) {
    key = key.toLowerCase().trim();
    const url = APP_URLS[key];
    if (!url) { toast('⚠️ App "'+key+'" not configured'); return; }
    
    const win = window.open(url, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      toast('⚠️ Popup blocked! Allow in URL bar.');
      speak('Popup blocked. Please click the icon in your address bar and allow popups.');
    } else {
      toast('⚡ Opening ' + key.charAt(0).toUpperCase()+key.slice(1)+'...');
      addMsg('assistant', '⚡ Opening '+key.charAt(0).toUpperCase()+key.slice(1)+'! 🚀', true);
    }
  }

  /* ── OPEN MAPS ───────────────────────────────────────────── */
  function openMaps(query) {
    const url = 'https://maps.google.com/?q=' + encodeURIComponent(query);
    const win = window.open(url, '_blank');
    
    if (!win || win.closed || typeof win.closed === 'undefined') {
      toast('⚠️ Popup blocked! Allow in URL bar.');
      speak('Popup blocked. Please click the icon in your address bar and allow popups.');
    } else {
      toast('🗺️ Opening Maps...');
      addMsg('assistant', '🗺️ Opening Google Maps for "' + query + '"! 🗺️', true);
    }
  }

  /* ── CALL CONFIRMATION ───────────────────────────────────── */
  function requestCall(phone, name) {
    const last3 = phone.slice(-3);
    showConfirm(
      'CONFIRM CALL',
      'Calling ' + (name||'contact') + ' — number ending in ' + last3 + '. Is that correct?',
      function(ok) {
        if (ok) {
          toast('📞 Dialing ' + (name||phone));
          addMsg('assistant', '📞 Dialing now! Connecting you to '+( name||'contact')+'...', true);
          setTimeout(() => { window.location.href = 'tel:'+phone; }, 800);
        } else {
          addMsg('assistant', 'Call cancelled. Say the word whenever you need! 😊', true);
        }
      }
    );
  }

  /* ── WEATHER ENGINE (instant — bypasses n8n) ─────────────── */
  const WEATHER_ICONS = {
    Thunderstorm: '⛈️', Drizzle: '🌦️', Rain: '🌧️', Snow: '❄️',
    Clear: '☀️', Clouds: '☁️', Mist: '🌫️', Fog: '🌫️',
    Haze: '🌫️', Smoke: '🌫️', Dust: '🌪️', Sand: '🌪️',
    Ash: '🌋', Squall: '🌬️', Tornado: '🌪️',
  };

  async function fetchWeather(city, country) {
    const key = CFG.OPENWEATHER_API_KEY;
    if (!key || key === 'YOUR_API_KEY_HERE') {
      addMsg('assistant',
        '🌤️ Weather is ready but needs your free API key!\n\n' +
        '📋 Steps (takes 2 mins):\n' +
        '1. Go to → https://openweathermap.org/api\n' +
        '2. Click "Sign Up" (free, no credit card)\n' +
        '3. Verify email → My API Keys → copy key\n' +
        '4. Open config.js → paste key in OPENWEATHER_API_KEY\n' +
        '5. Wait ~10 mins, then ask me weather again! ⚡', true);
      return;
    }

    const q = encodeURIComponent(city + ',' + (country || 'IN'));
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${key}&units=metric`;

    try {
      setStatus('thinking', 'FETCHING WEATHER');
      const res  = await fetch(url);
      const data = await res.json();

      if (data.cod !== 200) {
        addMsg('assistant', '⚠️ Could not find weather for "' + city + '". Check city name?', true);
        setStatus('connected', 'ONLINE');
        return;
      }

      const icon   = WEATHER_ICONS[data.weather[0].main] || '🌡️';
      const cond   = data.weather[0].description;
      const temp   = Math.round(data.main.temp);
      const feels  = Math.round(data.main.feels_like);
      const humid  = data.main.humidity;
      const wind   = Math.round(data.wind.speed * 3.6); // m/s → km/h
      const min    = Math.round(data.main.temp_min);
      const max    = Math.round(data.main.temp_max);
      const vis    = data.visibility ? (data.visibility / 1000).toFixed(1) + ' km' : 'N/A';
      const name   = data.name;

      // Human-readable advice
      let advice = '';
      if (temp > 35)        advice = "It's really HOT — stay hydrated bro! 💧";
      else if (temp > 28)   advice = "Warm and sunny — light clothes recommended! 😎";
      else if (temp > 20)   advice = "Pleasant weather — enjoy your day! 🌿";
      else if (temp > 12)   advice = "A bit chilly — carry a light jacket! 🧥";
      else                  advice = "It's cold — wrap up warm! 🧣";

      const reply =
        `${icon} Weather in ${name}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌡️  Temperature  : ${temp}°C  (feels like ${feels}°C)\n` +
        `📊  Condition    : ${cond.charAt(0).toUpperCase()+cond.slice(1)}\n` +
        `📈  High / Low   : ${max}°C / ${min}°C\n` +
        `💧  Humidity     : ${humid}%\n` +
        `💨  Wind         : ${wind} km/h\n` +
        `👁️  Visibility   : ${vis}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💬  ${advice}`;

      setStatus('connected', 'ONLINE');
      await addMsg('assistant', reply, true);
      if (SPEAK_BACK) speak(`Weather in ${name}: ${temp} degrees, ${cond}. ${advice}`);

    } catch (err) {
      setStatus('error', 'WEATHER ERROR');
      addMsg('assistant', '⚠️ Weather fetch failed: ' + err.message, true);
    }
  }

  /* ── LOCAL COMMAND CHECK ─────────────────────────────────── */
  // Returns true if handled locally (skips n8n)
  function checkLocalCommand(text) {
    const t = text.toLowerCase().trim();

    // ── 1. Music "play" commands — FIRST priority ─────────────
    // Must run before LOCAL_CMDS so "play starboy" never hits Spotify redirect
    const playMatch = t.match(/^play\s+(.+)$/i);
    if (playMatch) {
      const appNames = ['spotify','youtube','gaana','jiosaavn','soundcloud','whatsapp','maps','gmail','linkedin','github'];
      const raw = playMatch[1].trim().replace(/\b(song|track|music|by the|the song|please|for me|now)\b/gi,' ').replace(/\s+/g,' ').trim();
      // Only send to app if user EXPLICITLY said "open spotify" style
      // "play [anything else]" → offline music
      if (!appNames.some(a => raw === a)) {
        handleMusicCommand('play', raw); return true;
      }
    }

    // ── 2. Weather queries ────────────────────────────────────
    const weatherMatch =
      text.match(/weather\s+in\s+([a-zA-Z\s]+)/i) ||
      text.match(/([a-zA-Z\s]+)\s+weather/i);
    const isGenericWeather = /\b(weather|temperature|forecast|today.*weather|weather.*today|how.*hot|how.*cold|temp)\b/i.test(text);

    if (weatherMatch && !isGenericWeather) {
      const city = (weatherMatch[1] || '').trim();
      fetchWeather(city, 'IN');
      return true;
    }
    if (isGenericWeather) {
      fetchWeather(CFG.HOME_CITY || 'Raichur', CFG.HOME_COUNTRY || 'IN');
      return true;
    }

    // ── 3. App launcher LOCAL_CMDS ────────────────────────────
    for (const cmd of LOCAL_CMDS) {
      const m = text.match(cmd.test);
      if (m) {
        cmd.action(m);
        return true;
      }
    }

    // ── Offline Music commands (non-play) ─────────────────────

    // index / scan
    if (/\b(index|scan|load|setup)\s+(my\s+)?(music|songs?|library|tracks?)\b/i.test(t) ||
        /\b(index my music|scan music|load music)\b/i.test(t)) {
      handleMusicCommand('index', ''); return true;
    }
    // list songs
    if (/\b(list|show|what are|tell me)\s+(my\s+)?(songs?|music|tracks?|library)\b/i.test(t) ||
        /\bwhat songs? (do i|i) have\b/i.test(t)) {
      handleMusicCommand('list', ''); return true;
    }
    // what's playing / current song
    if (/\b(what('?s| is) (playing|this song)|current song|now playing)\b/i.test(t)) {
      handleMusicCommand('current', ''); return true;
    }
    // shuffle
    if (/\b(shuffle|random|mix)\b/i.test(t) && /\b(music|songs?|play|tracks?)\b/i.test(t)) {
      const artist = t.match(/shuffle\s+(?:my\s+)?(?:songs?\s+by\s+|(.+?)\s+songs?|(.+?)\s+music)/i);
      handleMusicCommand('shuffle', artist ? (artist[1]||artist[2]||'') : ''); return true;
    }
    // pause / resume — catch all natural variations
    if (/\b(pause|paused)\b/i.test(t) && !/\bplay\b/i.test(t)) {
      handleMusicCommand('pause', ''); return true;
    }
    if (/\b(resume|unpause|continue playing|play again)\b/i.test(t)) {
      handleMusicCommand('pause', ''); return true;
    }
    // stop music
    if (/\b(stop|end)\b.*\b(music|song|playing|audio|this)\b/i.test(t) ||
        /\b(stop music|stop song|stop playing|stop the music)\b/i.test(t)) {
      handleMusicCommand('stop', ''); return true;
    }
    // next song — catch "next", "skip", "skip this", "next one", "go next"
    if (/^(next|skip|next one|skip this|next song|next track|go next|play next)$/i.test(t) ||
        /\bskip\s+(this|song|track)\b/i.test(t) ||
        /\bnext\s+(song|track|one)\b/i.test(t)) {
      handleMusicCommand('next', ''); return true;
    }
    // previous song
    if (/^(prev|previous|go back|last song|previous song|previous track|play previous)$/i.test(t) ||
        /\b(previous|last)\s+(song|track|one)\b/i.test(t)) {
      handleMusicCommand('prev', ''); return true;
    }


    // English learning triggers → enrich prompt, then send to n8n
    for (const eng of ENGLISH_TRIGGERS) {
      const m = text.match(eng.test);
      if (m) {
        const enriched = typeof eng.prompt === 'function' ? eng.prompt(m) : eng.prompt;
        sendToN8n(enriched); // send enriched prompt instead
        return true;
      }
    }
    // Call dad / call mom / call brother
    const callMatch = text.match(/call (dad|father|papa|amma|mom|mother|bro|brother|girish)/i);
    if (callMatch) {
      const who = callMatch[1].toLowerCase();
      const contacts = {
        dad:     { name: 'Dad (Ramareddy)', phone: CFG.DAD_PHONE || '+910000000958' },
        father:  { name: 'Dad (Ramareddy)', phone: CFG.DAD_PHONE || '+910000000958' },
        papa:    { name: 'Dad (Ramareddy)', phone: CFG.DAD_PHONE || '+910000000958' },
        mom:     { name: 'Mom (Anuradha)',  phone: CFG.MOM_PHONE || '+910000000000' },
        amma:    { name: 'Mom (Anuradha)',  phone: CFG.MOM_PHONE || '+910000000000' },
        mother:  { name: 'Mom (Anuradha)',  phone: CFG.MOM_PHONE || '+910000000000' },
        bro:     { name: 'Girish (Brother)', phone: CFG.BRO_PHONE || '+910000000000' },
        brother: { name: 'Girish (Brother)', phone: CFG.BRO_PHONE || '+910000000000' },
        girish:  { name: 'Girish (Brother)', phone: CFG.BRO_PHONE || '+910000000000' },
      };
      const c = contacts[who];
      if (c) { requestCall(c.phone, c.name); return true; }
    }
    return false; // not handled locally → send to n8n
  }

  /* ── ACTION PARSING (from n8n response) ─────────────────── */
  function parseActions(text) {
    const re   = /\[ACTION:([A-Z_]+):?([^\]]*)\]/g;
    const acts = [];
    let clean  = text; let m;
    while ((m = re.exec(text)) !== null) {
      acts.push({ type: m[1], val: (m[2]||'').trim() });
      clean = clean.replace(m[0], '');
    }
    return { clean: clean.trim(), acts };
  }

  function runAction(type, val) {
    switch(type) {
      case 'OPEN_APP':  openApp(val);                 break;
      case 'MAPS':      openMaps(val);                break;
      case 'CALL':      requestCall(val, val);        break;
      case 'LOCAL_MUSIC': if (typeof handleMusicCommand !== 'undefined') handleMusicCommand('play ' + val); break;
      case 'SWITCH_LANG':
        const switchTo = val.toLowerCase();
        if (switchTo === 'en') {
          _currentLang = 'en'; if (rec) rec.lang = 'en-IN'; localStorage.setItem('jarvis_lang', 'en'); toast('🌐 Language: English');
        } else if (LANG_MAP && LANG_MAP[switchTo]) {
          _currentLang = switchTo; if (rec) rec.lang = LANG_MAP[switchTo].voiceCode; localStorage.setItem('jarvis_lang', switchTo); toast('🌐 Language: ' + LANG_MAP[switchTo].label);
        }
        break;
      case 'PLAY':      openApp('spotify');           break;
      case 'EMAIL':     openApp('gmail');             break;
      default: console.warn('[JARVIS] Unknown action:', type, val);
    }
  }

  /* ── CONFIRM MODAL ───────────────────────────────────────── */
  let _cb = null;
  function showConfirm(title, msg, cb) {
    el.modalTitle.textContent = title;
    el.modalMsg.textContent   = msg;
    el.confirmModal.classList.add('active');
    _cb = cb;
  }
  el.modalYes.addEventListener('click', () => { el.confirmModal.classList.remove('active'); if(_cb) _cb(true); _cb=null; });
  el.modalNo.addEventListener('click',  () => { el.confirmModal.classList.remove('active'); _cb=null; });

  /* ── SEND TO N8N WEBHOOK ─────────────────────────────────── */
  let busy = false;

  async function send(text, displayText) {
    text = (text||'').trim();
    if (!text || busy) return;

    // displayText = what the user SAID (without language instruction prefix)
    const shown = (displayText || text).trim();

    // 1a. Language switch typed — handle BEFORE n8n (works for both typed & voice)
    if (typeof checkLangSwitch !== 'undefined') {
      const switchTo = checkLangSwitch(shown);
      if (switchTo !== null) {
        addMsg('user', shown);
        el.textInput.value = ''; el.charCount.textContent = '0 chars';
        
        _currentLang = switchTo;
        
        if (switchTo === 'en') {
          if (rec) rec.lang = 'en-IN';
          localStorage.setItem('jarvis_lang', 'en');
          addMsg('assistant', '🇬🇧 Switched to English mode! JARVIS will now respond in English.', false);
          speak('Switched to English mode!', 'en-IN');
        } else if (LANG_MAP && LANG_MAP[switchTo]) {
          if (rec) rec.lang = LANG_MAP[switchTo].voiceCode;
          localStorage.setItem('jarvis_lang', switchTo);
          addMsg('assistant', '🌐 Switched to ' + LANG_MAP[switchTo].label + ' mode!', false);
          speak('Switched to ' + LANG_MAP[switchTo].label + ' mode!', 'en-IN');
        }
        toast('🌐 Language: ' + (LANG_MAP?.[switchTo]?.label || 'English'));
        return;
      }
    }

    // 1b. Check local commands (music/weather/apps — no webhook needed)
    addMsg('user', shown);
    el.textInput.value = '';
    el.charCount.textContent = '0 chars';

    if (checkLocalCommand(shown)) return; // handled locally

    // 1c. Auto-detect language for TYPED or VOICE input before sending
    if (typeof detectLanguage !== 'undefined') {
      const detected = detectLanguage(shown);
      if (detected.code !== 'en') {
        if (_currentLang !== detected.code) {
          toast('🌐 ' + detected.label + ' detected!');
        }
        _currentLang = detected.code;
        localStorage.setItem('jarvis_lang', detected.code);
        if (rec) rec.lang = detected.voiceCode;
      }
    }

    // 2. Forward to n8n
    if (!WEBHOOK) {
      addMsg('assistant',
        '⚠️ Webhook not configured yet.\n' +
        'Edit config.js → set WEBHOOK_URL to your n8n webhook URL.\n' +
        'E.g.: http://localhost:5678/webhook/jarvis', true);
      return;
    }

    // Prepend instruction for non-English
    let textToSend = text;
    if (_currentLang !== 'en' && typeof LANG_INSTRUCTIONS !== 'undefined') {
      const instruction = LANG_INSTRUCTIONS[_currentLang];
      if (instruction) textToSend = instruction + ' ' + text;
    }

    busy = true;
    el.orbContainer.classList.add('thinking');
    el.thinkingBar.classList.add('active');
    setStatus('thinking', 'PROCESSING');

    // Show "still working" hint if n8n takes too long
    const slowTimer = setTimeout(() => {
      if (busy) toast('⏳ Still thinking... JARVIS is working on it!');
    }, 12000);

    try {
      const res = await fetch(WEBHOOK, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chatInput: textToSend, sessionId }),
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Safe JSON parse — n8n can return error text when max iterations hit
      let rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        // n8n returned non-JSON (error page or truncated response)
        if (rawText.includes('Max iterations')) {
          throw new Error('MAX_ITERATIONS');
        }
        throw new Error('BAD_JSON: ' + rawText.slice(0, 120));
      }

      let reply = data.reply || data.output || data.text || data.message || JSON.stringify(data);

      // Detect max iterations error inside JSON too
      if (reply.includes('Max iterations') || reply.includes('max iterations')) {
        throw new Error('MAX_ITERATIONS');
      }

      const { clean, acts } = parseActions(reply);
      reply = clean;

      clearTimeout(slowTimer);
      el.thinkingBar.classList.remove('active');
      el.orbContainer.classList.remove('thinking');
      setStatus('connected', 'ONLINE');

      if (SPEAK_BACK) speak(reply);
      await addMsg('assistant', reply, true);
      acts.forEach(a => runAction(a.type, a.val));

    } catch (err) {
      clearTimeout(slowTimer);
      el.thinkingBar.classList.remove('active');
      el.orbContainer.classList.remove('thinking');
      setStatus('error', 'CONNECTION ERROR');

      // Specific error messages
      if (err.message === 'MAX_ITERATIONS') {
        addMsg('assistant',
          '⚠️ JARVIS got stuck in a loop (n8n Max Iterations reached).\n\n' +
          '🔧 **Fix this in n8n (takes 30 seconds):**\n' +
          '1. Open n8n → click your AI Agent node\n' +
          '2. Click ⚙️ Settings tab\n' +
          '3. Change "Max Iterations" from 10 → **25**\n' +
          '4. Click Save → re-publish workflow\n\n' +
          'This happens when your system prompt is very long and Gemini needs more thinking steps.', true);
        speak('JARVIS got stuck. Please fix the Max Iterations setting in n8n.');
      } else if (err.message.includes('HTTP 5') || err.message.includes('HTTP 4')) {
        addMsg('assistant',
          '⚠️ n8n returned an error (' + err.message + ').\n' +
          'Check that your n8n workflow is **Published** (not just saved) and the webhook is active.', true);
      } else if (err.message.includes('fetch') || err.message.includes('Failed to fetch')) {
        addMsg('assistant',
          '⚠️ Cannot reach n8n. Is it running?\n' +
          'Open a terminal and run: **npx n8n** or check if it is running on localhost:5678.', true);
      } else {
        addMsg('assistant',
          '⚠️ Could not reach JARVIS backend.\n' +
          'Make sure n8n is running and workflow is Published.\n\nError: ' + err.message, true);
      }
      console.error('[JARVIS]', err);
    } finally {
      busy = false;
    }
  }


  /* ── INPUT EVENTS ────────────────────────────────────────── */
  el.sendBtn.addEventListener('click', () => send(el.textInput.value));
  el.textInput.addEventListener('keydown', e => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(el.textInput.value); }
  });
  el.textInput.addEventListener('input', () => {
    el.charCount.textContent = el.textInput.value.length + ' chars';
  });

  document.querySelectorAll('[data-app]').forEach(btn => {
    btn.addEventListener('click', () => openApp(btn.dataset.app));
  });

  // English quick-action button
  document.querySelectorAll('[data-english]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.english;
      const prompts = {
        daily:    "Give me today's daily English practice session.",
        word:     'Give me the Word of the Day with full details.',
        tips:     'Give me 5 quick English tips to improve my communication.',
        grammar:  'Explain 3 common English grammar mistakes Indians make, with corrections.',
      };
      const p = prompts[mode] || prompts.daily;
      addMsg('user', '🇬🇧 English: ' + mode);
      sendToN8n(p);
    });
  });

  /* ── MUSIC BUTTON (sidebar) ──────────────────────────────── */
  document.querySelectorAll('[data-music]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const M = window.JARVIS_MUSIC;
      if (!M) return;
      const mode = btn.dataset.music;
      if (mode === 'index') {
        addMsg('user', '🎵 Index my music folder');
        addMsg('assistant', '📂 Opening folder picker — please select your music folder!', false);
        const result = await M.indexFolder();
        if (result.success) {
          addMsg('assistant',
            '✅ Found ' + result.count + ' songs in your library!\n' +
            'You can now say: "play Starboy", "play Weeknd", "shuffle my music", "list my songs"', true);
          speak('Music indexed! Found ' + result.count + ' songs. Ready to play.');
        } else {
          addMsg('assistant', '⚠️ ' + (result.msg || 'Could not index folder.'), true);
        }
      }
    });
  });

  /* ── MUSIC COMMANDS handler ──────────────────────────────── */
  // Called from checkLocalCommand when a music intent is detected
  async function handleMusicCommand(intent, query) {
    const M = window.JARVIS_MUSIC;
    if (!M) { addMsg('assistant', '⚠️ Music engine not loaded.', true); return; }

    // If no catalog in memory, try to restore it
    if (intent !== 'index' && !M.catalog.length) {
      const savedMeta = M.loadSavedMeta();
      if (!savedMeta.length) {
        // Truly first time — show full folder picker
        addMsg('assistant', '🎵 Setting up your music library — select your music folder in the popup!', false);
        speak('Select your music folder please.');
        const res = await M.indexFolder();
        if (!res.success) {
          addMsg('assistant', '⚠️ ' + (res.msg || 'Cancelled.') + '\n\nTry the 🎵 My Music button in the sidebar.', true);
          return;
        }
        addMsg('assistant', '✅ Found ' + res.count + ' songs (with song titles from ID3 tags)! Now playing...', false);
      } else {
        // Have metadata from before — try one-click re-grant (no full picker!)
        addMsg('assistant', '🎵 I know your ' + savedMeta.length + ' songs! Just need a quick folder re-access — click Allow in the popup!', false);
        speak('Requesting folder access. Please click Allow.');
        const ok = await M.reGrantAccess();
        if (!ok) {
          // reGrantAccess failed (maybe handle gone) — fall back to full picker
          addMsg('assistant', '📂 Quick access failed — please select your music folder once more!', false);
          const res = await M.indexFolder();
          if (!res.success) {
            addMsg('assistant', '⚠️ ' + (res.msg || 'Cancelled.'), true);
            return;
          }
        }
        addMsg('assistant', '✅ ' + M.catalog.length + ' songs loaded! Playing...', false);
      }
    }

    if (intent === 'index') {
      addMsg('user', '🎵 Index my music');
      addMsg('assistant', '📂 Opening folder picker — select your music folder!', false);
      const res = await M.indexFolder();
      if (res.success) {
        addMsg('assistant', '✅ Indexed ' + res.count + ' songs! Say "play [song name]" to play.', true);
        speak('Done! Found ' + res.count + ' songs. Ready to play.');
      } else {
        addMsg('assistant', '⚠️ ' + (res.msg || 'Indexing failed.'), true);
      }
      return;
    }

    if (intent === 'list') {
      const songs = M.catalog.slice(0, 20);
      if (!songs.length) { addMsg('assistant', '📭 No songs indexed yet.', true); return; }
      const list = songs.map((s, i) => (i+1) + '. ' + s.title + (s.artist ? ' — ' + s.artist : '')).join('\n');
      addMsg('assistant', '🎵 Your Music Library (' + M.catalog.length + ' songs):\n\n' + list +
        (M.catalog.length > 20 ? '\n\n...and ' + (M.catalog.length-20) + ' more songs.' : ''), true);
      speak('You have ' + M.catalog.length + ' songs. Showing the first 20.');
      return;
    }

    if (intent === 'stop') {
      M.stopSong();
      addMsg('assistant', '⏹ Music stopped.', false);
      speak('Stopped.');
      return;
    }

    if (intent === 'pause') {
      const playing = M.pauseSong();
      const pp = document.getElementById('npPlayPause');
      if (pp) pp.textContent = playing ? '⏸' : '▶';
      addMsg('assistant', playing ? '▶ Resumed!' : '⏸ Paused.', false);
      speak(playing ? 'Resumed.' : 'Paused.');
      return;
    }

    if (intent === 'next') { M.nextSong(); addMsg('assistant', '⏭ Next song!', false); return; }
    if (intent === 'prev') { M.prevSong(); addMsg('assistant', '⏮ Previous song!', false); return; }

    if (intent === 'current') {
      const s = M.getCurrentSong();
      if (!s) { addMsg('assistant', '🔇 Nothing is playing right now.', false); return; }
      addMsg('assistant', '🎵 Now playing: ' + s.title + (s.artist ? ' by ' + s.artist : ''), false);
      speak('Currently playing ' + s.title + (s.artist ? ' by ' + s.artist : ''));
      return;
    }

    if (intent === 'shuffle') {
      const pool = query ? M.findSongs(query) : M.catalog.map((s,i) => ({...s, idx:i}));
      if (!pool.length) {
        addMsg('assistant', '😅 No songs found for "' + query + '". Try "shuffle my music" for all songs.', true);
        return;
      }
      M.shufflePlay(pool);
      addMsg('assistant', '🔀 Shuffling ' + pool.length + ' songs! Enjoy the mix 🎶', true);
      speak('Shuffling ' + pool.length + ' songs. Enjoy!');
      return;
    }

    if (intent === 'play') {
      if (!query) {
        // No specific song — play first or shuffle all
        if (M.catalog.length) {
          M.shufflePlay(M.catalog.map((s,i) => ({...s, idx:i})));
          addMsg('assistant', '🎵 Playing your music library on shuffle! 🎶', true);
          speak('Playing your music on shuffle. Enjoy!');
        }
        return;
      }

      const results = M.findSongs(query);
      if (!results.length) {
        addMsg('assistant',
          '😅 Couldn\'t find "' + query + '" in your library.\n' +
          'Try: "list my songs" to see what\'s available, or check the spelling.', true);
        speak('Song not found. Try listing your songs.');
        return;
      }

      // If multiple results found and first score isn't a clear winner, show options briefly
      if (results.length > 1 && results[0].title.toLowerCase() !== query.toLowerCase()) {
        // Build a queue of all matches and start from the top match
        const queue = results.map(s => s.idx);
        const res = await M.playSong(results[0].idx);
        // Set full match queue
        window.JARVIS_MUSIC._queue = queue;
        if (res.success) {
          const s = res.song;
          addMsg('assistant',
            '🎵 Playing: **' + s.title + '**' + (s.artist ? ' — ' + s.artist : '') +
            (results.length > 1 ? '\n\n📋 ' + (results.length-1) + ' more match(es) queued.' : ''), true);
          speak('Playing ' + s.title + (s.artist ? ' by ' + s.artist : ''));
        } else {
          addMsg('assistant', '⚠️ ' + res.msg + '\n\nSay "index my music" to refresh.', true);
        }
      } else {
        const res = await M.playSong(results[0].idx);
        if (res.success) {
          const s = res.song;
          addMsg('assistant', '🎵 Playing: **' + s.title + '**' + (s.artist ? ' — ' + s.artist : '') + ' 🎶', true);
          speak('Playing ' + s.title + (s.artist ? ' by ' + s.artist : ''));
        } else {
          addMsg('assistant', '⚠️ ' + res.msg + '\n\nSay "index my music" to refresh.', true);
        }
      }
    }
  }

  /* ── sendToN8n — shared n8n fetch used by English triggers ── */
  async function sendToN8n(enrichedPrompt) {
    if (!WEBHOOK) {
      addMsg('assistant', '⚠️ Webhook not configured. Edit config.js first.', true);
      return;
    }
    busy = true;
    el.orbContainer.classList.add('thinking');
    el.thinkingBar.classList.add('active');
    setStatus('thinking', 'PROCESSING');
    try {
      const res = await fetch(WEBHOOK, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chatInput: enrichedPrompt, sessionId }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data  = await res.json();
      let   reply = data.reply || data.output || data.text || data.message || JSON.stringify(data);
      const { clean, acts } = parseActions(reply);
      reply = clean;
      el.thinkingBar.classList.remove('active');
      el.orbContainer.classList.remove('thinking');
      setStatus('connected', 'ONLINE');
      if (SPEAK_BACK) speak(reply);
      await addMsg('assistant', reply, true);
      acts.forEach(a => runAction(a.type, a.val));
    } catch (err) {
      el.thinkingBar.classList.remove('active');
      el.orbContainer.classList.remove('thinking');
      setStatus('error', 'CONNECTION ERROR');
      addMsg('assistant', '⚠️ Backend error: ' + err.message, true);
    } finally {
      busy = false;
    }
  }

  /* ── SPEECH RECOGNITION ──────────────────────────────────── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  let _voiceTranscript = '';

  /* ── WAKE WORD LISTENER ──────────────────────────────────── */
  let wakeRec    = null;
  let wakeActive = false;
  const WAKE_WORDS = /\b(hey jarvis|hello jarvis|hi jarvis|ok jarvis|jarvis|ओके जार्विस|ए जार्विस)\b/i;

  function startWakeWord() {
    if (!SR || wakeActive || listening) return;
    try {
      wakeRec = new SR();
      wakeRec.lang            = 'en-IN';
      wakeRec.continuous      = true;
      wakeRec.interimResults  = true;
      wakeRec.maxAlternatives = 1;

      wakeRec.onresult = (e) => {
        // Prevent JARVIS from hearing himself!
        if (window.speechSynthesis && window.speechSynthesis.speaking) return;

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.toLowerCase().trim();
          if (WAKE_WORDS.test(t)) {
            wakeRec.stop();
            wakeActive = false;
            toast('🎤 Yes Boss!');
            speak('Yes Boss!');
            const checkTTS = setInterval(() => {
              if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
                clearInterval(checkTTS);
                if (!listening) toggleListen();
              }
            }, 100);
            break;
          }
        }
      };
      wakeRec.onerror = (e) => { 
        wakeActive = false; 
        if (e.error !== 'not-allowed' && e.error !== 'aborted') {
          if (!listening) setTimeout(() => startWakeWord(), 1000);
        }
      };
      wakeRec.onend   = () => {
        wakeActive = false;
        if (!listening) setTimeout(() => startWakeWord(), 400); // 400ms delay prevents browser crash loop
      };
      wakeRec.start();
      wakeActive = true;
    } catch (e) {
      wakeActive = false;
      console.warn('[Wake]', e.message);
    }
  }

  /* ── MAIN SPEECH RECOGNITION ─────────────────────────────── */
  if (SR) {
    rec = new SR();
    rec.lang            = 'en-IN';   // safe default; updated after LANG_MAP is declared
    rec.interimResults  = true;
    rec.continuous      = false;
    rec.maxAlternatives = 5;


    rec.onstart = () => {
      listening        = true;
      _voiceTranscript = '';
      el.textInput.value = '';
      el.orbContainer.classList.add('listening');
      el.micBtn.classList.add('active');
      el.orbHint.textContent = 'LISTENING...';
      setStatus('listening', 'LISTENING');
      startWave();
      console.log('[JARVIS mic] started');
    };

    rec.onresult = e => {
      let interim = '', final = '';
      for (let i = 0; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final   += txt;
        } else {
          interim += txt;
        }
      }
      // Store the best available text in our dedicated variable
      const best = (final || interim).trim();
      if (best) _voiceTranscript = best;

      // Show in input for visual feedback
      el.textInput.value = best;
      el.charCount.textContent = best.length + ' chars';
      console.log('[JARVIS mic] heard:', best, '| final:', !!final);

      // If we have a FINAL result, trigger immediately — don't wait for onend
      if (final.trim()) {
        console.log('[JARVIS mic] final result, sending now:', final.trim());
        rec.stop(); // triggers onend → onend reads _voiceTranscript
      }
    };

    rec.onerror = e => {
      console.warn('[JARVIS mic] error:', e.error);
      _voiceTranscript = '';
      if (e.error === 'no-speech') {
        toast('🎤 No speech detected — tap orb and try again!');
      } else if (e.error === 'not-allowed') {
        toast('⚠️ Mic blocked! Allow microphone in browser settings.');
        addMsg('assistant',
          '⚠️ Microphone permission was blocked.\n' +
          'Click the 🔒 lock icon in your address bar → Allow Microphone → Reload.', true);
      } else if (e.error === 'network') {
        toast('⚠️ Network error with Speech API — check internet connection.');
      } else {
        toast('⚠️ Mic error: ' + e.error);
      }
    };

    rec.onend = () => {
      listening = false;
      el.orbContainer.classList.remove('listening');
      el.micBtn.classList.remove('active');
      el.orbHint.textContent = 'SAY "HEY JARVIS" OR TAP';
      stopWave();
      if (el.statusText.textContent !== 'PROCESSING')
        setStatus('connected', 'ONLINE');

      // Restart wake word listener now that main mic is done
      setTimeout(() => startWakeWord(), 800);

      const finalText = _voiceTranscript.trim();
      _voiceTranscript = '';

      if (!finalText) { toast('🎤 Tap the orb or say "Hey JARVIS"!'); return; }

      // 1. Stop command - cancel TTS immediately, highest priority
      if (typeof isStopCommand !== 'undefined' && isStopCommand(finalText)) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        toast('🔇 JARVIS stopped');
        addMsg('assistant', 'Stopped. Ready when you are!', false);
        return;
      }

      // 2. Check explicit language switch command FIRST ("switch to kannada")
      if (typeof checkLangSwitch !== 'undefined') {
        const switchTo = checkLangSwitch(finalText);
        if (switchTo !== null) {
          _currentLang = switchTo;
          
          if (switchTo === 'en') {
            rec.lang = 'en-IN';
            localStorage.setItem('jarvis_lang', 'en');
            addMsg('assistant', '🇬🇧 Switched to English mode!', false);
            speak('Switched to English mode!', 'en-IN');
          } else {
            rec.lang = LANG_MAP[switchTo].voiceCode;
            localStorage.setItem('jarvis_lang', switchTo);
            addMsg('assistant', '🌐 Switched to ' + LANG_MAP[switchTo].label + ' mode!', false);
            speak('Switched to ' + LANG_MAP[switchTo].label + ' mode!', 'en-IN');
          }
          toast('🌐 Language: ' + (LANG_MAP[switchTo]?.label || 'English'));
          return; // don't send to n8n
        }
      }

      // 3. Auto-detect language from what user said
      if (typeof detectLanguage !== 'undefined') {
        const detected = detectLanguage(finalText);
        if (detected.code !== 'en') {
          if (_currentLang !== detected.code) {
            toast('🌐 ' + detected.label + ' detected!');
          }
          _currentLang = detected.code;
          rec.lang = detected.voiceCode;
          localStorage.setItem('jarvis_lang', detected.code);
        } else {
          // Keep it whatever it is, or switch to English if you want:
          // _currentLang = 'en';
        }
      }

      // Send to n8n (prepends happen centrally inside send() now)
      if (!busy) send(finalText, finalText);

    };

  } else {
    el.orbHint.textContent = 'VOICE UNAVAILABLE';
    el.micBtn.disabled = true;
    setTimeout(() =>
      addMsg('assistant',
        '⚠️ Voice input not supported in this browser.\n' +
        'Please use Google Chrome or Microsoft Edge for voice features.', true),
      1500
    );
  }



  function toggleListen() {
    if (!rec) return;
    if (listening) {
      rec.stop();
      return;
    }
    // Fresh start
    _voiceTranscript   = '';
    el.textInput.value = '';
    el.charCount.textContent = '0 chars';
    try {
      rec.start();
    } catch (startErr) {
      console.warn('[JARVIS mic] start failed, aborting & retrying:', startErr);
      try {
        rec.abort();
        setTimeout(() => {
          _voiceTranscript = '';
          rec.start();
        }, 400);
      } catch (_) {}
    }
  }

  el.orbBtn.addEventListener('click', () => {
    // If JARVIS is speaking → stop immediately (user priority!)
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      toast('🔇 JARVIS stopped');
      return;
    }
    toggleListen();
  });
  el.micBtn.addEventListener('click', () => {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      toast('🔇 JARVIS stopped');
      return;
    }
    toggleListen();
  });
  const mobOrb = $('mobOrbBtn');
  if (mobOrb) mobOrb.addEventListener('click', () => {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      return;
    }
    toggleListen();
  });

  /* ── SPEECH SYNTHESIS — JARVIS VOICE ENGINE ──────────────── */
  let voices = [];
  let _currentLang = 'en';   // tracks what language user last spoke

  /* --- Language detector ------------------------------------ */
  // Handles BOTH cases:
  // 1. Chrome rec.lang=en-IN  → returns Roman transliteration → match romanized words
  // 2. Chrome rec.lang=kn-IN  → returns Unicode Kannada script → match Unicode ranges
  const LANG_MAP = {
    'hi': {
      code:      'hi-IN',
      voiceCode: 'hi-IN',
      label:     'Hindi',
      patterns: /[\u0900-\u097F]|\b(kya|nahi|nhi|hai|hain|aap|apna|main|mujhe|hum|mera|meri|mere|tera|tere|yeh|ye|woh|wo|kab|kahan|kyun|kyu|kaisa|kaise|theek|thik|accha|acha|bhai|yaar|karo|bolo|suno|dekho|kal|aaj|abhi|bohot|bahut|matlab|samajh|pata|kuch|koi|sab|tum|haan|han|thoda|zyada|zaroor|bilkul|sunao|batao|karke|hogaya|kitna|kitne|bahot|chalega|chal|ruka|sunle|dekh|bata|kar|de|le|bol|gaya|aya|raha|rahe)\b/i,
    },
    'te': {
      code:      'te-IN',
      voiceCode: 'te-IN',
      label:     'Telugu',
      patterns: /[\u0C00-\u0C7F]|\b(nenu|meeru|miru|emi|ela|endi|ikkade|akkade|manchi|manchiga|kadu|avunu|ledu|ledhu|vaddu|cheppandi|vastundi|untundi|cheyali|cheyyali|undi|ayindi|chesanu|chestanu|antunna|unnadu|velli|vachanu|antha|anni|evaru|ekkada|telugu|anduke|kaadu|chudandi|pampandi|cheyandi|okasari|inkosari|telusa|naaku|maku|meeku)\b/i,
    },
    'kn': {
      code:      'kn-IN',
      voiceCode: 'kn-IN',
      label:     'Kannada',
      // Unicode range [\u0C80-\u0CFF] covers Kannada script (returned when rec.lang=kn-IN)
      // Romanized words cover what en-IN returns for spoken Kannada
      patterns: /[\u0C80-\u0CFF]|\b(nimma|nanna|naanu|neevu|avaru|avalu|avanu|yenu|enu|yelli|elli|hege|yaavaga|yavaga|yaru|ide|idhe|illa|ille|aaga|banni|hogali|hogi|beda|sari|sariye|alla|alva|bartha|hogtha|madtha|heltha|gottilla|gottu|madona|helu|kelu|nodi|nodo|maadi|maadona|kannada|bengaluru|bangalore|karnataka|hoda|bandha|swlpa|sulpa|enu|naanu|nimdu|nindu|avge|avrig|ilt|ildh)\b/i,
    },
    'ta': {
      code:      'ta-IN',
      voiceCode: 'ta-IN',
      label:     'Tamil',
      patterns: /[\u0B80-\u0BFF]|\b(enna|yenna|naan|neenga|eppadi|enga|yaar|vanakkam|sollunga|parunga|theriyuma|romba|konjam|seri|seriya|illa|aamam|vanga|ponga|sollu|paru|solren|irukken|teriyum|puriyala|mudiyadhu|pannunga|solla|pesura|aama|machan|kanda)\b/i,
    },
  };

  function detectLanguage(text) {
    const t = text.toLowerCase();
    for (const [code, cfg] of Object.entries(LANG_MAP)) {
      if (cfg.patterns.test(t)) return { code, voiceCode: cfg.code, label: cfg.label };
    }
    return { code: 'en', voiceCode: 'en-IN', label: 'English' };
  }

  /* ── RESTORE SAVED LANGUAGE (safe here — LANG_MAP is declared above) ── */
  (function restoreSavedLang() {
    const saved = localStorage.getItem('jarvis_lang') || 'en';
    if (saved !== 'en' && LANG_MAP[saved]) {
      _currentLang = saved;
      if (rec) rec.lang = LANG_MAP[saved].voiceCode;
      console.log('[JARVIS] Restored language:', LANG_MAP[saved].label, '→', LANG_MAP[saved].voiceCode);
    }
  })();


  // Explicit language switch commands — user can say "switch to kannada" anytime
  const LANG_SWITCH_MAP = {
    'kn': /\b(switch to kannada|kannada mode|speak kannada|kannada lo|kn mode|कन्नड़|स्विच टू कनाडा|ಕನ್ನಡ|ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಿ)\b/i,
    'hi': /\b(switch to hindi|hindi mode|speak hindi|hindi mein|hin mode|हिंदी|स्विच टू हिंदी|ಹಿಂದಿ|ಹಿಂದಿಗೆ ಬದಲಿಸಿ)\b/i,
    'te': /\b(switch to telugu|telugu mode|speak telugu|telugu lo|te mode|తెలుగు)\b/i,
    'ta': /\b(switch to tamil|tamil mode|speak tamil|tamil la|ta mode|தமிழ்)\b/i,
    'en': /\b(switch to english|english mode|speak english|back to english|en mode|स्विच टू इंग्लिश|अंग्रेज़ी|इंग्लिश|ಇಂಗ್ಲಿಷ್|ಇಂಗ್ಲಿಷ್‌ಗೆ ಬದಲಿಸಿ)\b/i,
  };

  function checkLangSwitch(text) {
    for (const [code, pattern] of Object.entries(LANG_SWITCH_MAP)) {
      if (pattern.test(text)) return code;
    }
    return null;
  }

  // Language instructions for n8n — request pure native language response
  const HOOKS = " If user asks to play a song, do NOT output OPEN_APP:spotify. Output [ACTION:LOCAL_MUSIC:EnglishSongName]. If user asks to switch to English or speak English, output [ACTION:SWITCH_LANG:en].";
  const LANG_INSTRUCTIONS = {
    'hi': '[भाषा निर्देश: उपयोगकर्ता हिंदी में बात कर रहा है। आप शुद्ध हिंदी में जवाब दें — देवनागरी लिपि में लिखें। अंग्रेज़ी शब्द बिल्कुल मत मिलाएं।' + HOOKS + '] User message:',
    'te': '[LANGUAGE: User spoke in Telugu. Reply in pure Telugu using Telugu script (తెలుగు). Do NOT mix English.' + HOOKS + '] User message:',
    'kn': '[LANGUAGE: User spoke in Kannada. Reply in pure Kannada using Kannada script (ಕನ್ನಡ). Do NOT mix English.' + HOOKS + '] User message:',
    'ta': '[LANGUAGE: User spoke in Tamil. Reply in pure Tamil using Tamil script (தமிழ்). Do NOT mix English.' + HOOKS + '] User message:',
  };


  /* --- Best JARVIS voice selector --------------------------- */
  function getJarvisVoice(langCode) {
    if (!voices.length) return null;
    const lang = langCode || 'en-US';

    // For non-English: find matching language voice
    if (!lang.startsWith('en')) {
      return voices.find(v => v.lang === lang && v.name.includes('Google')) ||
             voices.find(v => v.lang === lang) ||
             voices.find(v => v.lang.startsWith(lang.split('-')[0])) ||
             voices.find(v => v.name.includes('Hindi') || v.name.includes('Hemant') || v.name.includes('Kalpana')) ||
             null;
    }

    // For English: deep male JARVIS-like voice priority list
    const deepMalePrefs = [
      v => v.name === 'Google UK English Male',
      v => v.name.includes('Daniel')   && v.lang.startsWith('en'),   // macOS/iOS deep
      v => v.name.includes('David')    && v.lang.startsWith('en'),   // Microsoft David
      v => v.name.includes('James')    && v.lang.startsWith('en'),
      v => v.name.includes('Gordon')   && v.lang.startsWith('en'),
      v => v.name.includes('Arthur')   && v.lang.startsWith('en'),
      v => v.name.includes('UK')       && v.lang.startsWith('en') && !v.name.toLowerCase().includes('female'),
      v => v.name.includes('Google')   && v.lang.startsWith('en-GB'),
      v => v.name.includes('Google')   && v.lang.startsWith('en')  && !v.name.toLowerCase().includes('female'),
      v => v.lang.startsWith('en-GB')  && !v.name.toLowerCase().includes('female'),
      v => v.lang.startsWith('en-US')  && !v.name.toLowerCase().includes('female'),
      v => v.lang.startsWith('en'),
    ];
    for (const pref of deepMalePrefs) {
      const match = voices.find(pref);
      if (match) return match;
    }
    return voices[0];
  }

  /* --- Smart TTS trimmer ------------------------------------ */
  // Reads only the KEY point — not the full formatted wall of text
  function trimForSpeech(text) {
    // 1. Strip markdown / emojis / formatting chars
    let clean = text
      .replace(/━+/g, '. ')
      .replace(/\*\*/g, '').replace(/\*/g, '')
      .replace(/#+\s/g, '').replace(/__/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[⚡🚀🌡️📊📈💧💨👁️🗺️📞🇬🇧✅❌⚠️━🎵🎶🔇🌤️🌐]/g, '')
      .replace(/\|[^|]+\|/g, '')    // strip table rows
      .replace(/[-]{3,}/g, '')       // strip dividers
      .replace(/\n+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // 2. Split into sentences (added Hindi full stop । )
    const sentences = clean
      .split(/(?<=[.!?।])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 8 && !/^[:\-|]/.test(s));

    if (!sentences.length) return clean.slice(0, 220);

    // 3. Weather — say temp + condition + wind/humidity + advice (4 data points)
    if (/temperature|humidity|wind|forecast|तापमान|मौसम/i.test(clean)) {
      const advice = sentences[sentences.length - 1];
      const data   = sentences.filter(s => /degree|celsius|humid|wind|condition|डिग्री|तापमान/i.test(s));
      const intro  = sentences[0];
      const parts  = [intro];
      if (data[0] && data[0] !== intro) parts.push(data[0]);
      if (advice && advice !== intro)   parts.push(advice);
      return parts.join('. ').slice(0, 280);
    }

    // 4. Lists / bullet info — read first 3 items
    const listItems = clean.match(/(?:^|\n)\s*[-•*\d.]+\s+(.+)/gm);
    if (listItems && listItems.length > 2) {
      const items = listItems.slice(0, 3).map(s => s.replace(/^\s*[-•*\d.]+\s+/, ''));
      return 'Here are some: ' + items.join('. ');
    }

    // 5. General replies — first 3 sentences, max 280 chars
    let result = sentences.slice(0, 3).join(' ');
    if (result.length > 280) result = result.slice(0, 277) + '...';
    return result;
  }

  /* --- Main JARVIS speak function --------------------------- */
  function speak(text, langCode) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const trimmed = trimForSpeech(text);
    if (!trimmed) return;

    // Determine language — explicit param overrides, else use current session lang
    const activeLangCode = langCode ||
      (_currentLang !== 'en' ? LANG_MAP[_currentLang]?.voiceCode : null) ||
      'en-IN';

    const utter = new SpeechSynthesisUtterance(trimmed);

    // CRITICAL: set utter.lang so Chrome picks the right voice automatically
    utter.lang   = activeLangCode;
    const voice  = getJarvisVoice(activeLangCode);
    if (voice) utter.voice = voice;

    if (activeLangCode.startsWith('en')) {
      // JARVIS English voice — deep male
      utter.rate  = 1.0;
      utter.pitch = 0.72;
    } else {
      // Native language voice — natural speed and pitch
      utter.rate  = 0.95;
      utter.pitch = 1.0;
    }
    utter.volume = 1.0;

    window.speechSynthesis.speak(utter);
    console.log('[JARVIS TTS] lang:', activeLangCode, '|', trimmed.slice(0, 80));
  }


  /* --- Keyboard stop shortcut (Escape = stop JARVIS) -------- */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
      toast('🔇 JARVIS stopped');
    }
  });

  /* --- Load voices ------------------------------------------ */
  function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      const best = getJarvisVoice('en-US');
      console.log('[JARVIS TTS] Best voice selected:', best?.name, best?.lang);
    }
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }

  /* --- Intercept stop/pause commands in voice input --------- */
  // These are handled BEFORE sending to n8n
  function isStopCommand(text) {
    return /^(stop|pause|quiet|silence|shut up|stop talking|stop reading|enough|ok stop|stop jarvis|jarvis stop)\s*[.!]?$/i.test(text.trim());
  }


  /* ── WELCOME TYPEWRITER ──────────────────────────────────── */
  const name    = (DATA.me && DATA.me.name && DATA.me.name.split(' ')[0]) || 'Shubham';
  const WELCOME = 'Good to see you, ' + name + '. I\'m J.A.R.V.I.S. — your personal AI. How can I assist you today?';
  (function welcome() {
    let i=0; el.welcomeText.textContent='';
    const tid = setInterval(()=>{
      if (i<WELCOME.length) el.welcomeText.textContent+=WELCOME[i++];
      else clearInterval(tid);
    }, 30);
  })();

  /* ── N8N CONNECTION TEST ─────────────────────────────────── */
  if (WEBHOOK) {
    fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatInput: '__ping__', sessionId: 'ping-test' }),
    })
    .then(r => {
      if (r.ok) { setStatus('connected', 'ONLINE'); toast('✅ JARVIS backend connected!'); }
      else       { setStatus('error', 'BACKEND ERROR'); toast('⚠️ n8n returned '+r.status+' — check workflow is Published'); }
    })
    .catch(() => {
      setStatus('error', 'OFFLINE');
      toast('⚠️ n8n not reachable — make sure it is running on port 5678');
    });
  }

  console.log('[J.A.R.V.I.S] System online. Session:', sessionId);
  console.log('[J.A.R.V.I.S] Personal data loaded:', !!window.JARVIS_PERSONAL);
  console.log('[J.A.R.V.I.S] Language mode:', _currentLang, '| Mic lang:', rec?.lang);

  // Start always-on wake word listener after 2s (lets page settle first)
  setTimeout(() => {
    startWakeWord();
    el.orbHint.textContent = 'SAY "HEY JARVIS" OR TAP';
    console.log('[J.A.R.V.I.S] Wake word listener armed — say "Hey JARVIS"!');
  }, 2000);

})();

