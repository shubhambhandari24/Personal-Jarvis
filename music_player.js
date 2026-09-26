// ================================================================
//  J.A.R.V.I.S — Offline Music Player v2
//  Reads MP3 ID3 tags (title/artist/album) so filenames don't matter
//  Persists folder access via IndexedDB (no re-picking every session)
// ================================================================
window.JARVIS_MUSIC = (function () {
  'use strict';

  let catalog    = [];   // [{title, artist, album, filename, handle}]
  let queue      = [];   // play queue (indexes into catalog)
  let queueIdx   = 0;
  let audio      = null;
  let currentURL = null;
  let isPlaying  = false;
  let _dirHandle = null; // persisted directory handle

  /* ── INDEXEDDB for persisting directory handle ───────────── */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jarvis-music-v2', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('data');
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const tx  = db.transaction('data', 'readwrite');
        const req = tx.objectStore('data').put(value, key);
        req.onsuccess = () => res();
        req.onerror   = () => rej(req.error);
      });
    } catch (e) { console.warn('[Music IDB set]', e); }
  }

  async function idbGet(key) {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const tx  = db.transaction('data', 'readonly');
        const req = tx.objectStore('data').get(key);
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
      });
    } catch (e) { return undefined; }
  }

  /* ── ID3 TAG READER ──────────────────────────────────────── */
  // Uses jsmediatags library if available, else falls back to filename
  function readID3Tags(file) {
    return new Promise(resolve => {
      if (typeof jsmediatags === 'undefined') {
        resolve({ title: '', artist: '', album: '' });
        return;
      }
      try {
        jsmediatags.read(file, {
          onSuccess: tag => resolve({
            title:  (tag.tags.title  || '').trim(),
            artist: (tag.tags.artist || '').trim(),
            album:  (tag.tags.album  || '').trim(),
          }),
          onError: () => resolve({ title: '', artist: '', album: '' }),
        });
      } catch {
        resolve({ title: '', artist: '', album: '' });
      }
    });
  }

  /* ── FILENAME FALLBACK PARSER ────────────────────────────── */
  function parseFilename(name) {
    const base = name.replace(/\.\w{2,5}$/, '').trim();
    // Remove track numbers: "01. ", "1 - ", etc.
    const noNum = base.replace(/^\d+[\s.\-–]+/, '').trim();
    // Split on " - " or " – "
    const parts = noNum.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
      return { title: parts.slice(1).join(' ').trim(), artist: parts[0].trim(), album: '' };
    }
    return { title: noNum || base, artist: '', album: '' };
  }

  /* ── AUDIO ELEMENT ───────────────────────────────────────── */
  function getAudio() {
    if (!audio) {
      audio = document.getElementById('jarvisAudio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'jarvisAudio';
        audio.preload = 'auto';
        document.body.appendChild(audio);
      }
      audio.addEventListener('ended',      () => nextSong(true));
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('error', e  => console.warn('[Music] Audio error', e));
    }
    return audio;
  }

  /* ── SCAN DIRECTORY RECURSIVELY ─────────────────────────── */
  async function scanDir(dirHandle, albumHint, progress) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        await scanDir(handle, name, progress);
        continue;
      }
      if (!/\.(mp3|m4a|flac|ogg|wav|aac|wma|opus)$/i.test(name)) continue;

      let title, artist, album;

      try {
        const file = await handle.getFile();
        const tags = await readID3Tags(file);

        // Prefer ID3 tags; fall back to filename parsing
        if (tags.title) {
          title  = tags.title;
          artist = tags.artist;
          album  = tags.album || albumHint || '';
        } else {
          const fb = parseFilename(name);
          title  = fb.title;
          artist = fb.artist;
          album  = albumHint || '';
        }
      } catch {
        const fb = parseFilename(name);
        title  = fb.title;
        artist = fb.artist;
        album  = albumHint || '';
      }

      catalog.push({ title, artist, album, filename: name, handle });
      if (progress && catalog.length % 10 === 0) progress(catalog.length);
    }
  }

  /* ── INDEX FOLDER ────────────────────────────────────────── */
  async function indexFolder(existingHandle) {
    if (!window.showDirectoryPicker && !existingHandle) {
      return { success: false, msg: 'File System API not supported. Use Chrome 86+.' };
    }
    try {
      let dir = existingHandle;
      if (!dir) {
        dir = await window.showDirectoryPicker({ mode: 'read' });
      }

      // Save handle to IndexedDB for next session
      _dirHandle = dir;
      await idbSet('musicDirHandle', dir);

      catalog = [];
      await scanDir(dir, '', null);

      // Save catalog metadata (not handles — those can't be JSON)
      const meta = catalog.map(s => ({ title: s.title, artist: s.artist, album: s.album, filename: s.filename }));
      localStorage.setItem('jarvis_music_meta', JSON.stringify(meta));

      console.log('[Music] Indexed', catalog.length, 'songs with ID3 tags');
      return { success: true, count: catalog.length, songs: catalog };

    } catch (e) {
      if (e.name === 'AbortError') return { success: false, msg: 'Folder picker cancelled.' };
      return { success: false, msg: e.message };
    }
  }

  /* ── AUTO RECONNECT on page load ────────────────────────── */
  // Tries to use the saved directory handle without showing full picker
  async function autoReconnect() {
    try {
      const savedHandle = await idbGet('musicDirHandle');
      if (!savedHandle) return false;

      // Ask Chrome to re-grant permission (shows small prompt, not full picker)
      const perm = await savedHandle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        _dirHandle = savedHandle;
        catalog = [];
        await scanDir(savedHandle, '', null);
        console.log('[Music] Auto-reconnected:', catalog.length, 'songs');
        return true;
      }

      // Permission needs explicit re-grant — keep handle ready for when user interacts
      _dirHandle = savedHandle;
      return false;
    } catch (e) {
      console.warn('[Music] Auto-reconnect failed:', e);
      return false;
    }
  }

  // Silently re-grant permission using saved handle (called after user gesture)
  async function reGrantAccess() {
    if (!_dirHandle) {
      const saved = await idbGet('musicDirHandle');
      if (!saved) return false;
      _dirHandle = saved;
    }
    try {
      const perm = await _dirHandle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        catalog = [];
        await scanDir(_dirHandle, '', null);
        console.log('[Music] Re-granted:', catalog.length, 'songs');
        return true;
      }
    } catch (e) { console.warn('[Music] Re-grant failed:', e); }
    return false;
  }

  /* ── FUZZY SEARCH ────────────────────────────────────────── */
  function normalize(s) {
    return (s || '').toLowerCase()
      .replace(/[^\w\s]/g, ' ')   // strip punctuation
      .replace(/\s+/g, ' ').trim();
  }

  function scoreMatch(song, query) {
    const q  = normalize(query);
    const t  = normalize(song.title);
    const a  = normalize(song.artist);
    const al = normalize(song.album);
    const fn = normalize(song.filename);
    let   s  = 0;

    if (t === q)                  s += 100;
    else if (t.startsWith(q))     s += 80;
    else if (t.includes(q))       s += 60;
    if (a.includes(q))            s += 45;
    if (al.includes(q))           s += 35;
    if (fn.includes(q))           s += 15;

    // Word-by-word partial matching
    q.split(' ').forEach(word => {
      if (word.length < 2) return;
      if (t.includes(word))  s += 20;
      if (a.includes(word))  s += 15;
      if (al.includes(word)) s += 10;
    });
    return s;
  }

  function findSongs(query) {
    if (!catalog.length || !query) return [];
    return catalog
      .map((song, i) => ({ song, i, s: scoreMatch(song, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => ({ ...x.song, idx: x.i }));
  }

  /* ── PLAYBACK ────────────────────────────────────────────── */
  async function playSong(idx) {
    if (idx < 0 || idx >= catalog.length) return { success: false, msg: 'Invalid index' };
    const song = catalog[idx];
    if (!song || !song.handle) return { success: false, msg: 'No file handle — please re-grant folder access.' };

    try {
      const file = await song.handle.getFile();
      if (currentURL) URL.revokeObjectURL(currentURL);
      currentURL = URL.createObjectURL(file);

      const a = getAudio();
      a.src   = currentURL;
      await a.play();
      isPlaying = true;
      if (!queue.includes(idx)) { queue = [idx]; queueIdx = 0; }
      else queueIdx = queue.indexOf(idx);

      updateNowPlaying(song);
      return { success: true, song };
    } catch (e) {
      return { success: false, msg: e.message };
    }
  }

  function pauseSong() {
    const a = getAudio();
    if (a.paused) { a.play(); isPlaying = true; }
    else          { a.pause(); isPlaying = false; }
    return isPlaying;
  }

  function stopSong() {
    const a = getAudio();
    a.pause(); a.currentTime = 0; isPlaying = false;
    if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
    clearNowPlaying();
  }

  function nextSong() {
    if (!queue.length) return;
    queueIdx = (queueIdx + 1) % queue.length;
    playSong(queue[queueIdx]);
  }

  function prevSong() {
    if (!queue.length) return;
    queueIdx = (queueIdx - 1 + queue.length) % queue.length;
    playSong(queue[queueIdx]);
  }

  function shufflePlay(songs) {
    const idxs = songs.map(s => s.idx !== undefined ? s.idx : catalog.indexOf(s))
                       .filter(i => i >= 0)
                       .sort(() => Math.random() - 0.5);
    queue    = idxs;
    queueIdx = 0;
    if (idxs.length) playSong(idxs[0]);
  }

  function getCurrentSong() {
    if (!queue.length) return null;
    return catalog[queue[queueIdx]] || null;
  }

  /* ── NOW PLAYING UI ──────────────────────────────────────── */
  function updateNowPlaying(song) {
    const bar = document.getElementById('nowPlayingBar');
    const ttl = document.getElementById('npTitle');
    const art = document.getElementById('npArtist');
    const pp  = document.getElementById('npPlayPause');
    if (bar) bar.classList.add('active');
    if (ttl) ttl.textContent = song.title  || song.filename;
    if (art) art.textContent = song.artist || 'Unknown';
    if (pp)  pp.textContent  = '⏸';
    document.title = '♪ ' + (song.title || 'Playing') + ' — JARVIS';
  }

  function clearNowPlaying() {
    const bar = document.getElementById('nowPlayingBar');
    if (bar) bar.classList.remove('active');
    document.title = 'J.A.R.V.I.S';
    const pp = document.getElementById('npPlayPause');
    if (pp) pp.textContent = '▶';
  }

  function updateProgress() {
    const bar = document.getElementById('npProgress');
    if (!bar || !audio || !audio.duration) return;
    bar.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
  }

  /* ── SAVED METADATA ──────────────────────────────────────── */
  function loadSavedMeta() {
    try {
      const d = localStorage.getItem('jarvis_music_meta');
      return d ? JSON.parse(d) : [];
    } catch { return []; }
  }

  /* ── NOW PLAYING BUTTON WIRING ───────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    const pp   = document.getElementById('npPlayPause');
    const nxt  = document.getElementById('npNext');
    const prv  = document.getElementById('npPrev');
    const stp  = document.getElementById('npStop');
    if (pp)  pp.addEventListener('click',  () => { const p = pauseSong(); pp.textContent = p ? '⏸' : '▶'; });
    if (nxt) nxt.addEventListener('click', () => nextSong());
    if (prv) prv.addEventListener('click', () => prevSong());
    if (stp) stp.addEventListener('click', () => stopSong());
  });

  /* ── AUTO RECONNECT ON LOAD ──────────────────────────────── */
  // Try silently in background; will succeed if permission still granted
  autoReconnect().then(ok => {
    if (ok) console.log('[Music] Background reconnect OK:', catalog.length, 'songs ready');
  });

  /* ── PUBLIC API ──────────────────────────────────────────── */
  return {
    indexFolder,
    reGrantAccess,
    autoReconnect,
    findSongs,
    playSong,
    pauseSong,
    stopSong,
    nextSong,
    prevSong,
    shufflePlay,
    getCurrentSong,
    loadSavedMeta,
    get catalog()   { return catalog; },
    get isPlaying() { return isPlaying; },
  };
})();