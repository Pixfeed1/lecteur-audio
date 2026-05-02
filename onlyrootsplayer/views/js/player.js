/**
 * OnlyRoots Persistent Audio Player — player.js (iframe-side, v3.0)
 *
 * The audio engine. Runs INSIDE the iframe loaded by frame.php, in a
 * fully isolated JS context (own window, own listeners, own timers).
 *
 * It does NOT run in the parent page. It cannot be tripped by theme
 * scripts, third-party module re-inits, AJAX races, or anything else
 * happening in the parent document. Its only contract with the
 * outside world is via postMessage with the parent's bridge.js.
 *
 * Public API (postMessage actions FROM bridge.js):
 *   - play-product   { idProduct }                    fetch tracks + play first
 *   - play-track     { idProduct, trackUrl, trackTitle, trackIndex }
 *   - preload-product{ idProduct }                    hover-preload
 *   - pause          {}                               pause current track
 *   - resume         {}                               resume current track
 *   - persist-now    {}                               flush state to localStorage
 *   - unlock         {}                               iOS audio unlock
 *
 * Outbound messages (TO bridge.js):
 *   - ready          { visible }                      sent on init (after state restore)
 *   - show           {}                               player should be visible
 *   - hide           {}                               player should be hidden
 *   - state          { idProduct, playing, ... }      track/state changed
 *   - navigate       { url }                          parent should navigate
 *
 * @author PixFeed - Marc Gueffie
 * @version 3.0.0
 */
