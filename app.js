const API_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const eqAudio = $('eqAudio');
const stationList = $('stationList');
const statusText = $('statusText');
const listTitle = $('listTitle');
const searchInput = $('searchInput');
const clearSearch = $('clearSearch');
const favoritesToggle = $('favoritesToggle');
const loadMoreBtn = $('loadMoreBtn');
const playBtn = $('playBtn');
const miniPlayBtn = $('miniPlayBtn');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const nowName = $('nowName');
const nowDetails = $('nowDetails');
const nowStatus = $('nowStatus');
const nowCover = $('nowCover');
const miniPlayer = $('miniPlayer');
const miniName = $('miniName');
const miniStatus = $('miniStatus');
const miniCover = $('miniCover');
const featuredRail = $('featuredRail');
const featuredSection = $('featuredSection');
const historySection = $('historySection');
const historyRail = $('historyRail');
const sleepBadge = $('sleepBadge');
const settingsDialog = $('settingsDialog');
const addStationDialog = $('addStationDialog');
const eqToggle = $('eqToggle');
const eqHint = $('eqHint');
const cancelSleepBtn = $('cancelSleepBtn');
const toast = $('toast');

let stations = [];
let visibleStations = [];
let featuredStations = [];
let currentStation = null;
let currentIndex = -1;
let currentMode = 'popular';
let showFavoritesOnly = false;
let offset = 0;
let searchTimer = null;
let activeServer = API_SERVERS[0];
let toastTimer = null;
let sleepTimeout = null;
let sleepInterval = null;
let sleepEndsAt = null;
let eqEnabled = false;
let eqGraphReady = false;
let audioContext = null;
let eqFilters = [];
let eqPreset = localStorage.getItem('radioEqPreset') || 'flat';
const pageSize = 30;

const favorites = new Set(safeParse('radioFavorites', []));
const stationCache = safeParse('radioStationCache', {});
let history = safeParse('radioHistory', []);
let customStations = safeParse('radioCustomStations', []);


const modeConfig = {
  popular: { title: 'Популярные станции', params: { order: 'clickcount', reverse: 'true' } },
  ru: { title: 'Радиостанции России', params: { countrycode: 'RU', order: 'clickcount', reverse: 'true' } },
  de: { title: 'Радиостанции Германии', params: { countrycode: 'DE', order: 'clickcount', reverse: 'true' } },
  rock: { title: 'Рок', params: { tag: 'rock', order: 'clickcount', reverse: 'true' } },
  electronic: { title: 'Электронная музыка', params: { tag: 'electronic', order: 'clickcount', reverse: 'true' } },
  jazz: { title: 'Джаз', params: { tag: 'jazz', order: 'clickcount', reverse: 'true' } },
  chillout: { title: 'Chillout', params: { tag: 'chillout', order: 'clickcount', reverse: 'true' } },
  news: { title: 'Новости', params: { tag: 'news', order: 'clickcount', reverse: 'true' } },
};

const EQ_PRESETS = {
  flat:   [0, 0, 0],
  bass:   [6, 1, -1],
  voice:  [-2, 4, 1],
  bright: [-1, 1, 5],
};

function safeParse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveFavorites() { localStorage.setItem('radioFavorites', JSON.stringify([...favorites])); }
function saveCache() { localStorage.setItem('radioStationCache', JSON.stringify(stationCache)); }
function saveHistory() { localStorage.setItem('radioHistory', JSON.stringify(history)); }
function saveCustomStations() { localStorage.setItem('radioCustomStations', JSON.stringify(customStations)); }

function cleanStation(s) {
  return {
    stationuuid: String(s.stationuuid || ''),
    name: s.name?.trim() || 'Без названия',
    url: s.url_resolved || s.url || '',
    favicon: s.favicon || '',
    countrycode: s.countrycode || '',
    country: s.country || '',
    language: s.language || '',
    tags: s.tags || '',
    codec: s.codec || '',
    bitrate: Number(s.bitrate || 0),
    votes: Number(s.votes || 0),
    custom: Boolean(s.custom),
  };
}

