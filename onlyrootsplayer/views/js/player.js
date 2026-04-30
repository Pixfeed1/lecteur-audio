/**
 * OnlyRoots Persistent Audio Player — v2.5.3
 *
 * Theme-agnostic, works on any PrestaShop 8 theme. The previous theme-coupled
 * code (ZOneTheme megamenu reinit, server-side debug logger, hardcoded French
 * URL exclusions) has been removed in favour of:
 *   - configurable container / product / anchor selectors via BO settings
 *   - localised strings via window.onlyrootsPlayerL10n (set in PHP)
 *   - URL exclusions built from PrestaShop's Link::getPageLink()
 *   - in-browser debug logging only when CONFIG.debug === true
 *
 * Two operating modes:
 *   1. Standalone — Swup disabled, player state is persisted via localStorage
 *      so audio resumes (paused) on the next page after a full reload.
 *   2. SPA — Swup enabled, the player element is detached to <body> and
 *      survives navigations natively without any persistence code path.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @version   2.5.3
 */
(function () {
    'use strict';

    if (typeof onlyrootsPlayerConfig === 'undefined') return;
    var CONFIG = onlyrootsPlayerConfig;
    if (!CONFIG.available) return;

    var L10N = (typeof onlyrootsPlayerL10n !== 'undefined') ? onlyrootsPlayerL10n : {
        listenSample: 'Écouter un extrait',
        listen:       'Écouter',
        pause:        'Pause',
        openInPlayer: 'Ouvrir dans le lecteur',
        openPlaylist: 'Ouvrir cette playlist dans le lecteur persistant',
    };

    // ──────────────────── REENTRANCE GUARD ────────────────────
    // SwupScriptsPlugin{body:true} re-executes inline scripts after each swap.
    // Without this guard, every navigation would rebuild a fresh Swup instance
    // on top of the old one. We only re-trigger button injection on re-exec.
    if (window.__orpInitialized) {
        if (CONFIG.debug) try { console.debug('[ORP] re-exec, re-injecting buttons only'); } catch (e) {}
        if (typeof window.__orpScheduleInject === 'function') {
            window.__orpScheduleInject();
        }
        return;
    }
    window.__orpInitialized = true;

    var STORAGE_KEY      = CONFIG.storageKey || 'orp_state_v1';
    var SAVE_INTERVAL_MS = 3000;
    var DEBUG            = !!CONFIG.debug;

    function dlog() {
        if (!DEBUG) return;
        try {
            var args = ['[ORP]'].concat(Array.prototype.slice.call(arguments));
            console.debug.apply(console, args);
        } catch (e) {}
    }

    var audio = null;
    var state = {
        playlist: [],
        currentTrack: 0,
        productId: 0,
        productName: '',
        productImage: '',
        productUrl: '',
        playing: false,
        volume: 0.8,
        muted: false,
        loaded: false,
        currentTime: 0,
    };
    var lastSavedAt  = 0;
    var restoring    = false;
    var injectTimer  = null;
    var swupInstance = null;
    var eventsBound  = false;
    var els          = {};

    // Captured at init() time and re-applied after each Swup swap. PrestaShop's
    // body class generator emits these on the home but a few page templates
    // (notably some category pages on ZOneTheme) drop them, and
    // SwupBodyClassPlugin replaces the body class wholesale — so themes that
    // depend on `body.lang-fr`, `body.country-fr` etc. for visuals would lose
    // them across navigations. We snapshot the initial set, then top up.
    var PERSISTENT_BODY_CLASS_PATTERNS = [
        /^country-/,
        /^currency-/,
        /^lang-/,
        /^is-customer-/,
        /^no-customer-/,
    ];
    var persistentBodyClasses = [];

    /* ============================================================ */
    /*  DOM CACHE                                                   */
    /* ============================================================ */

    function cacheDom() {
        els.player           = document.getElementById('orp-player');
        els.audio            = document.getElementById('orp-audio');
        els.playBtn          = document.getElementById('orp-play');
        els.prevBtn          = document.getElementById('orp-prev');
        els.nextBtn          = document.getElementById('orp-next');
        els.closeBtn         = document.getElementById('orp-close');
        els.coverImg         = document.getElementById('orp-cover-img');
        els.cover            = document.getElementById('orp-cover');
        els.coverPlaceholder = document.getElementById('orp-cover-placeholder');
        els.trackTitle       = document.getElementById('orp-track-title');
        els.productName      = document.getElementById('orp-product-name');
        els.productLink      = document.getElementById('orp-product-link');
        els.trackCounter     = document.getElementById('orp-track-counter');
        els.progressFill     = document.getElementById('orp-progress-fill');
        els.progressHandle   = document.getElementById('orp-progress-handle');
        els.progressWrap     = document.getElementById('orp-progress-wrap');
        els.timeCurrent      = document.getElementById('orp-time-current');
        els.timeTotal        = document.getElementById('orp-time-total');
        els.volBtn           = document.getElementById('orp-vol-btn');
        els.volumeFill       = document.getElementById('orp-volume-fill');
        els.volumeWrap       = document.getElementById('orp-volume-wrap');
        els.iconPlay         = els.playBtn ? els.playBtn.querySelector('.orp-icon-play')  : null;
        els.iconPause        = els.playBtn ? els.playBtn.querySelector('.orp-icon-pause') : null;
        els.iconVolOn        = els.volBtn  ? els.volBtn.querySelector('.orp-icon-vol-on')  : null;
        els.iconVolOff       = els.volBtn  ? els.volBtn.querySelector('.orp-icon-vol-off') : null;
        audio = els.audio;
    }

    /**
     * Move the player out of the Swup-swapped area so it survives navigations
     * natively without re-rendering. Idempotent and safe when Swup is off.
     */
    function detachPlayerToBody() {
        if (!els.player) return;
        if (els.player.parentElement === document.body) return;
        if (els.player.getAttribute('data-orp-detached') === '1') return;
        document.body.appendChild(els.player);
        els.player.setAttribute('data-orp-detached', '1');
    }

    /* ============================================================ */
    /*  UTILS                                                       */
    /* ============================================================ */

    function formatTime(s) {
        if (!s || isNaN(s)) return '0:00';
        var m   = Math.floor(s / 60);
        var sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function safeStorageGet(key) {
        try {
            var raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function safeStorageSet(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function safeStorageDel(key) {
        try { window.localStorage.removeItem(key); } catch (e) {}
    }

    /* ============================================================ */
    /*  PERSISTENCE (only used when Swup is OFF)                    */
    /* ============================================================ */

    function saveState(force) {
        if (swupInstance) return; // Swup keeps the audio element alive natively

        var now = Date.now();
        if (!force && now - lastSavedAt < SAVE_INTERVAL_MS) return;
        lastSavedAt = now;

        if (audio && !isNaN(audio.currentTime)) state.currentTime = audio.currentTime;

        if (!state.loaded || !state.playlist.length) {
            safeStorageDel(STORAGE_KEY);
            return;
        }

        safeStorageSet(STORAGE_KEY, {
            playlist: state.playlist,
            currentTrack: state.currentTrack,
            productId: state.productId,
            productName: state.productName,
            productImage: state.productImage,
            productUrl: state.productUrl,
            playing: state.playing,
            volume: state.volume,
            muted: state.muted,
            currentTime: state.currentTime,
            savedAt: now,
        });
    }

    function restoreState() {
        if (swupInstance) return false;

        var saved = safeStorageGet(STORAGE_KEY);
        if (!saved || !saved.playlist || !saved.playlist.length) return false;

        restoring = true;

        state.playlist     = saved.playlist;
        state.currentTrack = saved.currentTrack || 0;
        state.productId    = saved.productId || 0;
        state.productName  = saved.productName || '';
        state.productImage = saved.productImage || '';
        state.productUrl   = saved.productUrl || '';
        state.volume       = typeof saved.volume === 'number' ? saved.volume : 0.8;
        state.muted        = !!saved.muted;
        state.currentTime  = saved.currentTime || 0;
        state.loaded       = true;

        if (audio) audio.volume = state.muted ? 0 : state.volume;

        updatePlayerInfo();
        updateVolume();

        var track = state.playlist[state.currentTrack];
        if (track && audio) {
            audio.src = track.url;
            audio.addEventListener('loadedmetadata', function onMeta() {
                audio.removeEventListener('loadedmetadata', onMeta);
                try { audio.currentTime = state.currentTime || 0; } catch (e) {}
                updateProgress();

                // Note: we do NOT auto-resume playback after a full reload —
                // browsers block autoplay without user gesture. We only
                // restore the position; the user clicks play to resume.
                state.playing = false;
                updatePlayButton();
                updateMiniButtons();
                restoring = false;
            }, { once: true });
            audio.load();
        }

        showPlayer();
        return true;
    }

    /* ============================================================ */
    /*  PLAYER CORE                                                 */
    /* ============================================================ */

    function showPlayer() {
        if (!els.player) return;
        els.player.setAttribute('data-visible', 'true');
        els.player.style.display = '';
        document.body.classList.add('orp-player-active');
    }

    function hidePlayer() {
        if (!els.player) return;
        els.player.setAttribute('data-visible', 'false');
        document.body.classList.remove('orp-player-active');
        if (audio) audio.pause();
        state.playing = false;
        state.loaded  = false;
        updatePlayButton();
        updateMiniButtons();
        safeStorageDel(STORAGE_KEY);
    }

    function loadPlaylist(data) {
        state.playlist     = data.tracks || [];
        state.productId    = data.id_product;
        state.productName  = data.name || '';
        state.productImage = data.image || '';
        state.productUrl   = data.url || '';
        state.currentTrack = 0;
        state.currentTime  = 0;
        state.loaded       = true;

        updatePlayerInfo();
        loadTrack(0);
        showPlayer();
    }

    function loadTrack(index) {
        if (index < 0 || index >= state.playlist.length) return;

        state.currentTrack = index;
        var track = state.playlist[index];

        audio.src = track.url;
        audio.load();

        updatePlayerInfo();
        saveState(true);
    }

    function playTrack() {
        if (!audio || !audio.src) return;
        var p = audio.play();
        if (p !== undefined) {
            p.then(function () {
                state.playing = true;
                updatePlayButton();
                updateMiniButtons();
                saveState(true);
            }).catch(function (err) {
                dlog('play() blocked', err);
                state.playing = false;
                updatePlayButton();
            });
        }
    }

    function pauseTrack() {
        if (!audio) return;
        audio.pause();
        state.playing = false;
        updatePlayButton();
        updateMiniButtons();
        saveState(true);
    }

    function togglePlay() { if (state.playing) pauseTrack(); else playTrack(); }

    function prevTrack() {
        if (state.currentTrack > 0) {
            loadTrack(state.currentTrack - 1);
            playTrack();
        } else if (audio) {
            try { audio.currentTime = 0; } catch (e) {}
        }
    }

    function nextTrack() {
        if (state.currentTrack < state.playlist.length - 1) {
            loadTrack(state.currentTrack + 1);
            playTrack();
        } else {
            pauseTrack();
            loadTrack(0);
        }
    }

    /* ============================================================ */
    /*  UI                                                          */
    /* ============================================================ */

    function updatePlayerInfo() {
        if (!state.loaded || !state.playlist.length) return;
        var track = state.playlist[state.currentTrack];

        if (els.trackTitle)   els.trackTitle.textContent = track.title || '';
        if (els.productName)  els.productName.textContent = state.productName;
        if (els.trackCounter) els.trackCounter.textContent = (state.currentTrack + 1) + '/' + state.playlist.length;

        if (els.productLink) {
            var safeUrl = '#';
            if (state.productUrl && /^https?:\/\//i.test(state.productUrl)) safeUrl = state.productUrl;
            els.productLink.setAttribute('href', safeUrl);
            els.productLink.setAttribute('title', state.productName || '');
        }

        if (els.coverImg && els.coverPlaceholder) {
            if (state.productImage) {
                els.coverImg.src = state.productImage;
                els.coverImg.alt = state.productName || '';
                els.coverImg.style.display = '';
                els.coverPlaceholder.style.display = 'none';
            } else {
                els.coverImg.removeAttribute('src');
                els.coverImg.style.display = 'none';
                els.coverPlaceholder.style.display = '';
            }
        }
    }

    function updatePlayButton() {
        if (!els.iconPlay || !els.iconPause) return;
        els.iconPlay.style.display  = state.playing ? 'none' : '';
        els.iconPause.style.display = state.playing ? '' : 'none';
        if (els.playBtn) els.playBtn.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    }

    function updateProgress() {
        if (!audio || !audio.duration) return;
        var pct = (audio.currentTime / audio.duration) * 100;
        if (els.progressFill)   els.progressFill.style.width = pct + '%';
        if (els.progressHandle) els.progressHandle.style.left = pct + '%';
        if (els.timeCurrent)    els.timeCurrent.textContent = formatTime(audio.currentTime);
        if (els.timeTotal)      els.timeTotal.textContent = formatTime(audio.duration);
        if (!restoring && state.playing) saveState(false);
    }

    function updateVolume() {
        var v = state.muted ? 0 : state.volume;
        if (els.volumeFill) els.volumeFill.style.width = (v * 100) + '%';
        var muted = v === 0;
        if (els.iconVolOn)  els.iconVolOn.style.display  = muted ? 'none' : '';
        if (els.iconVolOff) els.iconVolOff.style.display = muted ? '' : 'none';
    }

    /* ============================================================ */
    /*  MINI BUTTONS (injected on listings)                         */
    /* ============================================================ */

    function updateMiniButtons() {
        // Keep the integrated product playlist's row highlight in sync with
        // the persistent footer player's state. Every state change touches
        // updateMiniButtons() so this is the right central hook.
        updateProductPlaylistPlayingState();

        var btnsInline = document.querySelectorAll('.orp-play-btn-inline');
        btnsInline.forEach(function (btn) {
            var pid = parseInt(btn.getAttribute('data-product-id'), 10);
            var playing = (pid === state.productId && state.playing);
            btn.classList.toggle('orp-playing', playing);
            btn.setAttribute('aria-label', playing ? L10N.pause : L10N.listenSample);
            btn.setAttribute('title',     playing ? L10N.pause : L10N.listenSample);
        });

        var btnsMini = document.querySelectorAll('.orp-play-btn-mini');
        btnsMini.forEach(function (btn) {
            var pid = parseInt(btn.getAttribute('data-product-id'), 10);
            var playing = (pid === state.productId && state.playing);
            btn.classList.toggle('orp-playing', playing);
            btn.setAttribute('aria-label', playing ? L10N.pause : L10N.listen);
            btn.innerHTML = playing
                ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1" width="3" height="10" fill="currentColor"/><rect x="7.5" y="1" width="3" height="10" fill="currentColor"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="3,1 3,11 10,6" fill="currentColor"/></svg>';
        });
    }

    function collectListingCards() {
        var selector = CONFIG.productSelectors
            || '.js-product-miniature[data-id-product], .product-miniature[data-id-product]';

        var cards;
        try {
            cards = document.querySelectorAll(selector);
        } catch (e) {
            dlog('invalid productSelectors, falling back', e);
            cards = document.querySelectorAll('.product-miniature[data-id-product]');
        }

        // Skip cards that live inside the cart modal, mini-cart preview,
        // header dropdowns or any open modal — those would inject duplicates.
        var filtered = [];
        cards.forEach(function (card) {
            if (card.closest('#blockcart-modal,.cart-preview,.cart-detailed,.modal,.cart-items,.header-nav,.header-top')) return;
            filtered.push(card);
        });
        return filtered;
    }

    function findButtonAnchor(card) {
        var raw = CONFIG.buttonAnchor || '';
        if (!raw) return null;

        // Try each comma-separated selector in order; first match wins.
        // Previously we passed the whole comma-list to querySelector which
        // returns the first element matching ANY of the selectors in DOM
        // order — not necessarily the first selector listed. The new behaviour
        // honours operator priority.
        var selectors = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        for (var i = 0; i < selectors.length; i++) {
            try {
                var el = card.querySelector(selectors[i]);
                if (el) return el;
            } catch (e) {
                dlog('invalid buttonAnchor selector', selectors[i], e);
            }
        }
        return null;
    }

    function findCartButton(card) {
        // Common cart-button selectors across Classic, Hummingbird, Warehouse,
        // and most premium PS8 themes. We don't insist on a match — if missing,
        // the play button is just appended to the anchor.
        return card.querySelector(
            '.btn.add-to-cart, .js-ajax-add-to-cart, [data-button-action="add-to-cart"], .add-to-cart, button[name="Submit"]'
        );
    }

    function findThumbnailContainer(card) {
        return card.querySelector('.thumbnail-container')
            || card.querySelector('.product-thumbnail')
            || card.querySelector('.product-image')
            || card.querySelector('.thumbnail')
            || (function () {
                var img = card.querySelector('img');
                return img ? img.parentElement : null;
            })();
    }

    function buildInlineButton(productId) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'orp-play-btn-inline';
        btn.setAttribute('data-product-id', String(productId));
        btn.setAttribute('data-no-swup', '');
        btn.setAttribute('aria-label', L10N.listenSample);
        btn.setAttribute('title', L10N.listenSample);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            onMiniPlayClick(productId);
        });
        return btn;
    }

    function buildOverlayButton(productId) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'orp-play-btn-mini';
        btn.setAttribute('data-product-id', String(productId));
        btn.setAttribute('data-no-swup', '');
        btn.setAttribute('aria-label', L10N.listen);
        btn.setAttribute('title', L10N.listen);
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="3,1 3,11 10,6" fill="currentColor"/></svg>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            onMiniPlayClick(productId);
        });
        return btn;
    }

    function injectPlayButtons() {
        var productCards = collectListingCards();
        if (!productCards.length) return;

        var seen       = {};
        var productIds = [];
        productCards.forEach(function (card) {
            var pid = parseInt(card.getAttribute('data-id-product'), 10);
            if (!pid || seen[pid]) return;
            seen[pid] = true;
            productIds.push(pid);
        });
        if (!productIds.length) return;

        var batchUrl = CONFIG.apiUrl
            + (CONFIG.apiUrl.indexOf('?') === -1 ? '?' : '&')
            + 'action=batch&ids=' + productIds.join(',');

        fetch(batchUrl, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : { products: [] }; })
            .then(function (data) {
                var withAudio = data.products || [];
                if (!withAudio.length) return;

                productCards.forEach(function (card) {
                    var pid = parseInt(card.getAttribute('data-id-product'), 10);
                    if (withAudio.indexOf(pid) === -1) return;

                    // Preferred placement: inline next to the cart button.
                    var anchor  = findButtonAnchor(card);
                    var cartBtn = anchor ? findCartButton(anchor) : null;

                    if (anchor) {
                        if (anchor.querySelector('.orp-play-btn-inline')) return;
                        var btn = buildInlineButton(pid);
                        if (cartBtn && cartBtn.parentNode === anchor) {
                            anchor.insertBefore(btn, cartBtn);
                        } else {
                            anchor.appendChild(btn);
                        }
                        // Match the sibling cart button's vertical metrics
                        // so we sit exactly on the same baseline. ZOneTheme
                        // applies `margin-top: 10px` to `.add-to-cart` in
                        // certain grid contexts (.pg-bnl .product-list .grid)
                        // — copying the cart button's computed margin-top
                        // means the play button realigns automatically in
                        // every responsive breakpoint, regardless of which
                        // theme rule won the cascade. We only copy when
                        // there's an actual non-zero margin to avoid pushing
                        // the button down in contexts that don't need it.
                        if (cartBtn) {
                            try {
                                var cartTopMargin = window.getComputedStyle(cartBtn).marginTop;
                                if (cartTopMargin && cartTopMargin !== '0px') {
                                    btn.style.marginTop = cartTopMargin;
                                }
                            } catch (e) {}
                        }
                        card.classList.add('orp-has-audio');
                        return;
                    }

                    // Fallback placement: overlay on the product image.
                    var imgWrap = findThumbnailContainer(card);
                    if (!imgWrap) return;
                    if (imgWrap.querySelector('.orp-play-btn-mini')) return;

                    imgWrap.classList.add('orp-has-audio');
                    imgWrap.appendChild(buildOverlayButton(pid));
                });

                updateMiniButtons();
            })
            .catch(function (err) { dlog('batch failed', err); });
    }

    function scheduleInject() {
        if (injectTimer) clearTimeout(injectTimer);
        injectTimer = setTimeout(injectPlayButtons, 150);
    }
    window.__orpScheduleInject = scheduleInject;

    function onMiniPlayClick(productId) {
        if (state.productId === productId && state.loaded) {
            togglePlay();
            return;
        }

        if (els.player) els.player.classList.add('orp-loading');

        fetch(CONFIG.apiUrl + '?id_product=' + productId, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error) { dlog('api error', data.error); return; }
                loadPlaylist(data);
                playTrack();
            })
            .catch(function (err) { dlog('load failed', err); })
            .finally(function () {
                if (els.player) els.player.classList.remove('orp-loading');
            });
    }

    /* ============================================================ */
    /*  EVENTS                                                      */
    /* ============================================================ */

    function bindEvents() {
        if (eventsBound || !els.playBtn || !audio) return;
        eventsBound = true;

        els.playBtn.addEventListener('click', togglePlay);
        if (els.prevBtn)  els.prevBtn.addEventListener('click', prevTrack);
        if (els.nextBtn)  els.nextBtn.addEventListener('click', nextTrack);
        if (els.closeBtn) els.closeBtn.addEventListener('click', hidePlayer);

        audio.addEventListener('timeupdate',     updateProgress);
        audio.addEventListener('ended',          nextTrack);
        audio.addEventListener('loadedmetadata', updateProgress);
        audio.addEventListener('play',  function () {
            state.playing = true;
            updatePlayButton();
            updateMiniButtons();
            // Pause every OTHER <audio> element on the page when our player
            // starts. Required by the "Intégration avec le module audio
            // existant" deliverable: on a product page, the third-party
            // `productaudioplaylistplugin` module renders its own player
            // (`.progression-playlist`) with its own <audio> tags. Without
            // this coordination both players ran simultaneously and the
            // sounds overlapped (operator confirmed this is the bug).
            try {
                var others = document.querySelectorAll('audio');
                for (var i = 0; i < others.length; i++) {
                    if (others[i] !== audio && !others[i].paused) {
                        others[i].pause();
                    }
                }
            } catch (e) {}
        });
        audio.addEventListener('pause', function () {
            state.playing = false;
            updatePlayButton();
            updateMiniButtons();
        });
        audio.addEventListener('error', function () {
            dlog('audio error', audio.currentSrc);
            if (state.currentTrack < state.playlist.length - 1) nextTrack();
            else pauseTrack();
        });

        // Reverse coordination: when ANY OTHER <audio> on the page starts,
        // pause ours. Listens in capture phase so we react before bubble
        // handlers in the third-party player can fire. Same module
        // boundary as the forward direction above — only one audio source
        // is audible at any time, regardless of which player triggered it.
        document.addEventListener('play', function (ev) {
            try {
                var t = ev && ev.target;
                if (!t || t.tagName !== 'AUDIO') return;
                if (t === audio) return;
                if (audio && !audio.paused) {
                    audio.pause();
                }
            } catch (e) {}
        }, true);

        // Seek bar
        if (els.progressWrap) {
            var progressBar = els.progressWrap.querySelector('.orp-progress-bar');
            if (progressBar) {
                progressBar.addEventListener('click', function (e) {
                    if (!audio.duration) return;
                    seekTo(e, progressBar);
                });
                var dragging = false;
                progressBar.addEventListener('mousedown', function (e) { dragging = true; seekTo(e, progressBar); });
                document.addEventListener('mousemove', function (e) { if (dragging) seekTo(e, progressBar); });
                document.addEventListener('mouseup',   function ()  { dragging = false; });
                progressBar.addEventListener('touchstart', function (e) {
                    dragging = true;
                    if (e.touches[0]) seekTo(e.touches[0], progressBar);
                }, { passive: true });
                document.addEventListener('touchmove', function (e) {
                    if (dragging && e.touches[0]) seekTo(e.touches[0], progressBar);
                }, { passive: true });
                document.addEventListener('touchend', function () { dragging = false; });
                progressBar.addEventListener('keydown', function (e) {
                    if (!audio.duration) return;
                    if (e.key === 'ArrowRight')      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                    else if (e.key === 'ArrowLeft')  audio.currentTime = Math.max(0, audio.currentTime - 5);
                });
            }
        }

        // Volume
        if (els.volBtn) {
            els.volBtn.addEventListener('click', function () {
                state.muted = !state.muted;
                audio.volume = state.muted ? 0 : state.volume;
                updateVolume();
                saveState(true);
            });
        }
        if (els.volumeWrap) {
            var volBar = els.volumeWrap.querySelector('.orp-volume-bar');
            if (volBar) {
                volBar.addEventListener('click', function (e) {
                    var rect = volBar.getBoundingClientRect();
                    state.volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    state.muted  = state.volume === 0;
                    audio.volume = state.volume;
                    updateVolume();
                    saveState(true);
                });
            }
        }

        window.addEventListener('beforeunload', function () { saveState(true); });
        window.addEventListener('pagehide',     function () { saveState(true); });

        audio.volume = state.muted ? 0 : state.volume;
        updateVolume();
    }

    function seekTo(e, bar) {
        if (!audio.duration) return;
        var rect = bar.getBoundingClientRect();
        var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = pct * audio.duration;
        updateProgress();
        saveState(true);
    }

    /* ============================================================ */
    /*  PRODUCT PAGE INTEGRATION                                    */
    /* ============================================================ */

    function initProductPage() {
        // Detect the third-party module's own player on the product page and
        // add an "Open in player" button next to it. If the third-party module
        // is not present, this function does nothing.
        var existingPlayer = document.querySelector('.progression-playlist');
        if (existingPlayer) {
            var bodyId = document.body.getAttribute('id');
            var match  = bodyId ? bodyId.match(/product-page-(\d+)/) : null;
            var pid    = 0;

            if (match) {
                pid = parseInt(match[1], 10);
            } else {
                var el = document.querySelector('[data-id-product]')
                      || document.querySelector('input[name="id_product"]');
                if (el) {
                    var v = el.getAttribute('data-id-product') || el.value;
                    pid = parseInt(v, 10) || 0;
                }
            }
            if (pid) {
                var container = existingPlayer.closest('.papp-player') || existingPlayer.parentElement;
                if (container && !container.querySelector('.orp-open-in-player')) {
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'orp-open-in-player';
                    btn.setAttribute('data-no-swup', '');
                    btn.textContent = L10N.openInPlayer;
                    btn.setAttribute('aria-label', L10N.openPlaylist);
                    btn.addEventListener('click', function (e) {
                        e.preventDefault();
                        onMiniPlayClick(pid);
                    });
                    container.appendChild(btn);
                }
            }
        }

        // Wire our integrated product playlist (rendered server-side by
        // hookDisplayProductPlaylistPlugin when CFG_REPLACE_PAPP_PLAYER=1).
        // Idempotent across re-runs: each <button> remembers it's bound via
        // a data flag, so re-init on Swup return doesn't double-bind.
        wireProductPlaylist();

        // Mirror the playlist into the description areas. We keep the HHV-
        // style play button (small "Listen" button at the start of the short
        // description) but DROPPED the Juno-style clone of the full track
        // list inside the long description in v2.5.2: when a product had
        // both a description and audio, the playlist was visible twice
        // (operator-confirmed regression after the v2.5.2 release). The
        // line-107 hook placement in product.tpl is already inside the
        // description column, so it covers the Juno use case on its own.
        if (CONFIG.productPlaylistEnabled) {
            injectPlaylistInShortDescription();
        }

        updateProductPlaylistPlayingState();
    }

    /**
     * HHV-style: small play button injected at the start of the product
     * short description. Clicking it loads the album and starts playback
     * at the first track via the same code path as everything else.
     * Idempotent — guarded by `data-orp-bound` on the inserted button so
     * a Swup re-init doesn't insert a second one.
     */
    function injectPlaylistInShortDescription() {
        var widget = document.querySelector('.orp-product-playlist[data-product-id]');
        if (!widget) return;
        var productId = parseInt(widget.getAttribute('data-product-id'), 10) || 0;
        if (!productId) return;

        var short = document.querySelector('.product-description-short');
        if (!short) return;
        if (short.querySelector('.orp-short-play-btn')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'orp-short-play-btn';
        btn.setAttribute('data-orp-bound', '1');
        btn.setAttribute('data-product-id', String(productId));
        btn.setAttribute('data-no-swup', '');
        btn.setAttribute('aria-label', L10N.listen);
        btn.innerHTML =
            '<span class="orp-short-play-btn__icon" aria-hidden="true">'
            + '<svg width="14" height="14" viewBox="0 0 12 12">'
            + '<polygon points="3,1 3,11 10,6" fill="currentColor"/>'
            + '</svg></span>'
            + '<span class="orp-short-play-btn__label">' + escapeHtml(L10N.listen) + '</span>';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            loadProductPlaylistAndPlay(productId, 0);
        });

        // Insert at the very start of the short description so it's the
        // first thing readers see (matches HHV's placement).
        short.insertBefore(btn, short.firstChild);
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /* ============================================================ */
    /*  INTEGRATED PRODUCT PLAYLIST                                 */
    /* ============================================================ */

    /**
     * Wires the click handlers of the integrated product playlist (the
     * `<div class="orp-product-playlist">` rendered by the
     * hookDisplayProductPlaylistPlugin server-side template). Each row
     * has a `.orp-track-play` button with data-product-id, data-track-index,
     * data-track-url. Clicking it loads the matching track in the persistent
     * footer player. The "play all" button at the top loads the full
     * product playlist via the same mechanism as a card-grid play button.
     */
    function wireProductPlaylist() {
        var widgets = document.querySelectorAll('.orp-product-playlist');
        if (!widgets.length) return;

        widgets.forEach(function (widget) {
            if (widget.getAttribute('data-orp-bound') === '1') return;
            widget.setAttribute('data-orp-bound', '1');

            // Per-track play buttons.
            widget.querySelectorAll('.orp-track-play').forEach(function (btn) {
                btn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();

                    var productId  = parseInt(btn.getAttribute('data-product-id'), 10) || 0;
                    var trackIndex = parseInt(btn.getAttribute('data-track-index'), 10);
                    if (!productId || isNaN(trackIndex)) return;

                    // If the same track is already loaded, toggle play/pause.
                    if (state.productId === productId
                        && state.currentTrack === trackIndex
                        && state.loaded) {
                        togglePlay();
                        return;
                    }

                    loadProductPlaylistAndPlay(productId, trackIndex);
                });
            });

            // "Play all" button at the top of the widget.
            var playAllBtn = widget.querySelector('.orp-playlist-play-all');
            if (playAllBtn) {
                playAllBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var productId = parseInt(playAllBtn.getAttribute('data-product-id'), 10) || 0;
                    if (!productId) return;
                    loadProductPlaylistAndPlay(productId, 0);
                });
            }
        });
    }

    /**
     * Fetches the full product playlist and starts playback at the requested
     * track index. Same code path as onMiniPlayClick — same caching, same
     * error handling — so the integrated playlist is just another entry
     * point into the persistent footer player.
     */
    function loadProductPlaylistAndPlay(productId, startIndex) {
        if (els.player) els.player.classList.add('orp-loading');

        fetch(CONFIG.apiUrl + '?id_product=' + productId, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error) { dlog('product playlist load error', data.error); return; }
                loadPlaylist(data);
                if (startIndex > 0 && startIndex < state.playlist.length) {
                    loadTrack(startIndex);
                }
                playTrack();
                updateProductPlaylistPlayingState();
            })
            .catch(function (err) { dlog('product playlist fetch failed', err); })
            .finally(function () {
                if (els.player) els.player.classList.remove('orp-loading');
            });
    }

    /**
     * Synchronises the integrated playlist's `.is-playing` class with the
     * current state of the persistent footer player. Called on every
     * play/pause and on every track change so the highlighted row matches
     * what's actually audible.
     */
    function updateProductPlaylistPlayingState() {
        var widgets = document.querySelectorAll('.orp-product-playlist');
        if (!widgets.length) return;

        widgets.forEach(function (widget) {
            var widgetPid = parseInt(widget.getAttribute('data-product-id'), 10) || 0;
            widget.querySelectorAll('.orp-product-playlist__track').forEach(function (li) {
                var idx = parseInt(li.getAttribute('data-track-index'), 10);
                var isCurrent = (widgetPid === state.productId
                                 && idx === state.currentTrack
                                 && state.playing);
                li.classList.toggle('is-playing', isCurrent);
            });
        });
    }

    /* ============================================================ */
    /*  SWUP INTEGRATION                                            */
    /* ============================================================ */

    function shouldExcludeFromSwup(url) {
        var excludes = CONFIG.swupExcludePaths || [];
        var lower = url.toLowerCase();
        for (var i = 0; i < excludes.length; i++) {
            if (!excludes[i]) continue;
            if (lower.indexOf(String(excludes[i]).toLowerCase()) !== -1) return true;
        }
        return false;
    }

    // Defensive double-exclusion for language-switch links.
    //
    // Primary defence is the `:not([data-iso-code])` clause in the Swup
    // linkSelector, plus the 2-letter-prefix heuristic in ignoreVisit.
    // Both are brittle:
    //   - Themes that don't carry `data-iso-code` (custom selectors,
    //     wrapped buttons, JS-driven `location.href` writes) bypass it.
    //   - PS's `url entity='language'` helper renders `?id_lang=N` URLs,
    //     which the prefix heuristic can't detect (path is unchanged).
    // Operator-confirmed bug post-v2.5.2: switching language on a product
    // page swapped empty content into the container.
    //
    // This function flags every detectable language trigger with
    // `data-no-swup` so the Swup selector excludes them. It runs once at
    // init AND after every successful content:replace (the freshly-swapped
    // selector inside the new container needs re-tagging).
    function tagLanguageLinks(root) {
        try {
            var scope = root || document;
            var anchors = scope.querySelectorAll(
                'a[data-iso-code],' +
                'a[href*="id_lang="],' +
                '.language-selector a[href],' +
                '.js-language-selector a[href],' +
                '#_desktop_language_selector a[href],' +
                '#_mobile_language_selector a[href]'
            );
            for (var i = 0; i < anchors.length; i++) {
                anchors[i].setAttribute('data-no-swup', 'true');
            }
        } catch (e) {}
    }

    // Capture-phase fail-safe: even if the link somehow escapes the Swup
    // selector (e.g. dynamically inserted after a swap, before our
    // tagLanguageLinks pass runs), this listener fires BEFORE Swup's
    // delegated bubble-phase handler and stops propagation so the browser
    // performs a normal full-reload navigation.
    //
    // We don't preventDefault — only stop the event from bubbling into
    // Swup's delegated click handler.
    var __orpLangCaptureBound = false;
    function bindLanguageCaptureBlocker() {
        if (__orpLangCaptureBound) return;
        __orpLangCaptureBound = true;
        try {
            document.addEventListener('click', function (ev) {
                try {
                    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                    var target = ev.target;
                    if (!target || !target.closest) return;
                    var anchor = target.closest('a[href]');
                    if (!anchor) return;
                    var href = anchor.getAttribute('href') || '';
                    var isLang = anchor.hasAttribute('data-iso-code')
                              || anchor.hasAttribute('data-no-swup')
                              || href.indexOf('id_lang=') !== -1
                              || anchor.closest('.language-selector')
                              || anchor.closest('.js-language-selector')
                              || anchor.closest('#_desktop_language_selector')
                              || anchor.closest('#_mobile_language_selector');
                    if (!isLang) return;
                    ev.stopImmediatePropagation();
                } catch (e) {}
            }, true);
        } catch (e) {}
    }

    /**
     * Resolves the configured container selector(s) to an actual DOM element.
     * The setting accepts comma-separated selectors as fallbacks. We try them
     * in two passes:
     *   1. Find the first selector whose element exists AND contains at least
     *      one product card (productSelectors). This is the strong match —
     *      Swup will swap a region that's actually relevant to listings.
     *   2. If no selector satisfies the product-card constraint (e.g. CMS
     *      pages without a product grid), accept the first selector that
     *      simply exists in the DOM. Swup still works for navigation between
     *      these pages and we keep the player alive across them.
     *
     * Returns either { selector, element, withProducts } or null if no match.
     */
    function resolveSwupContainer() {
        var raw = (CONFIG.swupContainer || '').trim();
        if (!raw) return null;

        var selectors    = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var productSel   = (CONFIG.productSelectors || '').trim();
        var firstExisting = null;

        for (var i = 0; i < selectors.length; i++) {
            var sel = selectors[i];
            var el  = null;
            try {
                el = document.querySelector(sel);
            } catch (e) {
                dlog('invalid container selector', sel, e);
                continue;
            }
            if (!el) continue;
            if (!firstExisting) firstExisting = { selector: sel, element: el, withProducts: false };

            if (productSel) {
                try {
                    if (el.querySelector(productSel)) {
                        return { selector: sel, element: el, withProducts: true };
                    }
                } catch (e) {
                    dlog('invalid productSelectors during container resolve', e);
                }
            }
        }

        return firstExisting; // may be null
    }

    /**
     * Merge data from the new page's `var prestashop = {...}` block into the
     * existing window.prestashop object instead of letting ScriptsPlugin
     * re-execute the inline script (which would replace the object and kill
     * every event listener attached by blockcart, faceted search, etc.).
     */
    function mergePrestashopData(html) {
        if (!html || typeof window.prestashop === 'undefined') return;
        try {
            var parser  = new DOMParser();
            var newDoc  = parser.parseFromString(html, 'text/html');
            var scripts = newDoc.querySelectorAll('script:not([src])');

            for (var i = 0; i < scripts.length; i++) {
                var code  = scripts[i].textContent || '';
                var match = code.match(/var\s+prestashop\s*=\s*(\{[\s\S]*?\})\s*;/);
                if (!match) continue;

                try {
                    var newData = JSON.parse(match[1]);
                    // Whitelist of pure-data keys (no methods).
                    var mergeKeys = [
                        'cart', 'customer', 'page', 'urls', 'breadcrumb',
                        'language', 'currency', 'country', 'shop',
                        'field_required', 'static_token', 'token', 'time',
                    ];
                    mergeKeys.forEach(function (k) {
                        if (typeof newData[k] !== 'undefined') {
                            window.prestashop[k] = newData[k];
                        }
                    });
                    dlog('mergePrestashop ok');
                } catch (parseErr) {
                    dlog('mergePrestashop parse error', parseErr);
                }
                break;
            }
        } catch (e) {
            dlog('mergePrestashop error', e);
        }
    }

    function cleanupSwupHtmlClasses() {
        try {
            var html = document.documentElement;
            ['is-leaving', 'is-rendering', 'is-animating', 'is-changing'].forEach(function (c) {
                html.classList.remove(c);
            });
        } catch (e) {}
    }

    function initSwup() {
        if (!CONFIG.swupEnabled) {
            dlog('swup disabled in config');
            return false;
        }

        // Bail if the CURRENT page is in the exclusion list. This is the
        // proper home for "don't SPA from this page" — the per-link
        // ignoreVisit() check elsewhere only catches links going TO an
        // excluded URL, not links going FROM one. Without this guard, the
        // contact page (fresh-loaded after extraExcludes triggered a full
        // reload) would still init Swup, and clicks back to the home would
        // fire a swap whose container resolution lands on a too-greedy
        // wrapper of the contact template — exactly the catastrophic state
        // captured in v2.4.5 (htmlClasses wiped, header/footer gone, etc.).
        try {
            if (shouldExcludeFromSwup(window.location.href)) {
                if (window.__orpMonitorEnqueue) {
                    try {
                        window.__orpMonitorEnqueue('orp:swup:skipped-on-excluded-page', {
                            currentUrl: window.location.pathname,
                        });
                    } catch (e) {}
                }
                try { console.warn('[ORP] Swup not initialized: current page is in exclusion list. All links from this page will full-reload.'); } catch (e) {}
                dlog('current page is in exclusion list — Swup not initialized');
                return false;
            }
        } catch (e) {
            dlog('exclusion self-check error', e);
        }

        // Per-session kill-switch: if the previous tab/page already had
        // 2+ failed swaps, fall back to classic navigation for this session.
        try {
            if (window.sessionStorage.getItem('orp_swup_killed') === '1') {
                dlog('swup killed for this session');
                return false;
            }
        } catch (e) {}

        if (typeof window.Swup !== 'function') {
            dlog('Swup library not loaded');
            return false;
        }

        var container = resolveSwupContainer();
        if (!container) {
            // Unconditional warning (not gated by debug) — operators need to
            // see this in production console to fix their container setting.
            try {
                console.warn(
                    '[ORP] Swup disabled: none of the configured container selectors matched. ' +
                    'Falling back to standalone (localStorage) mode. ' +
                    'Configured: "' + (CONFIG.swupContainer || '') + '". ' +
                    'Check the BO setting "Swup container selector(s)".'
                );
            } catch (e) {}
            return false;
        }
        dlog('swup container resolved to', container.selector, 'withProducts=', container.withProducts);

        var plugins = [];
        // SwupHeadPlugin with persistAssets: true keeps <link rel=stylesheet>,
        // <script src>, and <style> tags across swaps. Without this, ZOneTheme's
        // BO-generated inline <style> in <head> (which carries the custom theme
        // colours, header background, megamenu hover overrides etc.) gets
        // dropped by HeadPlugin's diff algorithm because the same content
        // re-rendered between pages doesn't always serialise to identical
        // outerHTML. Result before this fix: header noir devenait blanc,
        // megamenu hover cassé, etc. — captured in the v2.4.7 monitor as
        // `inlineStyleTags: "3" -> "2"` on every navigation.
        if (typeof window.SwupHeadPlugin === 'function') {
            plugins.push(new window.SwupHeadPlugin({ persistAssets: true }));
        }
        if (typeof window.SwupScriptsPlugin === 'function') {
            plugins.push(new window.SwupScriptsPlugin({ head: true, body: true }));
        }
        if (typeof window.SwupBodyClassPlugin === 'function') plugins.push(new window.SwupBodyClassPlugin());
        if (typeof window.SwupPreloadPlugin === 'function') {
            plugins.push(new window.SwupPreloadPlugin({
                preloadHoveredLinks: !!CONFIG.swupPreload,
                preloadVisibleLinks: false,
            }));
        }

        try {
            // Expose the Swup instance for the optional diagnostic monitor
            // (loaded separately as monitor.js) which polls for it and binds
            // its own hooks for visit lifecycle telemetry.
            // The assignment happens AFTER successful instantiation below.
            swupInstance = new window.Swup({
                containers: [container.selector],
                animationSelector: false,
                plugins: plugins,
                // Links the language selector renders carry `data-iso-code`
                // (cf. modules/ps_languageselector/ps_languageselector.tpl
                // in ZOneTheme). PrestaShop's `url entity='language'` helper
                // produces URLs like `/?id_lang=N` rather than the path-
                // prefix form `/fr/...` we detect in ignoreVisit, so Swup
                // would otherwise try to swap into them and end up with a
                // mismatched layout. Excluding them here forces a full
                // reload — the only correct behaviour on language change
                // anyway, since the entire shop content is re-rendered.
                linkSelector: 'a[href]:not([target="_blank"]):not([data-no-swup]):not([data-link-action]):not([data-iso-code]):not(.js-quick-view):not(.js-ajax-add-to-cart):not([href^="#"]):not([href^="javascript:"]):not([href^="mailto:"]):not([href^="tel:"])',
                ignoreVisit: function (url) {
                    try {
                        var u = new URL(url, window.location.origin);
                        if (u.origin !== window.location.origin) return true;

                        // Language switch: leading 2-letter prefix differs.
                        var curMatch  = window.location.pathname.match(/^\/([a-z]{2})(\/|$)/);
                        var tgtMatch  = u.pathname.match(/^\/([a-z]{2})(\/|$)/);
                        if (curMatch && tgtMatch && curMatch[1] !== tgtMatch[1]) return true;
                    } catch (e) { return true; }

                    if (/\.(pdf|zip|mp3|wav|ogg|jpg|jpeg|png|gif|svg|webp|mp4|webm|doc|docx|xls|xlsx)(\?|$)/i.test(url)) {
                        return true;
                    }
                    if (shouldExcludeFromSwup(url)) return true;
                    return false;
                },
            });
        } catch (err) {
            dlog('Swup init failed, falling back to localStorage', err);
            swupInstance = null;
            return false;
        }

        bindSwupHooks();
        try { window.__orpSwup = swupInstance; } catch (e) {}
        return true;
    }

    /**
     * Returns the current watchdog timeout in ms. Reads, in order of priority:
     *   1. The previously-measured value cached in sessionStorage (adaptive)
     *   2. The BO-configured CONFIG.watchdogMs
     *   3. The hardcoded 1500ms fallback (compat for installs upgrading from
     *      v2.0.0 where CONFIG.watchdogMs may be missing)
     */
    function getWatchdogMs() {
        var maxMs = parseInt(CONFIG.watchdogMaxMs, 10) || 5000;
        try {
            var cached = parseInt(window.sessionStorage.getItem('orp_watchdog_ms'), 10);
            if (cached && cached > 0) return Math.min(cached, maxMs);
        } catch (e) {}

        var configured = parseInt(CONFIG.watchdogMs, 10);
        if (configured && configured > 0) return Math.min(configured, maxMs);
        return 1500;
    }

    function bindSwupHooks() {
        if (!swupInstance) return;

        var lastVisit = {
            targetUrl: null, startedAt: 0, contentSignature: '',
            timer: null, replaced: false,
        };

        function getContentSignature() {
            try {
                var resolved = resolveSwupContainer();
                var c = resolved ? resolved.element : null;
                if (!c) return '';
                var html = c.innerHTML || '';
                return html.length + ':' + html.substr(0, 200);
            } catch (e) { return ''; }
        }

        function bumpFailureCount() {
            try {
                var cur = parseInt(window.sessionStorage.getItem('orp_swup_fails') || '0', 10) || 0;
                cur++;
                window.sessionStorage.setItem('orp_swup_fails', String(cur));
                if (cur >= 2) {
                    window.sessionStorage.setItem('orp_swup_killed', '1');
                    dlog('swup session killed after', cur, 'failures');
                }
                return cur;
            } catch (e) { return 0; }
        }

        // Mark inline `var prestashop = {...}` blocks so ScriptsPlugin doesn't
        // re-execute them (which would replace the live prestashop object).
        swupInstance.hooks.before('content:replace', function (visit) {
            try {
                var html = visit && visit.to && visit.to.html ? visit.to.html : '';
                if (html) mergePrestashopData(html);

                var doc = visit && visit.to && visit.to.document ? visit.to.document : null;
                if (!doc) return;
                var scripts = doc.querySelectorAll('script:not([src])');
                scripts.forEach(function (s) {
                    var code = s.textContent || '';
                    if (/var\s+prestashop\s*=/.test(code)) {
                        s.setAttribute('data-swup-ignore-script', '');
                    }
                });
            } catch (e) {
                dlog('before:content:replace error', e);
            }
        });

        swupInstance.hooks.on('content:replace', function (visit) {
            // SAFETY NET: catastrophic swap detection, deferred. The v2.4.5
            // detector ran inline in this hook but the v2.4.5 monitor capture
            // proved Swup's class manipulation on <html> happens AFTER our
            // hook (probably in another plugin's content:replace handler
            // registered later in the chain). By the time we'd checked, the
            // class hadn't been wiped yet. Deferring via setTimeout(0)
            // pushes the check to the end of the current task queue, after
            // every sync hook has run — at which point the catastrophic
            // state is fully visible.
            //
            // This is a SAFETY NET: the primary fix for the contact-page
            // catastrophe is the new "skip Swup init when current URL is in
            // the exclusion list" check up in initSwup(). The detector
            // below catches any OTHER page that breaks Swup we haven't
            // listed yet.
            var destUrl = (visit && visit.to && visit.to.url) ? visit.to.url : window.location.href;
            setTimeout(function () {
                if (document.documentElement.classList.contains('swup-enabled')) return;
                if (window.__orpMonitorEnqueue) {
                    try {
                        window.__orpMonitorEnqueue('orp:catastrophic-swap-recovered', {
                            destUrl: destUrl,
                            missing: 'swup-enabled-class-on-html',
                        });
                    } catch (e) {}
                }
                try { console.warn('[ORP] catastrophic swap detected (swup-enabled class wiped from <html>) — full reload to', destUrl); } catch (e) {}
                window.location.assign(destUrl);
            }, 0);

            scheduleInject();
            // Re-tag language switcher triggers in the freshly-swapped DOM.
            // The capture-phase blocker is process-wide so it stays bound,
            // but `data-no-swup` attributes only exist on the live nodes
            // inside the new container.
            tagLanguageLinks();
            try {
                if (typeof window.prestashop !== 'undefined' && typeof window.prestashop.emit === 'function') {
                    // The `reason` payload is mandatory for some third-party
                    // modules that read it to decide whether to re-bind their
                    // listeners. Emitting `updatedProduct` here was also
                    // dropped: it crashed listeners that expect a populated
                    // event payload (we have none on a SPA navigation).
                    window.prestashop.emit('updatedProductList', { reason: 'orp:swup-navigation' });
                }
            } catch (e) {}
            initProductPage();

            // First, top up the cache with any persistent classes the new
            // page brought that we didn't know about (handles the case
            // where the user started on a page lacking country-fr / lang-fr
            // and only later visits a page that has them).
            topUpPersistentBodyClasses();

            // Restore persistent body classes (lang/country/currency/customer)
            // BEFORE the theme preset runs, in case any theme component reads
            // body.classList for its layout decisions during reinit.
            var restoredClasses = restorePersistentBodyClasses();
            if (restoredClasses.length && window.__orpMonitorEnqueue) {
                try {
                    window.__orpMonitorEnqueue('orp:body-class-restored', {
                        restored: restoredClasses.join(','),
                    });
                } catch (e) {}
            }

            // Theme reinit preset (bundled, versioned in git). Loaded by PHP
            // when CONFIG.themePreset !== 'none'. The preset registers itself
            // on window.orpThemePresets[name] without running anything on
            // file-load, so we explicitly invoke it here. Each preset is
            // self-sandboxed (try/catch around each individual reinit step).
            var presetName = CONFIG.themePreset;
            if (presetName && presetName !== 'none'
                && window.orpThemePresets
                && typeof window.orpThemePresets[presetName] === 'function') {
                try {
                    // Pass an explicit context so presets can guard against
                    // accidental invocation from outside the Swup pipeline
                    // (defensive — see zonetheme.js for the matching guard).
                    window.orpThemePresets[presetName]({ trigger: 'swup-content-replace' });
                } catch (e) {
                    try { console.warn('[ORP] theme preset "' + presetName + '" error:', e); } catch (err) {}
                    // Surface in the diagnostic monitor when enabled.
                    if (window.__orpMonitorEnqueue) {
                        try {
                            window.__orpMonitorEnqueue('orp:preset:error', {
                                preset: presetName,
                                message: (e && e.message) ? String(e.message).substring(0, 400) : 'unknown',
                            });
                        } catch (mErr) {}
                    }
                }
            }

            // Custom JS hook (additional code, runs AFTER the theme preset).
            // Runs BEFORE the watchdog adaptation so its runtime is included
            // in the measured swap duration — slow reinit themes automatically
            // get a proportionally larger watchdog window.
            if (CONFIG.postSwapJs) {
                try {
                    new Function(CONFIG.postSwapJs)();
                } catch (e) {
                    try { console.warn('[ORP] postSwapJs error:', e); } catch (err) {}
                }
            }

            // Adaptive watchdog: measure the actual swap duration and, if it
            // was slow (> 1s), bump the watchdog timeout for subsequent visits
            // in this session. This protects shops with slow back-ends from
            // false-positive watchdog reloads while keeping snappy shops on
            // the default 1.5s.
            if (lastVisit.startedAt) {
                var elapsed = Date.now() - lastVisit.startedAt;
                if (elapsed > 1000) {
                    var maxMs    = parseInt(CONFIG.watchdogMaxMs, 10) || 5000;
                    var newWdMs  = Math.min(elapsed * 2, maxMs);
                    var current  = getWatchdogMs();
                    if (newWdMs > current) {
                        try {
                            window.sessionStorage.setItem('orp_watchdog_ms', String(newWdMs));
                            dlog('watchdog adapted from', current, 'to', newWdMs, 'ms (last swap took', elapsed, 'ms)');
                        } catch (e) {}
                    }
                }
            }

            lastVisit.replaced = true;
        });

        swupInstance.hooks.on('visit:start', function (visit) {
            var toUrl = visit && visit.to && visit.to.url ? visit.to.url : '?';
            if (els.player) els.player.classList.add('orp-navigating');

            lastVisit.targetUrl        = toUrl;
            lastVisit.startedAt        = Date.now();
            lastVisit.contentSignature = getContentSignature();
            lastVisit.replaced         = false;

            if (lastVisit.timer) clearTimeout(lastVisit.timer);
            // If, after the configured (or adaptive) watchdog window, the URL
            // has changed but the content hasn't, assume the swap silently
            // failed and force a full reload.
            var watchdogMs = getWatchdogMs();
            lastVisit.timer = setTimeout(function () {
                if (lastVisit.replaced) return;
                var currentUrl = window.location.href;
                var currentSig = getContentSignature();
                var urlMatches = currentUrl.indexOf(lastVisit.targetUrl) !== -1
                              || (lastVisit.targetUrl && lastVisit.targetUrl.indexOf(currentUrl) !== -1);
                var contentChanged = currentSig !== lastVisit.contentSignature;

                if (urlMatches && !contentChanged) {
                    bumpFailureCount();
                    cleanupSwupHtmlClasses();
                    dlog('watchdog: forcing full reload after', watchdogMs, 'ms', lastVisit.targetUrl);
                    window.location.href = lastVisit.targetUrl;
                }
            }, watchdogMs);
        });

        swupInstance.hooks.on('visit:end', function () {
            if (els.player) els.player.classList.remove('orp-navigating');
            lastVisit.replaced = true;
            if (lastVisit.timer) { clearTimeout(lastVisit.timer); lastVisit.timer = null; }
            try { window.sessionStorage.setItem('orp_swup_fails', '0'); } catch (e) {}
            cleanupSwupHtmlClasses();
        });

        swupInstance.hooks.on('visit:abort', function () {
            cleanupSwupHtmlClasses();
            if (lastVisit.timer) { clearTimeout(lastVisit.timer); lastVisit.timer = null; }
        });

        swupInstance.hooks.on('fetch:error', function (visit) {
            cleanupSwupHtmlClasses();
            bumpFailureCount();
            if (visit && visit.to && visit.to.url) {
                window.location.href = visit.to.url;
            }
        });

        swupInstance.hooks.on('page:view', function () {
            // Re-emit page_view for analytics that don't track SPA navigations.
            try {
                var newPath = window.location.pathname + window.location.search;
                if (typeof window.gtag === 'function') {
                    window.gtag('event', 'page_view', {
                        page_path: newPath,
                        page_location: window.location.href,
                        page_title: document.title,
                    });
                }
                if (typeof window.dataLayer !== 'undefined' && window.dataLayer.push) {
                    window.dataLayer.push({ event: 'swup:page_view', page: newPath });
                }
                if (typeof window.fbq === 'function') window.fbq('track', 'PageView');
            } catch (e) {}
        });
    }

    /* ============================================================ */
    /*  INIT                                                        */
    /* ============================================================ */

    /**
     * Captures the body classes that should persist across every page on
     * this shop (locale/currency/customer flags). Called once at init,
     * before any Swup navigation, so we lock in the canonical set before
     * theme-specific page classes can shadow them.
     */
    function capturePersistentBodyClasses() {
        try {
            if (!document.body) return;
            var current = Array.prototype.slice.call(document.body.classList);
            persistentBodyClasses = current.filter(function (c) {
                for (var i = 0; i < PERSISTENT_BODY_CLASS_PATTERNS.length; i++) {
                    if (PERSISTENT_BODY_CLASS_PATTERNS[i].test(c)) return true;
                }
                return false;
            });
            dlog('persistent body classes captured:', persistentBodyClasses);
        } catch (e) {
            dlog('capturePersistentBodyClasses error', e);
        }
    }

    /**
     * Continuous capture: merges any persistent classes seen on the current
     * (post-swap) body into our cached set. This handles the case where the
     * user starts on a page that lacks `country-fr lang-fr currency-eur`
     * (e.g., a category page on ZOneTheme) — without this we'd never know
     * those classes exist and could never restore them. Call after every
     * content:replace to keep the cache up to date.
     */
    function topUpPersistentBodyClasses() {
        try {
            if (!document.body) return;
            var seen = {};
            for (var i = 0; i < persistentBodyClasses.length; i++) {
                seen[persistentBodyClasses[i]] = true;
            }
            var current = Array.prototype.slice.call(document.body.classList);
            for (var j = 0; j < current.length; j++) {
                var c = current[j];
                if (seen[c]) continue;
                for (var k = 0; k < PERSISTENT_BODY_CLASS_PATTERNS.length; k++) {
                    if (PERSISTENT_BODY_CLASS_PATTERNS[k].test(c)) {
                        persistentBodyClasses.push(c);
                        seen[c] = true;
                        dlog('persistent body class added to cache:', c);
                        break;
                    }
                }
            }
        } catch (e) {
            dlog('topUpPersistentBodyClasses error', e);
        }
    }

    /**
     * Re-applies any persistent body class missing from the post-swap body.
     * Returns the list of classes actually re-added (for monitor telemetry).
     */
    function restorePersistentBodyClasses() {
        var restored = [];
        try {
            if (!document.body || !persistentBodyClasses.length) return restored;
            for (var i = 0; i < persistentBodyClasses.length; i++) {
                var c = persistentBodyClasses[i];
                if (!document.body.classList.contains(c)) {
                    document.body.classList.add(c);
                    restored.push(c);
                }
            }
        } catch (e) {
            dlog('restorePersistentBodyClasses error', e);
        }
        return restored;
    }

    function init() {
        cacheDom();
        if (!els.player || !audio) {
            dlog('player DOM missing, abort');
            return;
        }

        capturePersistentBodyClasses();
        detachPlayerToBody();
        bindEvents();
        // Language-switcher hardening: tag known triggers + install
        // capture-phase fail-safe before Swup's delegated handler binds.
        tagLanguageLinks();
        bindLanguageCaptureBlocker();

        var swupOk = initSwup();
        dlog('init complete, swup =', swupOk);

        if (!swupOk) {
            // Standalone mode: try to restore the previous playlist position.
            restoreState();
        }

        injectPlayButtons();
        initProductPage();

        // Re-inject buttons after PrestaShop's own listing updates (faceted
        // search, infinite scroll, etc.).
        if (typeof window.prestashop !== 'undefined' && typeof window.prestashop.on === 'function') {
            try {
                window.prestashop.on('updateProductList',  scheduleInject);
                window.prestashop.on('updatedProductList', scheduleInject);
            } catch (e) {}
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