(function () {
    'use strict';

    var CFG = window.orpFrameConfig || {};
    var PARENT_ORIGIN = CFG.parentOrigin || (window.parent && window.parent.location ? window.parent.origin : '*');
    var STORAGE_KEY = CFG.storageKey || 'orp_state_v3';
    var DEBUG = !!CFG.debug;

    function log() {
        if (!DEBUG) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[orp-player]');
        console.log.apply(console, args);
    }

    /* ------------------------------------------------------------ *
     *  DOM refs                                                    *
     * ------------------------------------------------------------ */

    var $player    = document.getElementById('orp-player');
    var $audio     = document.getElementById('orp-audio');
    var $cover     = document.getElementById('orp-cover');
    var $coverImg  = document.getElementById('orp-cover-img');
    var $coverPh   = document.getElementById('orp-cover-placeholder');
    var $title     = document.getElementById('orp-track-title');
    var $productName = document.getElementById('orp-product-name');
    var $productLink = document.getElementById('orp-product-link');
    var $counter   = document.getElementById('orp-track-counter');
    var $playBtn   = document.getElementById('orp-play');
    var $prevBtn   = document.getElementById('orp-prev');
    var $nextBtn   = document.getElementById('orp-next');
    var $closeBtn  = document.getElementById('orp-close');
    var $iconPlay  = $playBtn.querySelector('.orp-icon-play');
    var $iconPause = $playBtn.querySelector('.orp-icon-pause');
    var $progressBar = document.querySelector('.orp-progress-bar');
    var $progressFill = document.getElementById('orp-progress-fill');
    var $progressHandle = document.getElementById('orp-progress-handle');
    var $timeCurrent = document.getElementById('orp-time-current');
    var $timeTotal   = document.getElementById('orp-time-total');
    var $volBtn    = document.getElementById('orp-vol-btn');
    var $volBar    = document.querySelector('.orp-volume-bar');
    var $volFill   = document.getElementById('orp-volume-fill');
    var $iconVolOn = $volBtn.querySelector('.orp-icon-vol-on');
    var $iconVolOff = $volBtn.querySelector('.orp-icon-vol-off');

    /* ------------------------------------------------------------ *
     *  State                                                       *
     * ------------------------------------------------------------ */

    var state = {
        idProduct: 0,
        productName: '',
        productUrl: '',
        productImage: '',
        tracks: [],          // [{title, url, filename}]
        currentIndex: -1,
        playing: false,
        currentTime: 0,
        volume: 0.8,
        muted: false,
        visible: false
    };

    var lastPersist = 0;
    var persistThrottle = 1000; // save at most once per second

    /* ------------------------------------------------------------ *
     *  postMessage transport                                       *
     * ------------------------------------------------------------ */

    function sendToParent(action, payload) {
        try {
            window.parent.postMessage({
                source: 'orp-frame',
                action: action,
                payload: payload || {}
            }, PARENT_ORIGIN);
        } catch (e) {
            log('postMessage to parent failed', e);
        }
    }

    function broadcastState() {
        sendToParent('state', {
            idProduct: state.idProduct,
            playing: state.playing,
            currentIndex: state.currentIndex,
            trackIndex: state.currentIndex, // alias for bridge.js track sync (matches data-track-index in template)
            trackCount: state.tracks.length
        });
    }

    /* ------------------------------------------------------------ *
     *  localStorage persistence                                    *
     * ------------------------------------------------------------ */

    function loadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var s = JSON.parse(raw);
            if (!s || typeof s !== 'object') return null;
            return s;
        } catch (e) {
            return null;
        }
    }

    function persistState(force) {
        var now = Date.now();
        if (!force && now - lastPersist < persistThrottle) return;
        lastPersist = now;
        try {
            var snapshot = {
                idProduct: state.idProduct,
                productName: state.productName,
                productUrl: state.productUrl,
                productImage: state.productImage,
                tracks: state.tracks,
                currentIndex: state.currentIndex,
                currentTime: $audio ? $audio.currentTime : 0,
                volume: state.volume,
                muted: state.muted,
                visible: state.visible,
                playing: state.playing,
                ts: now
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch (e) {
            log('persist failed', e);
        }
    }

    function clearState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------ *
     *  UI updates                                                  *
     * ------------------------------------------------------------ */

    function showPlayer() {
        if (state.visible) return;
        state.visible = true;
        $player.style.display = '';
        $player.setAttribute('data-playing', state.playing ? 'true' : 'false');
        sendToParent('show', {});
    }

    function hidePlayer() {
        if (!state.visible) return;
        state.visible = false;
        $player.style.display = 'none';
        sendToParent('hide', {});
    }

    function updateUI() {
        var t = state.tracks[state.currentIndex];
        $title.textContent       = t ? t.title : '-';
        $productName.textContent = state.productName || '-';
        $counter.textContent = (state.tracks.length > 0)
            ? ((state.currentIndex + 1) + '/' + state.tracks.length)
            : '0/0';

        if (state.productUrl) {
            $productLink.href = state.productUrl;
            $productLink.title = state.productName || '';
        } else {
            $productLink.removeAttribute('href');
        }

        if (state.productImage) {
            $coverImg.src = state.productImage;
            $coverImg.alt = state.productName || '';
            $coverImg.style.display = '';
            $coverPh.style.display = 'none';
        } else {
            $coverImg.style.display = 'none';
            $coverImg.removeAttribute('src');
            $coverPh.style.display = '';
        }

        updatePlayPauseIcon();
        updateVolumeUI();
    }

    function updatePlayPauseIcon() {
        if (state.playing) {
            $iconPlay.style.display = 'none';
            $iconPause.style.display = '';
            $player.setAttribute('data-playing', 'true');
        } else {
            $iconPlay.style.display = '';
            $iconPause.style.display = 'none';
            $player.setAttribute('data-playing', 'false');
        }
    }

    function updateVolumeUI() {
        var pct = state.muted ? 0 : Math.round(state.volume * 100);
        $volFill.style.width = pct + '%';
        $volBar.setAttribute('aria-valuenow', String(pct));
        if (state.muted || state.volume === 0) {
            $iconVolOn.style.display = 'none';
            $iconVolOff.style.display = '';
        } else {
            $iconVolOn.style.display = '';
            $iconVolOff.style.display = 'none';
        }
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return m + ':' + (s < 10 ? '0' + s : s);
    }

    function updateProgress() {
        var dur = $audio.duration || 0;
        var cur = $audio.currentTime || 0;
        var pct = dur > 0 ? (cur / dur) * 100 : 0;
        $progressFill.style.width = pct + '%';
        $progressHandle.style.left = pct + '%';
        $timeCurrent.textContent = formatTime(cur);
        $timeTotal.textContent = formatTime(dur);
        $progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    }

    /* ------------------------------------------------------------ *
     *  Audio control                                               *
     * ------------------------------------------------------------ */

    function loadTrack(index, options) {
        if (index < 0 || index >= state.tracks.length) return;
        state.currentIndex = index;
        var track = state.tracks[index];
        $audio.src = track.url;
        if (options && options.startAt) {
            // Will be applied once metadata loads
            $audio._pendingStartAt = options.startAt;
        }
        updateUI();
    }

    function playTrack(index, options) {
        loadTrack(index, options);
        $audio.play().then(function () {
            state.playing = true;
            updatePlayPauseIcon();
            broadcastState();
            persistState(true);
            setMediaSessionMetadata();
        }).catch(function (err) {
            log('play() rejected', err);
            // Likely autoplay policy — wait for unlock
            state.playing = false;
            updatePlayPauseIcon();
        });
    }

    function togglePlay() {
        if (!state.tracks.length) return;
        if (state.currentIndex < 0) {
            playTrack(0);
            return;
        }
        if ($audio.paused) {
            $audio.play().then(function () {
                state.playing = true;
                updatePlayPauseIcon();
                broadcastState();
            }).catch(function (e) { log('resume failed', e); });
        } else {
            $audio.pause();
            state.playing = false;
            updatePlayPauseIcon();
            broadcastState();
            persistState(true);
        }
    }

    function next() {
        if (!state.tracks.length) return;
        var n = state.currentIndex + 1;
        if (n >= state.tracks.length) {
            // End of queue — stop
            $audio.pause();
            state.playing = false;
            updatePlayPauseIcon();
            broadcastState();
            return;
        }
        playTrack(n);
    }

    function prev() {
        if (!state.tracks.length) return;
        // If >3s into current track, restart current; else go back
        if ($audio.currentTime > 3) {
            $audio.currentTime = 0;
            return;
        }
        var p = state.currentIndex - 1;
        if (p < 0) p = 0;
        playTrack(p);
    }

    function setVolume(v) {
        v = Math.max(0, Math.min(1, v));
        state.volume = v;
        state.muted = false;
        $audio.volume = v;
        $audio.muted = false;
        updateVolumeUI();
        persistState();
    }

    function toggleMute() {
        state.muted = !state.muted;
        $audio.muted = state.muted;
        updateVolumeUI();
        persistState();
    }

    /* ------------------------------------------------------------ *
     *  Data fetching                                               *
     * ------------------------------------------------------------ */

    function fetchProduct(idProduct) {
        var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?')
                + 'id_product=' + idProduct;
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
    }

    function loadProductAndPlay(idProduct, options) {
        return fetchProduct(idProduct).then(function (data) {
            if (!data || !data.tracks || !data.tracks.length) return;
            state.idProduct    = data.id_product;
            state.productName  = data.name || '';
            state.productUrl   = data.url || '';
            state.productImage = data.image || '';
            state.tracks       = data.tracks;
            state.currentIndex = -1;
            var idx = (options && options.startIndex) ? options.startIndex : 0;
            playTrack(idx, options);
            showPlayer();
        }).catch(function (err) {
            log('fetchProduct failed', err);
        });
    }

    function preloadProduct(idProduct) {
        // Hover preload — just warm the API cache, don't change state
        if (!idProduct || idProduct === state.idProduct) return;
        var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?')
                + 'id_product=' + idProduct;
        try {
            fetch(url, { credentials: 'same-origin', priority: 'low' });
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------ *
     *  MediaSession API (OS-level media controls)                  *
     * ------------------------------------------------------------ */

    function setMediaSessionMetadata() {
        if (!('mediaSession' in navigator)) return;
        var t = state.tracks[state.currentIndex];
        if (!t) return;
        try {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: t.title || '',
                artist: state.productName || '',
                album: '',
                artwork: state.productImage ? [{
                    src: state.productImage,
                    sizes: '256x256',
                    type: 'image/jpeg'
                }] : []
            });
        } catch (e) { /* swallow */ }
    }

    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.setActionHandler('play',     function () { togglePlay(); });
            navigator.mediaSession.setActionHandler('pause',    function () { togglePlay(); });
            navigator.mediaSession.setActionHandler('previoustrack', function () { prev(); });
            navigator.mediaSession.setActionHandler('nexttrack',     function () { next(); });
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------ *
     *  Progress bar interaction                                    *
     * ------------------------------------------------------------ */

    function seekFromEvent(ev) {
        var rect = $progressBar.getBoundingClientRect();
        var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
        var pct = Math.max(0, Math.min(1, x / rect.width));
        if ($audio.duration && isFinite($audio.duration)) {
            $audio.currentTime = pct * $audio.duration;
        }
    }

    var dragging = false;
    $progressBar.addEventListener('mousedown', function (e) {
        dragging = true;
        seekFromEvent(e);
    });
    $progressBar.addEventListener('touchstart', function (e) {
        dragging = true;
        seekFromEvent(e);
    }, { passive: true });
    document.addEventListener('mousemove', function (e) {
        if (dragging) seekFromEvent(e);
    });
    document.addEventListener('touchmove', function (e) {
        if (dragging) seekFromEvent(e);
    }, { passive: true });
    document.addEventListener('mouseup',   function () { dragging = false; });
    document.addEventListener('touchend',  function () { dragging = false; });
    $progressBar.addEventListener('keydown', function (e) {
        if (!$audio.duration) return;
        if (e.key === 'ArrowLeft')  { $audio.currentTime = Math.max(0, $audio.currentTime - 5); e.preventDefault(); }
        if (e.key === 'ArrowRight') { $audio.currentTime = Math.min($audio.duration, $audio.currentTime + 5); e.preventDefault(); }
    });

    /* ------------------------------------------------------------ *
     *  Volume bar interaction                                      *
     * ------------------------------------------------------------ */

    function volumeFromEvent(ev) {
        var rect = $volBar.getBoundingClientRect();
        var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
        var pct = Math.max(0, Math.min(1, x / rect.width));
        setVolume(pct);
    }

    var draggingVol = false;
    $volBar.addEventListener('mousedown',  function (e) { draggingVol = true; volumeFromEvent(e); });
    $volBar.addEventListener('touchstart', function (e) { draggingVol = true; volumeFromEvent(e); }, { passive: true });
    document.addEventListener('mousemove', function (e) { if (draggingVol) volumeFromEvent(e); });
    document.addEventListener('touchmove', function (e) { if (draggingVol) volumeFromEvent(e); }, { passive: true });
    document.addEventListener('mouseup',   function () { draggingVol = false; });
    document.addEventListener('touchend',  function () { draggingVol = false; });
    $volBar.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft')  { setVolume(Math.max(0, state.volume - 0.05)); e.preventDefault(); }
        if (e.key === 'ArrowRight') { setVolume(Math.min(1, state.volume + 0.05)); e.preventDefault(); }
    });

    /* ------------------------------------------------------------ *
     *  Button bindings                                             *
     * ------------------------------------------------------------ */

    $playBtn.addEventListener('click', togglePlay);
    $prevBtn.addEventListener('click', prev);
    $nextBtn.addEventListener('click', next);
    $volBtn.addEventListener('click',  toggleMute);
    $closeBtn.addEventListener('click', function () {
        $audio.pause();
        state.playing = false;
        hidePlayer();
        broadcastState();
        persistState(true);
    });

    // Product-link click: ask parent to navigate (so the iframe doesn't
    // try to follow the link inside its own context)
    $productLink.addEventListener('click', function (e) {
        if (!state.productUrl) return;
        e.preventDefault();
        sendToParent('navigate', { url: state.productUrl });
    });

    /* ------------------------------------------------------------ *
     *  Audio events                                                *
     * ------------------------------------------------------------ */

    $audio.addEventListener('loadedmetadata', function () {
        if ($audio._pendingStartAt) {
            try { $audio.currentTime = $audio._pendingStartAt; } catch (e) { /* swallow */ }
            $audio._pendingStartAt = null;
        }
        updateProgress();
    });
    $audio.addEventListener('timeupdate', function () {
        if (!dragging) updateProgress();
        // Throttled persistence so a hard reload loses ≤1s of progress
        persistState();
    });
    $audio.addEventListener('ended', function () {
        // Guard against false 'ended' events fired by the browser when
        // we change `audio.src` (some browsers dispatch a synthetic
        // 'ended' on src change). A real natural end has currentTime
        // ≈ duration. Ignore otherwise.
        var isNaturalEnd = (
            $audio.duration > 0 &&
            $audio.currentTime > 0 &&
            ($audio.duration - $audio.currentTime) < 0.5
        );
        if (!isNaturalEnd) {
            log('ignored synthetic "ended" event (currentTime=' +
                $audio.currentTime + ', duration=' + $audio.duration + ')');
            return;
        }
        next();
    });
    $audio.addEventListener('play', function () {
        state.playing = true;
        updatePlayPauseIcon();
        broadcastState();
    });
    $audio.addEventListener('pause', function () {
        state.playing = false;
        updatePlayPauseIcon();
        broadcastState();
        persistState(true);
    });
    $audio.addEventListener('error', function () {
        log('audio error', $audio.error);
        // Try to skip to next track
        next();
    });

    /* ------------------------------------------------------------ *
     *  Inbound messages from parent (bridge.js)                    *
     * ------------------------------------------------------------ */

    window.addEventListener('message', function (e) {
        // Strict origin check
        if (PARENT_ORIGIN !== '*' && e.origin !== PARENT_ORIGIN) return;
        var data = e.data;
        if (!data || data.source !== 'orp-bridge') return;

        var p = data.payload || {};
        switch (data.action) {
            case 'play-product':
                loadProductAndPlay(parseInt(p.idProduct, 10), {});
                break;
            case 'play-track':
                // If same product, just jump to track index;
                // else fetch product first.
                var idP = parseInt(p.idProduct, 10);
                if (idP && idP === state.idProduct && state.tracks.length) {
                    var idx = parseInt(p.trackIndex, 10) || 0;
                    if (idx >= 0 && idx < state.tracks.length) {
                        playTrack(idx);
                    }
                } else if (idP) {
                    loadProductAndPlay(idP, { startIndex: parseInt(p.trackIndex, 10) || 0 });
                } else if (p.trackUrl) {
                    // Direct URL playback (no product context)
                    state.tracks = [{ title: p.trackTitle || '', url: p.trackUrl, filename: '' }];
                    state.currentIndex = -1;
                    state.idProduct = 0;
                    state.productName = p.trackTitle || '';
                    state.productUrl = '';
                    state.productImage = '';
                    playTrack(0);
                    showPlayer();
                }
                break;
            case 'preload-product':
                preloadProduct(parseInt(p.idProduct, 10));
                break;
            case 'pause':
                if (!$audio.paused) togglePlay();
                break;
            case 'resume':
                if ($audio.paused) togglePlay();
                break;
            case 'persist-now':
                persistState(true);
                break;
            case 'unlock':
                // iOS audio unlock — play a silent buffer in response to
                // the parent's user gesture forwarded right now.
                tryUnlockAudio();
                break;
            default:
                break;
        }
    });

    /* ------------------------------------------------------------ *
     *  iOS audio unlock                                            *
     *                                                              *
     * Mobile Safari refuses audio.play() unless it's called inside *
     * a user-gesture handler. The parent's first click is forwarded*
     * here as 'unlock' — we use it to play a silent buffer that    *
     * satisfies the autoplay policy for the rest of the session.  *
     * ------------------------------------------------------------ */

    function tryUnlockAudio() {
        try {
            // Play a 1-frame silent buffer to unlock the AudioContext
            $audio.muted = true;
            var p = $audio.play();
            if (p && typeof p.then === 'function') {
                p.then(function () {
                    $audio.pause();
                    $audio.currentTime = 0;
                    $audio.muted = state.muted;
                }).catch(function () {
                    // Source may be empty — fine, we're just warming up
                });
            }
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------ *
     *  Persistence on unload                                       *
     *                                                              *
     * Save state before the iframe is destroyed (full page reload  *
     * in non-Turbo mode, or when Turbo evicts a permanent element  *
     * for some reason). On the next iframe load, state is restored*
     * and the audio resumes from the saved currentTime — typical  *
     * gap is 200-500ms.                                            *
     * ------------------------------------------------------------ */

    window.addEventListener('beforeunload', function () { persistState(true); });
    window.addEventListener('pagehide',     function () { persistState(true); });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') persistState(true);
    });

    /* ------------------------------------------------------------ *
     *  Init: restore state if present                              *
     * ------------------------------------------------------------ */

    function init() {
        var saved = loadState();
        if (saved && saved.tracks && saved.tracks.length && saved.currentIndex >= 0) {
            // Restore visual state
            state.idProduct    = saved.idProduct || 0;
            state.productName  = saved.productName || '';
            state.productUrl   = saved.productUrl || '';
            state.productImage = saved.productImage || '';
            state.tracks       = saved.tracks;
            state.volume       = (typeof saved.volume === 'number') ? saved.volume : 0.8;
            state.muted        = !!saved.muted;
            state.visible      = !!saved.visible;

            $audio.volume = state.volume;
            $audio.muted = state.muted;

            if (state.visible) {
                $player.style.display = '';
            }
            updateUI();

            // Auto-resume audio if it was playing before reload.
            // We can't actually call .play() before the iOS unlock, but
            // we CAN load the track and seek to the saved position so
            // that the first user gesture (or auto-resume after Turbo
            // page swap) kicks in instantly.
            loadTrack(saved.currentIndex, { startAt: saved.currentTime || 0 });
            if (saved.playing) {
                $audio.play().then(function () {
                    state.playing = true;
                    updatePlayPauseIcon();
                    broadcastState();
                }).catch(function () {
                    // Autoplay blocked — the player UI shows pause icon,
                    // user clicks play to resume from saved position.
                    state.playing = false;
                    updatePlayPauseIcon();
                });
            }
        }

        sendToParent('ready', { visible: state.visible });
        log('iframe player initialized', { hasState: !!saved });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* Public API for debugging from devtools */
    window.OnlyRootsPlayer = {
        version: '3.0.0',
        getState: function () { return Object.assign({}, state); },
        play: togglePlay,
        next: next,
        prev: prev,
        setVolume: setVolume,
        clearStorage: clearState
    };

})();