async function apiFetch(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  let lastError;
  for (const server of [activeServer, ...API_SERVERS.filter(s => s !== activeServer)]) {
    try {
      const response = await fetch(`${server}${path}${qs ? `?${qs}` : ''}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      activeServer = server;
      return await response.json();
    } catch (err) { lastError = err; }
  }
  throw lastError || new Error('Сервис радиостанций недоступен');
}

async function loadFeatured() {
  featuredRail.innerHTML = '<div class="empty">Загружаем…</div>';
  try {
    const data = await apiFetch('/json/stations/search', {
      countrycode: 'RU', order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: '10'
    });
    featuredStations = data.map(cleanStation).filter(validStation);
    featuredStations.forEach(cacheStation);
    renderRail(featuredRail, featuredStations, 'featured');
  } catch (err) {
    featuredSection.hidden = true;
  }
}

async function loadStations({ append = false, search = '' } = {}) {
  if (showFavoritesOnly) return renderFavorites();
  if (currentMode === 'custom') return renderCustomStations();

  statusText.textContent = 'Загрузка…';
  if (!append) {
    offset = 0;
    stationList.innerHTML = '<div class="empty">Ищем станции…</div>';
  }

  try {
    const config = modeConfig[currentMode] || modeConfig.popular;
    const params = {
      ...config.params,
      hidebroken: 'true',
      limit: String(pageSize),
      offset: String(offset),
    };
    if (search) {
      params.name = search;
      delete params.tag;
      delete params.countrycode;
      params.order = 'clickcount';
      params.reverse = 'true';
    }

    const data = await apiFetch('/json/stations/search', params);
    const cleaned = data.map(cleanStation).filter(validStation);
    cleaned.forEach(cacheStation);
    saveCache();

    stations = append ? uniqueByUuid([...stations, ...cleaned]) : cleaned;
    visibleStations = stations;
    offset += cleaned.length;
    listTitle.textContent = search ? `Поиск: ${search}` : config.title;
    statusText.textContent = `${stations.length} станц.`;
    loadMoreBtn.hidden = cleaned.length < pageSize || Boolean(search);
    renderStations();
  } catch (err) {
    console.error(err);
    statusText.textContent = 'Ошибка';
    stationList.innerHTML = `
      <div class="error-card">
        Не удалось загрузить каталог. Проверьте интернет-соединение.<br>
        <button id="retryBtn">Повторить</button>
      </div>`;
    $('retryBtn')?.addEventListener('click', () => loadStations({ search: searchInput.value.trim() }));
  }
}

function validStation(s) {
  return s.stationuuid && s.url && /^https?:\/\//i.test(s.url);
}
function uniqueByUuid(arr) {
  const seen = new Set();
  return arr.filter(s => s && !seen.has(s.stationuuid) && seen.add(s.stationuuid));
}
function cacheStation(s) {
  if (s?.stationuuid) stationCache[s.stationuuid] = s;
}

function renderStations() {
  if (!visibleStations.length) {
    stationList.innerHTML = '<div class="empty">Ничего не найдено.</div>';
    return;
  }

  stationList.innerHTML = visibleStations.map((s, index) => stationCardHtml(s, index)).join('');

  stationList.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.play);
      const station = visibleStations[index];
      if (currentStation?.stationuuid === station.stationuuid && !activeAudio().paused) pauseRadio();
      else playStation(station, index);
    });
  });
  stationList.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(btn.dataset.fav);
    });
  });
  stationList.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCustomStation(btn.dataset.delete);
    });
  });
  stationList.querySelectorAll('.station-card').forEach(card => {
    card.addEventListener('click', () => playStation(visibleStations[Number(card.dataset.index)], Number(card.dataset.index)));
  });
  wireLogoFallbacks(stationList);
}

function stationCardHtml(s, index) {
  const isFav = favorites.has(s.stationuuid);
  const isPlaying = currentStation?.stationuuid === s.stationuuid;
  const meta = [s.countrycode || (s.custom ? 'МОЯ' : ''), s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' · ');
  return `
    <article class="station-card ${isPlaying ? 'playing' : ''}" data-index="${index}">
      <div class="station-logo">${logoMarkup(s)}</div>
      <div class="station-main">
        <span class="station-name">${escapeHtml(s.name)}</span>
        <span class="station-desc">${escapeHtml(meta || firstTags(s) || 'Интернет-радио')}</span>
      </div>
      <div class="station-actions">
        ${s.custom ? `<button class="delete-btn" data-delete="${escapeAttr(s.stationuuid)}" aria-label="Удалить станцию">×</button>` : ''}
        <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${escapeAttr(s.stationuuid)}" aria-label="В избранное">♥</button>
        <button class="play-card-btn" data-play="${index}" aria-label="Воспроизвести">${isPlaying && !activeAudio().paused ? '❚❚' : '▶'}</button>
      </div>
    </article>`;
}

function renderRail(container, items, source) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">Пока пусто.</div>';
    return;
  }
  container.innerHTML = items.map((s, i) => `
    <button class="rail-card ${currentStation?.stationuuid === s.stationuuid ? 'playing' : ''}" type="button" data-rail-source="${source}" data-rail-index="${i}">
      <span class="rail-logo">${logoMarkup(s, true)}</span>
      <span class="rail-name">${escapeHtml(s.name)}</span>
      <span class="rail-meta">${escapeHtml(s.countrycode || firstTags(s) || 'Радио')}</span>
    </button>`).join('');
  container.querySelectorAll('[data-rail-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceItems = btn.dataset.railSource === 'history' ? historyStations() : featuredStations;
      const station = sourceItems[Number(btn.dataset.railIndex)];
      if (station) playStation(station, visibleStations.findIndex(s => s.stationuuid === station.stationuuid));
    });
  });
  wireLogoFallbacks(container);
}

function renderFavorites() {
  visibleStations = [...favorites].map(id => stationCache[id]).filter(Boolean);
  listTitle.textContent = 'Избранное';
  statusText.textContent = `${visibleStations.length} станц.`;
  loadMoreBtn.hidden = true;
  renderStations();
}
function renderCustomStations() {
  visibleStations = customStations.map(cleanStation);
  listTitle.textContent = 'Мои станции';
  statusText.textContent = `${visibleStations.length} станц.`;
  loadMoreBtn.hidden = true;
  renderStations();
}
function historyStations() {
  return history.map(id => stationCache[id]).filter(Boolean);
}
function renderHistory() {
  const items = historyStations();
  historySection.hidden = !items.length;
  if (items.length) renderRail(historyRail, items, 'history');
}

function toggleFavorite(uuid) {
  if (favorites.has(uuid)) favorites.delete(uuid); else favorites.add(uuid);
  saveFavorites();
  showToast(favorites.has(uuid) ? 'Добавлено в избранное' : 'Удалено из избранного');
  showFavoritesOnly ? renderFavorites() : renderStations();
}

async function playStation(station, index = -1) {
  if (!station?.url) return;
  audio.pause();
  eqAudio.pause();
  currentStation = station;
  cacheStation(station);
  saveCache();
  currentIndex = index >= 0 ? index : visibleStations.findIndex(s => s.stationuuid === station.stationuuid);
  updateNowPlaying('Подключение…');

  let player = audio;
  if (eqEnabled) {
    const compatible = await canUseCorsStream(station.url);
    if (compatible) {
      try {
        await ensureEqGraph();
        player = eqAudio;
        audio.pause();
      } catch (err) {
        console.warn('EQ unavailable', err);
        eqEnabled = false;
        eqToggle.checked = false;
        updateEqUi('Эквалайзер недоступен в этом браузере');
        player = audio;
      }
    } else {
      eqEnabled = false;
      eqToggle.checked = false;
      updateEqUi('Этот поток не поддерживает эквалайзер');
      showToast('Для этой станции эквалайзер недоступен');
      player = audio;
    }
  } else {
    eqAudio.pause();
  }

  if (player.src !== station.url) {
    player.src = station.url;
    player.load();
  }

  try {
    await player.play();
    updateNowPlaying('В эфире');
    addToHistory(station);
    reportClick(station.stationuuid);
  } catch (err) {
    console.error(err);
    updateNowPlaying('Не удалось запустить поток');
    showToast('Поток станции сейчас не воспроизводится');
  }
  renderAllPlayingStates();
}

function activeAudio() { return eqEnabled && !eqAudio.paused ? eqAudio : audio; }
function pauseRadio() {
  audio.pause();
  eqAudio.pause();
  updateNowPlaying('Пауза');
  renderAllPlayingStates();
}
function togglePlay() {
  if (!currentStation) {
    if (visibleStations.length) playStation(visibleStations[0], 0);
    else if (featuredStations.length) playStation(featuredStations[0], -1);
    return;
  }
  if (activeAudio().paused) playStation(currentStation, currentIndex); else pauseRadio();
}

function updateNowPlaying(status) {
  const playing = currentStation && !activeAudio().paused;
  playBtn.textContent = playing ? '❚❚' : '▶';
  miniPlayBtn.textContent = playing ? '❚❚' : '▶';
  if (!currentStation) return;

  const detail = [currentStation.country || currentStation.countrycode, firstTags(currentStation)].filter(Boolean).join(' · ');
  nowStatus.textContent = status;
  nowName.textContent = currentStation.name;
  nowDetails.textContent = detail || (currentStation.custom ? 'Моя станция' : 'Интернет-радио');
  miniName.textContent = currentStation.name;
  miniStatus.textContent = status + (eqEnabled ? ' · EQ' : '');
  miniPlayer.hidden = false;
  setCover(nowCover, currentStation);
  setCover(miniCover, currentStation);

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentStation.name,
        artist: detail || 'Интернет-радио',
        album: 'Моё Радио',
        artwork: currentStation.favicon ? [{ src: currentStation.favicon }] : []
      });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch (_) {}
  }
}

function normalizedLogoUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    // HTTPS pages cannot display HTTP station artwork because browsers block mixed content.
    // Try the HTTPS version first; if that host does not support it, the initials stay visible.
    if (window.location.protocol === 'https:' && parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

function logoMarkup(station, compact = false) {
  const fallback = `<span class="logo-fallback${compact ? ' compact' : ''}">${escapeHtml(initials(station.name))}</span>`;
  const src = normalizedLogoUrl(station.favicon);
  if (!src) return fallback;
  return `${fallback}<img class="station-logo-img" src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function wireLogoFallbacks(root) {
  root.querySelectorAll('.station-logo-img').forEach(img => {
    const fail = () => img.remove();
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function setCover(el, station) {
  const fallback = initials(station.name);
  const src = normalizedLogoUrl(station.favicon);
  el.style.backgroundImage = '';
  el.classList.remove('has-image');
  el.textContent = fallback;
  if (!src) return;

  const requestedStation = station.stationuuid;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    if (currentStation?.stationuuid !== requestedStation) return;
    el.style.backgroundImage = `url("${src.replaceAll('\"', '%22')}")`;
    el.classList.add('has-image');
    el.textContent = '';
  };
  img.onerror = () => {
    if (currentStation?.stationuuid !== requestedStation) return;
    el.style.backgroundImage = '';
    el.classList.remove('has-image');
    el.textContent = fallback;
  };
  img.src = src;
}
function firstTags(station) {
  return String(station.tags || '').split(',').map(s => s.trim()).filter(Boolean).slice(0,2).join(' · ');
}

function moveStation(direction) {
  const pool = visibleStations.length ? visibleStations : featuredStations;
  if (!pool.length) return;
  let i = pool.findIndex(s => s.stationuuid === currentStation?.stationuuid);
  if (i < 0) i = 0; else i = (i + direction + pool.length) % pool.length;
  playStation(pool[i], i);
}

function reportClick(uuid) {
  if (!uuid || String(uuid).startsWith('custom-')) return;
  fetch(`${activeServer}/json/url/${encodeURIComponent(uuid)}`).catch(() => {});
}

function addToHistory(station) {
  cacheStation(station);
  history = [station.stationuuid, ...history.filter(id => id !== station.stationuuid)].slice(0, 18);
  saveHistory();
  saveCache();
  renderHistory();
}
function clearHistory() {
  history = [];
  saveHistory();
  renderHistory();
  showToast('История очищена');
}

function addCustomStation(name, url, favicon) {
  const station = cleanStation({
    stationuuid: `custom-${Date.now()}`,
    name, url, url_resolved: url, favicon, custom: true, tags: 'моя станция'
  });
  customStations = [station, ...customStations];
  cacheStation(station);
  saveCustomStations();
  saveCache();
  showToast('Станция добавлена');
  setMode('custom');
  playStation(station, 0);
}
function deleteCustomStation(uuid) {
  customStations = customStations.filter(s => s.stationuuid !== uuid);
  favorites.delete(uuid);
  history = history.filter(id => id !== uuid);
  delete stationCache[uuid];
  saveCustomStations();
  saveFavorites();
  saveHistory();
  saveCache();
  renderCustomStations();
  renderHistory();
  showToast('Станция удалена');
}

function setMode(mode) {
  currentMode = mode;
  showFavoritesOnly = false;
  favoritesToggle.classList.remove('active');
  searchInput.value = '';
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.mode === mode));
  loadStations();
}

function startSleepTimer(minutes) {
  cancelSleepTimer(false);
  sleepEndsAt = Date.now() + minutes * 60_000;
  sleepTimeout = setTimeout(() => {
    pauseRadio();
    cancelSleepTimer(false);
    showToast('Таймер сна остановил радио');
  }, minutes * 60_000);
  sleepInterval = setInterval(updateSleepBadge, 1000);
  cancelSleepBtn.hidden = false;
  updateSleepBadge();
  settingsDialog.close();
  showToast(`Таймер сна: ${minutes} мин.`);
}
function cancelSleepTimer(notify = true) {
  clearTimeout(sleepTimeout);
  clearInterval(sleepInterval);
  sleepTimeout = sleepInterval = null;
  sleepEndsAt = null;
  sleepBadge.hidden = true;
  cancelSleepBtn.hidden = true;
  if (notify) showToast('Таймер сна отменён');
}
function updateSleepBadge() {
  if (!sleepEndsAt) return;
  const left = Math.max(0, sleepEndsAt - Date.now());
  const totalSec = Math.ceil(left / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  sleepBadge.textContent = `◷ ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  sleepBadge.hidden = false;
}

async function canUseCorsStream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { mode: 'cors', method: 'GET', signal: controller.signal, cache: 'no-store' });
    return response.ok || response.type === 'cors';
  } catch (_) { return false; }
  finally { clearTimeout(timer); controller.abort(); }
}

async function ensureEqGraph() {
  if (eqGraphReady) {
    if (audioContext?.state === 'suspended') await audioContext.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio unavailable');
  audioContext = new Ctx();
  const source = audioContext.createMediaElementSource(eqAudio);
  const low = audioContext.createBiquadFilter();
  const mid = audioContext.createBiquadFilter();
  const high = audioContext.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 180;
  mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.9;
  high.type = 'highshelf'; high.frequency.value = 5000;
  source.connect(low); low.connect(mid); mid.connect(high); high.connect(audioContext.destination);
  eqFilters = [low, mid, high];
  eqGraphReady = true;
  applyEqPreset(eqPreset);
  await audioContext.resume();
}

function applyEqPreset(name) {
  eqPreset = EQ_PRESETS[name] ? name : 'flat';
  localStorage.setItem('radioEqPreset', eqPreset);
  document.querySelectorAll('.preset').forEach(btn => btn.classList.toggle('active', btn.dataset.preset === eqPreset));
  if (!eqGraphReady) return;
  const gains = EQ_PRESETS[eqPreset];
  eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(gains[i], audioContext.currentTime, 0.03));
}

async function toggleEq(on) {
  if (!on) {
    eqEnabled = false;
    eqToggle.checked = false;
    updateEqUi('Включается для совместимых потоков');
    if (currentStation) {
      const wasPlaying = !eqAudio.paused;
      eqAudio.pause();
      if (wasPlaying) await playStation(currentStation, currentIndex);
    }
    return;
  }
  if (!currentStation) {
    eqToggle.checked = false;
    showToast('Сначала включите радиостанцию');
    return;
  }
  updateEqUi('Проверяем поток…');
  const compatible = await canUseCorsStream(currentStation.url);
  if (!compatible) {
    eqEnabled = false;
    eqToggle.checked = false;
    updateEqUi('Этот поток не поддерживает эквалайзер');
    showToast('Для этой станции эквалайзер недоступен');
    return;
  }
  try {
    eqEnabled = true;
    await ensureEqGraph();
    eqToggle.checked = true;
    updateEqUi(`Включён · ${presetLabel(eqPreset)}`);
    const wasPlaying = !audio.paused || !eqAudio.paused;
    audio.pause();
    if (wasPlaying) await playStation(currentStation, currentIndex);
  } catch (err) {
    console.error(err);
    eqEnabled = false;
    eqToggle.checked = false;
    updateEqUi('Эквалайзер недоступен');
  }
}
function updateEqUi(text) { eqHint.textContent = text; }
function presetLabel(name) { return ({ flat:'Обычный', bass:'Бас', voice:'Голос', bright:'Яркий' })[name] || 'Обычный'; }

function renderAllPlayingStates() {
  renderStations();
  if (featuredStations.length) renderRail(featuredRail, featuredStations, 'featured');
  renderHistory();
}

function initials(name) {
  return (name || 'R').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}
function escapeAttr(str = '') { return escapeHtml(String(str)).replace(/`/g, '&#096;'); }
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) setMode(chip.dataset.mode);
});
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  showFavoritesOnly = false;
  favoritesToggle.classList.remove('active');
  searchTimer = setTimeout(() => q ? loadStations({ search: q }) : loadStations(), 420);
});
clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  loadStations();
  searchInput.focus();
});
favoritesToggle.addEventListener('click', () => {
  showFavoritesOnly = !showFavoritesOnly;
  favoritesToggle.classList.toggle('active', showFavoritesOnly);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  if (showFavoritesOnly) renderFavorites(); else setMode(currentMode);
});
$('showRussiaBtn').addEventListener('click', () => setMode('ru'));
$('clearHistoryBtn').addEventListener('click', clearHistory);
loadMoreBtn.addEventListener('click', () => loadStations({ append: true }));
playBtn.addEventListener('click', togglePlay);
miniPlayBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', () => moveStation(-1));
nextBtn.addEventListener('click', () => moveStation(1));
$('miniOpenBtn').addEventListener('click', () => $('hero').scrollIntoView({ behavior:'smooth', block:'start' }));


