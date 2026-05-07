/**
 * OnlyRoots Persistent Audio Player — iframe-side audio engine
 *
 * Runs INSIDE the persistent iframe (frame.tpl) loaded as a same-
 * origin sandbox. Owns the <audio> element, the player UI controls,
 * the playlist queue, the MediaSession API integration, and a
 * localStorage state persistence layer. Communicates with the
 * parent page via postMessage.
 *
 * Why iframe? In v2.5.x the player lived in the parent DOM and we
 * had to fight Swup, theme reinits, third-party module DOM mutations,
 * popstate hijacks, AS4 race conditions, reCAPTCHA loaders, and a
 * dozen other things — every patch produced a new edge case. By
 * isolating the audio inside an iframe, the player gets its own
 * window, document, JS context, and event loop. None of those
 * external systems can touch it. Audio plays uninterrupted across
 * Swup swaps, full reloads, language switches, login flows, etc.
 *
 * postMessage protocol — see below for shape. The bridge.js in the
 * parent sends commands, this file sends back state updates so the
 * parent can keep mini-button visuals in sync.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @version   3.0.0
 */
(function () {
    'use strict';

    var CONFIG = window.onlyrootsPlayerConfig || {};
    var L10N   = window.onlyrootsPlayerL10n   || {};
    var DEBUG  = !!CONFIG.debug;
    var PARENT_ORIGIN = CONFIG.parentOrigin || '*';

    function dlog() {
        if (!DEBUG || !window.console) return;
        try { window.console.log.apply(window.console, ['[ORP/iframe]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    /* ============================================================ *
     *  STATE                                                       *
     * ============================================================ */

    var els = {};
    var audio = null;
    var playlist = [];          // array of track objects
    var currentIdx = -1;        // index into playlist, -1 = none loaded
    var currentProductId = null;
    var currentProductName = '';
    var currentProductUrl = '';
    var volume = 0.8;
    var muted = false;
    var hasUserInteracted = false; // iOS gesture warm-up flag

    var STATE_STORAGE_KEY = 'orp_state_v3';

    /* ============================================================ *
     *  DOM CACHE                                                   *
     * ============================================================ */

    function cacheDom() {
        els.player        = document.getElementById('orp-player');
        els.cover         = document.getElementById('orp-cover');
        els.coverImg      = document.getElementById('orp-cover-img');
        els.coverPlaceholder = document.getElementById('orp-cover-placeholder');
        els.btnPrev       = document.getElementById('orp-prev');
        els.btnPlay       = document.getElementById('orp-play');
        els.btnNext       = document.getElementById('orp-next');
        els.iconPlay      = els.btnPlay && els.btnPlay.querySelector('.orp-icon-play');
        els.iconPause     = els.btnPlay && els.btnPlay.querySelector('.orp-icon-pause');
        els.btnClose      = document.getElementById('orp-close');
        els.btnVol        = document.getElementById('orp-vol-btn');
        els.iconVolOn     = els.btnVol && els.btnVol.querySelector('.orp-icon-vol-on');
        els.iconVolOff    = els.btnVol && els.btnVol.querySelector('.orp-icon-vol-off');
        els.trackTitle    = document.getElementById('orp-track-title');
        els.trackCounter  = document.getElementById('orp-track-counter');
        els.productName   = document.getElementById('orp-product-name');
        els.productLink   = document.getElementById('orp-product-link');
        els.progressWrap  = document.getElementById('orp-progress-wrap');
        els.progressFill  = document.getElementById('orp-progress-fill');
        els.progressHandle= document.getElementById('orp-progress-handle');
        els.progressBar   = els.progressWrap && els.progressWrap.querySelector('.orp-progress-bar');
        els.timeCurrent   = document.getElementById('orp-time-current');
        els.timeTotal     = document.getElementById('orp-time-total');
        els.volumeWrap    = document.getElementById('orp-volume-wrap');
        els.volumeFill    = document.getElementById('orp-volume-fill');
        els.volumeBar     = els.volumeWrap && els.volumeWrap.querySelector('.orp-volume-bar');
        audio             = document.getElementById('orp-audio');
    }

    /* ============================================================ *
     *  TIME FORMATTING                                             *
     * ============================================================ */

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    /* ============================================================ *
     *  UI UPDATES                                                  *
     * ============================================================ */

    function showPlayer() {
        if (els.player) els.player.style.display = '';
        notifyParent('visibility', { visible: true });
    }

    function hidePlayer() {
        if (els.player) els.player.style.display = 'none';
        notifyParent('visibility', { visible: false });
    }

    function setPlayingUI(isPlaying) {
        if (els.iconPlay)  els.iconPlay.style.display  = isPlaying ? 'none' : '';
        if (els.iconPause) els.iconPause.style.display = isPlaying ? '' : 'none';
        if (els.player) els.player.setAttribute('data-playing', isPlaying ? 'true' : 'false');
    }

    function setMutedUI(isMuted) {
        if (els.iconVolOn)  els.iconVolOn.style.display  = isMuted ? 'none' : '';
        if (els.iconVolOff) els.iconVolOff.style.display = isMuted ? '' : 'none';
    }

    function updateVolumeUI() {
        if (!els.volumeFill || !els.volumeBar) return;
        var pct = Math.round(volume * 100);
        els.volumeFill.style.width = pct + '%';
        els.volumeBar.setAttribute('aria-valuenow', String(pct));
    }

    function updateProgressUI() {
        if (!audio || !els.progressFill || !els.progressBar) return;
        var dur = audio.duration || 0;
        var cur = audio.currentTime || 0;
        var pct = dur > 0 ? (cur / dur) * 100 : 0;
        els.progressFill.style.width = pct + '%';
        if (els.progressHandle) els.progressHandle.style.left = pct + '%';
        els.progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
        if (els.timeCurrent) els.timeCurrent.textContent = formatTime(cur);
        if (els.timeTotal)   els.timeTotal.textContent   = formatTime(dur);
    }

    function updateTrackInfoUI() {
        var track = playlist[currentIdx];
        if (!track) {
            if (els.trackTitle)   els.trackTitle.textContent   = '-';
            if (els.productName)  els.productName.textContent  = '-';
            if (els.trackCounter) els.trackCounter.textContent = '0/0';
            return;
        }
        if (els.trackTitle)   els.trackTitle.textContent   = track.title || '-';
        if (els.productName)  els.productName.textContent  = currentProductName || '-';
        if (els.trackCounter) els.trackCounter.textContent = (currentIdx + 1) + '/' + playlist.length;
        if (els.productLink && currentProductUrl) {
            els.productLink.setAttribute('href', currentProductUrl);
            els.productLink.setAttribute('target', '_top'); // navigate parent, not iframe
            if (els.trackTitle) els.trackTitle.setAttribute('title', track.title || '');
        }
        if (track.cover && els.coverImg) {
            els.coverImg.src = track.cover;
            els.coverImg.style.display = '';
            if (els.coverPlaceholder) els.coverPlaceholder.style.display = 'none';
        } else {
            if (els.coverImg) {
                els.coverImg.style.display = 'none';
                els.coverImg.src = '';
            }
            if (els.coverPlaceholder) els.coverPlaceholder.style.display = '';
        }
    }

    /* ============================================================ *
     *  AUDIO ENGINE                                                *
     * ============================================================ */

    function loadTrack(index, options) {
        options = options || {};
        if (!playlist || index < 0 || index >= playlist.length) return;
        currentIdx = index;
        var track = playlist[index];
        if (!track || !track.url) return;

        try { audio.src = track.url; } catch (e) { dlog('audio.src error', e); }
        audio.volume = muted ? 0 : volume;
        audio.muted  = muted;

        updateTrackInfoUI();
        setupMediaSession(track);
        showPlayer();

        if (options.autoplay !== false) {
            tryPlay();
        }

        notifyParent('track-changed', {
            productId: currentProductId,
            trackIndex: currentIdx,
            track: track,
        });
        persistState();
    }

    function tryPlay() {
        if (!audio) return;
        var p = audio.play();
        if (p && typeof p.catch === 'function') {
            p.catch(function (err) {
                dlog('audio.play() rejected (likely no user gesture yet)', err);
                // iOS will reject without user gesture — UI stays in paused state.
                setPlayingUI(false);
                notifyParent('play-rejected', { reason: String(err && err.name) });
            });
        }
    }

    function play() {
        hasUserInteracted = true;
        tryPlay();
    }

    function pause() {
        if (audio) audio.pause();
    }

    function togglePlayPause() {
        if (!audio) return;
        if (audio.paused) play(); else pause();
    }

    function nextTrack() {
        if (playlist.length === 0) return;
        var next = currentIdx + 1;
        if (next >= playlist.length) next = 0; // wrap
        loadTrack(next);
    }

    function prevTrack() {
        if (playlist.length === 0) return;
        // If we're more than 3s in, restart current track instead of going back.
        if (audio && audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }
        var prev = currentIdx - 1;
        if (prev < 0) prev = playlist.length - 1;
        loadTrack(prev);
    }

    function setVolume(vol) {
        volume = Math.max(0, Math.min(1, vol));
        if (audio) audio.volume = muted ? 0 : volume;
        updateVolumeUI();
        persistState();
    }

    function toggleMute() {
        muted = !muted;
        if (audio) {
            audio.muted = muted;
            audio.volume = muted ? 0 : volume;
        }
        setMutedUI(muted);
        persistState();
    }

    function seekTo(percent) {
        if (!audio || !audio.duration) return;
        audio.currentTime = audio.duration * Math.max(0, Math.min(1, percent));
        updateProgressUI();
    }

    function closePlayer() {
        pause();
        hidePlayer();
        notifyParent('closed', {});
        clearState();
    }

    /* ============================================================ *
     *  MEDIASESSION API (lockscreen / Bluetooth controls)          *
     * ============================================================ */

    function setupMediaSession(track) {
        if (!('mediaSession' in navigator)) return;
        try {
            var artwork = track.cover ? [{ src: track.cover, sizes: '300x300', type: 'image/jpeg' }] : [];
            navigator.mediaSession.metadata = new MediaMetadata({
                title:  track.title || '',
                artist: currentProductName || '',
                album:  '',
                artwork: artwork,
            });
            navigator.mediaSession.setActionHandler('play',          play);
            navigator.mediaSession.setActionHandler('pause',         pause);
            navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
            navigator.mediaSession.setActionHandler('nexttrack',     nextTrack);
        } catch (e) { dlog('mediaSession setup error', e); }
    }

    /* ============================================================ *
     *  PERSISTENCE (localStorage, restored on reload)              *
     * ============================================================ */

    function persistState() {
        try {
            var state = {
                productId:   currentProductId,
                productName: currentProductName,
                productUrl:  currentProductUrl,
                playlist:    playlist,
                currentIdx:  currentIdx,
                volume:      volume,
                muted:       muted,
                position:    audio && audio.currentTime || 0,
                ts:          Date.now(),
            };
            window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
        } catch (e) {}
    }

    function restoreState() {
        try {
            var raw = window.localStorage.getItem(STATE_STORAGE_KEY);
            if (!raw) return false;
            var state = JSON.parse(raw);
            if (!state || !state.playlist || !state.playlist.length) return false;

            currentProductId   = state.productId;
            currentProductName = state.productName || '';
            currentProductUrl  = state.productUrl  || '';
            playlist   = state.playlist;
            volume     = typeof state.volume === 'number' ? state.volume : 0.8;
            muted      = !!state.muted;
            currentIdx = typeof state.currentIdx === 'number' ? state.currentIdx : 0;
            if (currentIdx < 0 || currentIdx >= playlist.length) currentIdx = 0;

            updateVolumeUI();
            setMutedUI(muted);
            // Load WITHOUT autoplay (browsers will reject, and we want
            // to respect the user's previous "I closed the player" choice
            // — they can click play to resume).
            loadTrack(currentIdx, { autoplay: false });

            // Restore position once metadata loads.
            if (state.position && state.position > 0) {
                var seekOnce = function () {
                    try { audio.currentTime = state.position; } catch (e) {}
                    audio.removeEventListener('loadedmetadata', seekOnce);
                };
                audio.addEventListener('loadedmetadata', seekOnce);
            }

            return true;
        } catch (e) { dlog('restoreState error', e); return false; }
    }

    function clearState() {
        try { window.localStorage.removeItem(STATE_STORAGE_KEY); } catch (e) {}
    }

    /* ============================================================ *
     *  POSTMESSAGE PROTOCOL                                        *
     *                                                              *
     * Parent → iframe (commands):                                  *
     *   { type: 'load',    productId, productName, productUrl,     *
     *                      playlist, autoplay }                    *
     *   { type: 'play' }                                           *
     *   { type: 'pause' }                                          *
     *   { type: 'toggle' }                                         *
     *   { type: 'next' }                                           *
     *   { type: 'prev' }                                           *
     *   { type: 'close' }                                          *
     *   { type: 'warmup-audio' }   (iOS gesture relay)             *
     *   { type: 'request-state' }                                  *
     *                                                              *
     * iframe → parent (notifications):                             *
     *   { type: 'ready' }                                          *
     *   { type: 'state',          ...full state... }               *
     *   { type: 'track-changed',  productId, trackIndex, track }   *
     *   { type: 'playing-state',  isPlaying }                      *
     *   { type: 'ended' }                                          *
     *   { type: 'visibility',     visible }                        *
     *   { type: 'closed' }                                         *
     *   { type: 'play-rejected',  reason }                         *
     * ============================================================ */

    function notifyParent(type, payload) {
        if (!window.parent || window.parent === window) return;
        try {
            var msg = { source: 'orp', type: type };
            if (payload) {
                for (var k in payload) {
                    if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
                }
            }
            window.parent.postMessage(msg, PARENT_ORIGIN);
        } catch (e) { dlog('notifyParent error', e); }
    }

    function handleParentMessage(ev) {
        if (!ev || !ev.data || ev.data.source !== 'orp-bridge') return;
        if (PARENT_ORIGIN !== '*' && ev.origin !== PARENT_ORIGIN) {
            dlog('rejecting message from unexpected origin', ev.origin);
            return;
        }
        var msg = ev.data;
        dlog('cmd from parent', msg.type);

        switch (msg.type) {
            case 'load':
                currentProductId   = msg.productId;
                currentProductName = msg.productName || '';
                currentProductUrl  = msg.productUrl  || '';
                playlist = Array.isArray(msg.playlist) ? msg.playlist : [];
                if (playlist.length === 0) return;
                hasUserInteracted = true; // load command implies a click happened
                var startIdx = (typeof msg.startIndex === 'number' && msg.startIndex >= 0 && msg.startIndex < playlist.length)
                    ? msg.startIndex
                    : 0;
                loadTrack(startIdx, { autoplay: msg.autoplay !== false });
                break;

            case 'play':       hasUserInteracted = true; play();        break;
            case 'pause':      pause();                                  break;
            case 'toggle':     hasUserInteracted = true; togglePlayPause(); break;
            case 'next':       nextTrack();                              break;
            case 'prev':       prevTrack();                              break;
            case 'close':      closePlayer();                            break;
            case 'warmup-audio':
                // iOS user-gesture relay: a click happened in the parent.
                // We do a silent play/pause to "unlock" the AudioContext
                // for this iframe's window. Future programmatic play()
                // calls will then succeed even though the gesture
                // technically came from the parent frame.
                hasUserInteracted = true;
                if (audio && audio.paused) {
                    var oldVol = audio.volume;
                    audio.volume = 0;
                    var p = audio.play();
                    if (p && typeof p.then === 'function') {
                        p.then(function () {
                            audio.pause();
                            audio.volume = oldVol;
                        }).catch(function () {
                            audio.volume = oldVol;
                        });
                    }
                }
                break;
            case 'request-state':
                notifyParent('state', {
                    productId:   currentProductId,
                    productName: currentProductName,
                    productUrl:  currentProductUrl,
                    playlist:    playlist,
                    currentIdx:  currentIdx,
                    isPlaying:   audio && !audio.paused,
                    position:    audio && audio.currentTime || 0,
                    duration:    audio && audio.duration   || 0,
                    volume:      volume,
                    muted:       muted,
                });
                break;
        }
    }

    /* ============================================================ *
     *  EVENTS                                                      *
     * ============================================================ */

    function bindEvents() {
        if (!audio) return;

        // Audio element events
        audio.addEventListener('play',   function () { setPlayingUI(true);  notifyParent('playing-state', { isPlaying: true });  });
        audio.addEventListener('pause',  function () { setPlayingUI(false); notifyParent('playing-state', { isPlaying: false }); });
        audio.addEventListener('ended',  function () {
            notifyParent('ended', { trackIndex: currentIdx });
            // Auto-advance to next track if there is one.
            if (currentIdx < playlist.length - 1) nextTrack();
        });
        audio.addEventListener('timeupdate',     updateProgressUI);
        audio.addEventListener('loadedmetadata', updateProgressUI);
        audio.addEventListener('error', function () {
            dlog('audio error', audio && audio.error);
            notifyParent('error', { code: audio && audio.error && audio.error.code });
        });

        // UI controls
        if (els.btnPlay)  els.btnPlay.addEventListener('click',  function () { hasUserInteracted = true; togglePlayPause(); });
        if (els.btnPrev)  els.btnPrev.addEventListener('click',  prevTrack);
        if (els.btnNext)  els.btnNext.addEventListener('click',  nextTrack);
        if (els.btnClose) els.btnClose.addEventListener('click', closePlayer);
        if (els.btnVol)   els.btnVol.addEventListener('click',   toggleMute);

        // Progress bar drag/click to seek
        if (els.progressBar) {
            els.progressBar.addEventListener('click', function (ev) {
                var rect = els.progressBar.getBoundingClientRect();
                var pct  = (ev.clientX - rect.left) / rect.width;
                seekTo(pct);
            });
            els.progressBar.addEventListener('keydown', function (ev) {
                if (ev.key === 'ArrowRight') seekTo((audio.currentTime + 5) / (audio.duration || 1));
                else if (ev.key === 'ArrowLeft') seekTo((audio.currentTime - 5) / (audio.duration || 1));
            });
        }

        // Volume bar
        if (els.volumeBar) {
            els.volumeBar.addEventListener('click', function (ev) {
                var rect = els.volumeBar.getBoundingClientRect();
                var pct  = (ev.clientX - rect.left) / rect.width;
                setVolume(pct);
                if (muted) toggleMute();
            });
        }

        // Listen for parent commands.
        window.addEventListener('message', handleParentMessage, false);
    }

    /* ============================================================ *
     *  INIT                                                        *
     * ============================================================ */

    function init() {
        cacheDom();
        if (!audio) {
            dlog('audio element missing, abort');
            return;
        }
        bindEvents();
        updateVolumeUI();
        setMutedUI(muted);

        // Try to restore previous state (paused, the user clicks play to resume).
        var restored = restoreState();
        dlog('init complete, state restored:', restored);

        // Tell parent we're alive and ready to receive commands.
        notifyParent('ready', { restored: restored });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