$('settingsBtn').addEventListener('click', () => settingsDialog.showModal());
$('addStationBtn').addEventListener('click', () => addStationDialog.showModal());
$('closeAddStation').addEventListener('click', () => addStationDialog.close());
$('timerGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-minutes]');
  if (btn) startSleepTimer(Number(btn.dataset.minutes));
});
cancelSleepBtn.addEventListener('click', () => cancelSleepTimer(true));
eqToggle.addEventListener('change', () => toggleEq(eqToggle.checked));
$('presetGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  applyEqPreset(btn.dataset.preset);
  if (eqEnabled) updateEqUi(`Включён · ${presetLabel(eqPreset)}`);
});

$('addStationForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('customName').value.trim();
  const url = $('customUrl').value.trim();
  const favicon = $('customIcon').value.trim();
  const error = $('customFormError');
  if (!name || !/^https?:\/\//i.test(url) || (favicon && !/^https?:\/\//i.test(favicon))) {
    error.textContent = 'Проверьте название и ссылки. Ссылки должны начинаться с http:// или https://';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  addCustomStation(name, url, favicon);
  e.target.reset();
  addStationDialog.close();
});

[audio, eqAudio].forEach(player => {
  player.addEventListener('playing', () => { if (player === activeAudio()) updateNowPlaying('В эфире'); });
  player.addEventListener('pause', () => { if (currentStation && audio.paused && eqAudio.paused) updateNowPlaying('Пауза'); });
  player.addEventListener('waiting', () => { if (player === activeAudio() && currentStation) updateNowPlaying('Буферизация…'); });
  player.addEventListener('error', () => { if (player === activeAudio() && currentStation) updateNowPlaying('Ошибка потока'); });
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => currentStation && playStation(currentStation, currentIndex));
  navigator.mediaSession.setActionHandler('pause', pauseRadio);
  navigator.mediaSession.setActionHandler('previoustrack', () => moveStation(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => moveStation(1));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}

applyEqPreset(eqPreset);
renderHistory();
Promise.allSettled([loadFeatured(), loadStations()]);
