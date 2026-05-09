/**
 * OnlyRoots Persistent Audio Player — parent-side messenger
 *
 * v3.0.0-alpha4 design principles:
 *   - **Self-diagnostic at boot** : every step logs its result; if
 *     anything fails, a visible red overlay appears at the top of the
 *     page (debug mode only) with the exact reason.
 *   - **Resilient to missing config** : if `window.onlyrootsPlayerConfig`
 *     is absent (Media::addJsDef didn't run, the global got overwritten,
 *     etc.), the iframe URL is *deduced* from `window.location` using
 *     the standard PrestaShop module-link pattern.
 *   - **Verifiable iframe load** : after the iframe is appended, we
 *     listen for the `load` event and inspect `contentDocument` for
 *     the expected player markup. If the iframe loaded but the
 *     content is invalid (e.g. frame.php returned 500 with an HTML
 *     error page), the debug overlay surfaces it.
 *
 * Responsibilities:
 *   1. Inject the persistent iframe at boot
 *   2. Find product cards on listings and inject mini play buttons
 *   3. On card play click: fetch playlist, postMessage to iframe
 *   4. Listen to iframe messages to keep mini-button visuals in sync
 *   5. Handle integrated product-page playlist clicks (Papp mode)
 *   6. iOS user-gesture warm-up
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @version   3.0.0-alpha4
 */
(function () {
    'use strict';

    /* ============================================================ *
     *  CONFIG RESOLUTION (resilient to missing globals)            *
     * ============================================================ */

    var CONFIG = (typeof window.onlyrootsPlayerConfig === 'object' && window.onlyrootsPlayerConfig)
        ? window.onlyrootsPlayerConfig
        : {};
    var DEBUG  = !!CONFIG.debug;

    /* ============================================================ *
     *  SELF-DIAGNOSTIC — visible debug overlay                     *
     *                                                              *
     * In debug mode (BO toggle), if any boot step fails we paint a *
     * red banner at the top of the page with the exact reason.    *
     * Operators don't need F12 to know what broke.                *
     * ============================================================ */

    var diagnosticSteps = [];

    function dlog() {
        if (!DEBUG || !window.console) return;
        try { window.console.log.apply(window.console, ['[ORP/bridge]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function recordStep(label, ok, detail) {
        diagnosticSteps.push({ label: label, ok: !!ok, detail: detail || '' });
        dlog((ok ? '✓' : '✗') + ' ' + label + (detail ? ' — ' + detail : ''));
    }

    /**
     * @param {Array} failedSteps  steps from `diagnosticSteps` to display
     * @param {Object} [opts]
     * @param {boolean} [opts.force=false]  when true, ignore the DEBUG flag.
     *        Use for *infrastructure* failures (iframe didn't load, frame.php
     *        500, etc.) — the operator must see those even with debug off.
     */
    function showDebugOverlay(failedSteps, opts) {
        var force = !!(opts && opts.force);
        if (!DEBUG && !force) return;
        try {
            // Don't add overlay twice.
            if (document.getElementById('orp-debug-overlay')) return;
            var overlay = document.createElement('div');
            overlay.id = 'orp-debug-overlay';
            overlay.setAttribute('style', [
                'position:fixed', 'top:0', 'left:0', 'right:0',
                'background:#dc2626', 'color:#fff',
                'font:12px/1.4 monospace', 'padding:8px 12px',
                'z-index:99999', 'border-bottom:2px solid #991b1b',
                'box-shadow:0 2px 4px rgba(0,0,0,0.3)',
            ].join(';'));
            var lines = ['[OnlyRoots Player] boot failed:'].concat(
                failedSteps.map(function (s) { return '  ✗ ' + s.label + (s.detail ? ' — ' + s.detail : ''); })
            );
            overlay.textContent = lines.join('\n');
            overlay.style.whiteSpace = 'pre';
            // Add a close button so the overlay isn't permanent if the
            // operator wants to test the page.
            var closeBtn = document.createElement('span');
            closeBtn.textContent = ' [×]';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.float = 'right';
            closeBtn.addEventListener('click', function () { overlay.remove(); });
            overlay.appendChild(closeBtn);
            (document.body || document.documentElement).appendChild(overlay);
        } catch (e) { /* even our overlay can fail; nothing to do */ }
    }

    /* ============================================================ *
     *  FRAME URL DEDUCTION (resilient fallback)                    *
     *                                                              *
     * If CONFIG.frameUrl is missing for any reason (the parent     *
     * `Media::addJsDef` didn't run, a 3rd-party module overwrote   *
     * `window.onlyrootsPlayerConfig`, etc.), deduce the URL from   *
     * `window.location` using PrestaShop's standard module-link    *
     * URL pattern: `<origin>[/<lang>]/module/<name>/<action>`.     *
     *                                                              *
     * The lang prefix is detected from the current path: any path  *
     * starting with `/<2-letter>/` is treated as language-prefixed *
     * (PS friendly URLs with `Multi-shop` enabled).                *
     * ============================================================ */

    function deduceFrameUrl() {
        if (CONFIG.frameUrl && typeof CONFIG.frameUrl === 'string') {
            return CONFIG.frameUrl;
        }
        try {
            var origin = window.location.origin;
            var path   = window.location.pathname;
            var langMatch = path.match(/^\/([a-z]{2})\//i);
            var prefix = langMatch ? '/' + langMatch[1] : '';
            return origin + prefix + '/module/onlyrootsplayer/frame';
        } catch (e) {
            return '/module/onlyrootsplayer/frame';
        }
    }

    function getApiUrl() {
        // Same fallback strategy: try CONFIG, fall back to deduction.
        if (CONFIG.apiUrl && typeof CONFIG.apiUrl === 'string') return CONFIG.apiUrl;
        if (CONFIG.apiBase && typeof CONFIG.apiBase === 'string') return CONFIG.apiBase;
        try {
            var origin = window.location.origin;
            var path   = window.location.pathname;
            var langMatch = path.match(/^\/([a-z]{2})\//i);
            var prefix = langMatch ? '/' + langMatch[1] : '';
            return origin + prefix + '/module/onlyrootsplayer/playlist';
        } catch (e) {
            return '/module/onlyrootsplayer/playlist';
        }
    }

    /* ============================================================ *
     *  STATE                                                       *
     * ============================================================ */

    var iframeEl = null;
    var iframeReady = false;
    var pendingCommand = null;          // queued command if iframe not ready yet
    var hasWarmedUp = false;            // iOS gesture relay sent at least once
    var currentPlayingProductId = null; // for mini-button highlighting
    var currentPlayingTrackIdx  = -1;   // for integrated playlist row highlighting
    var currentIsPlaying        = false; // for play/pause icon swap on track buttons
    var audioProductIds = new Set();    // products that have audio (cached)
    var playlistCache   = {};           // productId → cached fetched playlist

    /* ============================================================ *
     *  IFRAME DISCOVERY / INJECTION                                *
     *                                                              *
     * v3.0.0-alpha3+: instead of relying on the                    *
     * `displayBeforeBodyClosingTag` hook (which requires registration *
     * in the ps_hook_module table that doesn't happen on upgrade), *
     * bridge.js itself injects the iframe at boot. bridge.js is    *
     * loaded via `actionFrontControllerSetMedia` which fires on    *
     * EVERY front page reliably (proof: the integrated playlist on *
     * product pages always shows up). Pure-JS injection means we   *
     * have one fewer indirection AND the upgrade path becomes      *
     * trivial (operator just refreshes — no hook re-registration   *
     * needed).                                                     *
     * ============================================================ */

    function findIframe() {
        if (iframeEl && document.body.contains(iframeEl)) return iframeEl;
        iframeEl = document.getElementById('orp-frame');
        return iframeEl;
    }

    function ensureIframeInjected() {
        if (findIframe()) {
            recordStep('iframe-already-present', true, iframeEl.src);
            return iframeEl;
        }
        var frameUrl = deduceFrameUrl();
        if (!frameUrl) {
            recordStep('iframe-url-resolved', false, 'no CONFIG.frameUrl and deduction returned empty');
            return null;
        }
        recordStep('iframe-url-resolved', true,
            (CONFIG.frameUrl ? 'from CONFIG' : 'deduced from location') + ' = ' + frameUrl);
        try {
            iframeEl = document.createElement('iframe');
            iframeEl.id = 'orp-frame';
            iframeEl.src = frameUrl;
            iframeEl.title = 'Audio player';
            iframeEl.scrolling = 'no';
            iframeEl.setAttribute('allow', 'autoplay; encrypted-media');
            iframeEl.setAttribute('loading', 'eager');
            // data-swup-persist tells Swup (if present) to never touch
            // this element across swaps.
            iframeEl.setAttribute('data-swup-persist', 'orp-frame');
            // Don't let the iframe steal Tab focus by default.
            iframeEl.setAttribute('tabindex', '-1');

            // Verify the iframe document actually contains the player
            // markup once it loads. If frame.php returns 500 or an
            // unrelated document (3rd-party hijack, redirect, etc.),
            // surface that visibly instead of failing silently.
            //
            // The overlay is forced (DEBUG-independent) on infra failure
            // because "the player just doesn't appear" is a critical
            // user-facing breakage that the operator must see regardless
            // of whether they remembered to flip the BO debug toggle.
            iframeEl.addEventListener('load', function () {
                try {
                    // Same-origin: contentDocument is accessible.
                    var doc = iframeEl.contentDocument;
                    if (!doc) {
                        recordStep('iframe-load-verify', false, 'contentDocument null (cross-origin or detached)');
                        showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }), { force: true });
                        return;
                    }
                    // Self-reported error from frame.php's catch block?
                    // Surface its message + location directly.
                    var errMarker = doc.getElementById('orp-error');
                    if (errMarker) {
                        var errMsg   = errMarker.getAttribute('data-error') || '(no message)';
                        var errWhere = errMarker.getAttribute('data-where') || '';
                        recordStep('iframe-load-verify', false,
                            'frame.php reported error: ' + errMsg
                            + (errWhere ? ' (' + errWhere + ')' : ''));
                        showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }), { force: true });
                        return;
                    }
                    var marker = doc.getElementById('orp-player');
                    if (!marker) {
                        // Capture a 200-char excerpt to help diagnose
                        // (PHP error page, redirect, etc.).
                        var bodyText = (doc.body && doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                        recordStep('iframe-load-verify', false,
                            '#orp-player not found in iframe; body excerpt = "' + bodyText + '"');
                        showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }), { force: true });
                        return;
                    }
                    recordStep('iframe-load-verify', true, '#orp-player present');
                } catch (e) {
                    recordStep('iframe-load-verify', false, 'inspection threw: ' + (e && e.message || e));
                    showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }), { force: true });
                }
            }, false);

            iframeEl.addEventListener('error', function () {
                recordStep('iframe-load-verify', false, 'iframe error event fired');
                showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }), { force: true });
            }, false);

            document.body.appendChild(iframeEl);
            recordStep('iframe-injected', true, frameUrl);
        } catch (e) {
            recordStep('iframe-injected', false, (e && e.message) || String(e));
        }
        return iframeEl;
    }

    function postToIframe(type, payload) {
        var iframe = findIframe();
        if (!iframe || !iframe.contentWindow) {
            dlog('iframe not in DOM, queueing command', type);
            pendingCommand = { type: type, payload: payload };
            return false;
        }
        if (!iframeReady && type !== 'warmup-audio' && type !== 'request-state') {
            dlog('iframe not ready, queueing command', type);
            pendingCommand = { type: type, payload: payload };
            return false;
        }
        try {
            var msg = { source: 'orp-bridge', type: type };
            if (payload) {
                for (var k in payload) {
                    if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
                }
            }
            iframe.contentWindow.postMessage(msg, '*');
            return true;
        } catch (e) { dlog('postToIframe error', e); return false; }
    }

    function flushPendingCommand() {
        if (!pendingCommand) return;
        var cmd = pendingCommand;
        pendingCommand = null;
        postToIframe(cmd.type, cmd.payload);
    }

    /* ============================================================ *
     *  IFRAME MESSAGE HANDLING                                     *
     * ============================================================ */

    function onIframeMessage(ev) {
        if (!ev || !ev.data || ev.data.source !== 'orp') return;
        var msg = ev.data;
        dlog('msg from iframe', msg.type);

        switch (msg.type) {
            case 'ready':
                iframeReady = true;
                flushPendingCommand();
                // If the iframe restored state from localStorage on a
                // parent reload, ask it to send us a `state` snapshot
                // so we can paint the mini-button + integrated
                // playlist visuals correctly without the user having
                // to interact first.
                if (msg.restored) {
                    postToIframe('request-state', {});
                }
                break;
            case 'track-changed':
                if (typeof msg.productId !== 'undefined') {
                    setCurrentPlaying(msg.productId, typeof msg.trackIndex === 'number' ? msg.trackIndex : -1, true);
                }
                break;
            case 'playing-state':
                currentIsPlaying = !!msg.isPlaying;
                if (currentIsPlaying === false) {
                    // Don't reset productId/trackIndex on pause — the
                    // user can resume. But update icon state.
                    syncIntegratedPlaylistIcons();
                } else {
                    syncIntegratedPlaylistIcons();
                }
                break;
            case 'closed':
                setCurrentPlaying(null, -1, false);
                break;
            case 'state':
                // Iframe responded to our request-state. Sync our
                // mini-button + integrated-playlist visuals to match.
                if (typeof msg.productId !== 'undefined' && msg.productId !== null) {
                    setCurrentPlaying(
                        msg.productId,
                        typeof msg.currentIdx === 'number' ? msg.currentIdx : -1,
                        !!msg.isPlaying
                    );
                }
                break;
            // 'visibility', 'play-rejected', 'ended', 'error' —
            // we don't need to do anything in the parent for those.
        }
    }

    /* ============================================================ *
     *  IOS GESTURE WARM-UP                                         *
     *                                                              *
     * Critical for iOS Safari: a programmatic `audio.play()` from   *
     * inside the iframe is rejected if the iframe hasn't yet had a  *
     * direct user interaction. The parent has had clicks (buttons,  *
     * links) but those don't propagate the user-activation token    *
     * cross-frame in iOS reliably.                                  *
     *                                                              *
     * Workaround: capture the very first user click in the parent   *
     * (any click, anywhere) and immediately postMessage             *
     * "warmup-audio" to the iframe. The iframe responds by doing a  *
     * silent play/pause cycle on its <audio> element, which         *
     * "unlocks" the audio context for the iframe's window. Future   *
     * play() calls then succeed.                                    *
     * ============================================================ */

    function bindIOSWarmup() {
        var handler = function () {
            if (hasWarmedUp) return;
            hasWarmedUp = true;
            postToIframe('warmup-audio', {});
            // Once warmed up, remove the listener so we don't fire on
            // every click for the rest of the session.
            ['click', 'touchend', 'keydown'].forEach(function (ev) {
                document.removeEventListener(ev, handler, true);
            });
        };
        ['click', 'touchend', 'keydown'].forEach(function (ev) {
            document.addEventListener(ev, handler, true);
        });
    }

    /* ============================================================ *
     *  PRODUCT CARD DISCOVERY + PLAY BUTTON INJECTION              *
     * ============================================================ */

    var PRODUCT_SELECTORS = (CONFIG.productSelectors ||
        '.js-product-miniature[data-id-product], .product-miniature[data-id-product], article.product[data-id-product]')
        .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    var BUTTON_ANCHORS = (CONFIG.buttonAnchor ||
        '.buttons-sections, .product-list-actions, .product-add-to-cart, .product-buttons')
        .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    function findProductCards(root) {
        root = root || document;
        var cards = [];
        for (var i = 0; i < PRODUCT_SELECTORS.length; i++) {
            try {
                var found = root.querySelectorAll(PRODUCT_SELECTORS[i]);
                for (var j = 0; j < found.length; j++) cards.push(found[j]);
            } catch (e) {}
        }
        // Dedupe (same card can match multiple selectors)
        return cards.filter(function (el, i, arr) { return arr.indexOf(el) === i; });
    }

    function getProductIdFromCard(card) {
        var raw = card.getAttribute('data-id-product');
        if (!raw) return null;
        var n = parseInt(raw, 10);
        return isNaN(n) ? null : n;
    }

    function fetchAudioProductIds(ids) {
        if (!ids || ids.length === 0) return Promise.resolve([]);
        var base = getApiUrl();
        if (!base) { dlog('apiUrl missing, cannot batch'); return Promise.resolve([]); }
        var url = base + (base.indexOf('?') === -1 ? '?' : '&')
                  + 'action=batch&ids=' + encodeURIComponent(ids.join(','));
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && Array.isArray(data.audio_ids)) return data.audio_ids;
                return [];
            })
            .catch(function (e) { dlog('fetchAudioProductIds error', e); return []; });
    }

    function fetchPlaylist(productId) {
        // Per-session cache so navigating away and back doesn't refetch
        // the same playlist. Keyed by productId.
        if (playlistCache[productId]) {
            return Promise.resolve(playlistCache[productId]);
        }
        var base = getApiUrl();
        if (!base) { dlog('apiUrl missing, cannot fetch playlist'); return Promise.resolve(null); }
        var url = base + (base.indexOf('?') === -1 ? '?' : '&')
                  + 'id_product=' + encodeURIComponent(productId);
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && Array.isArray(data.tracks)) {
                    playlistCache[productId] = data;
                }
                return data;
            })
            .catch(function (e) { dlog('fetchPlaylist error', e); return null; });
    }

    function findAnchorInCard(card) {
        for (var i = 0; i < BUTTON_ANCHORS.length; i++) {
            try {
                var anchor = card.querySelector(BUTTON_ANCHORS[i]);
                if (anchor) return anchor;
            } catch (e) {}
        }
        return null;
    }

    function buildPlayButton(productId) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'orp-card-play';
        btn.setAttribute('data-orp-product', String(productId));
        btn.setAttribute('aria-label', 'Lecture');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
                        '<polygon points="3,2 3,12 11,7" fill="currentColor"/></svg>';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            handleCardPlayClick(productId, card(btn));
        });
        return btn;
    }

    function card(btn) {
        return btn.closest('[data-id-product]');
    }

    function injectButtonsIntoCards(cards) {
        if (!cards || cards.length === 0) return;
        var idsNeedingCheck = [];
        cards.forEach(function (c) {
            var id = getProductIdFromCard(c);
            if (id && !c.querySelector('.orp-card-play[data-orp-product="' + id + '"]')) {
                idsNeedingCheck.push(id);
            }
        });
        if (idsNeedingCheck.length === 0) return;

        fetchAudioProductIds(idsNeedingCheck).then(function (audioIds) {
            audioIds.forEach(function (id) { audioProductIds.add(id); });
            cards.forEach(function (c) {
                var id = getProductIdFromCard(c);
                if (!id || !audioProductIds.has(id)) return;
                if (c.querySelector('.orp-card-play[data-orp-product="' + id + '"]')) return;
                var anchor = findAnchorInCard(c);
                if (!anchor) return;
                var btn = buildPlayButton(id);
                anchor.insertBefore(btn, anchor.firstChild);
                if (currentPlayingProductId === id) btn.classList.add('orp-card-play--playing');
            });
        });
    }

    /* ============================================================ *
     *  CARD PLAY CLICK HANDLER                                     *
     * ============================================================ */

    function handleCardPlayClick(productId, cardEl) {
        dlog('card play clicked', productId);
        if (currentPlayingProductId === productId) {
            // Already playing this product → toggle pause
            postToIframe('toggle', {});
            return;
        }
        var name = '';
        var url  = '';
        if (cardEl) {
            var nameEl = cardEl.querySelector('h3 a, h2 a, .product-title a, [itemprop="name"]');
            if (nameEl) {
                name = (nameEl.textContent || '').trim();
                if (nameEl.tagName === 'A') url = nameEl.getAttribute('href') || '';
            }
        }
        fetchPlaylist(productId).then(function (data) {
            if (!data || !data.tracks || data.tracks.length === 0) {
                dlog('no playlist for product', productId);
                return;
            }
            postToIframe('load', {
                productId:   productId,
                productName: data.product_name || name,
                productUrl:  data.product_url  || url,
                playlist:    data.tracks,
                startIndex:  0,
                autoplay:    true,
            });
        });
    }

    /* ============================================================ *
     *  INTEGRATED PRODUCT PLAYLIST CLICK HANDLER                   *
     *                                                              *
     * On product pages (when the operator has enabled              *
     * CFG_REPLACE_PAPP_PLAYER), product-playlist.tpl renders a     *
     * full track listing inside the product description with one   *
     * `<button class="orp-track-play">` per track. In v2.5.x       *
     * these clicks were caught by player.js. In v3, player.js is   *
     * gone and we handle them here in the parent-side bridge —     *
     * postMessage to the iframe with the playlist + the clicked    *
     * track's index as the starting point.                         *
     * ============================================================ */

    function handleIntegratedTrackClick(btn) {
        var productId  = parseInt(btn.getAttribute('data-product-id'), 10);
        var trackIdx   = parseInt(btn.getAttribute('data-track-index'), 10);
        if (isNaN(productId) || isNaN(trackIdx)) return;

        dlog('integrated track clicked', productId, trackIdx);

        // Same product, same track, currently playing → toggle pause.
        if (productId === currentPlayingProductId
            && trackIdx === currentPlayingTrackIdx
            && currentIsPlaying) {
            postToIframe('toggle', {});
            return;
        }

        // Same product but different track → just send a load with
        // startIndex (we likely have the playlist cached).
        // Different product → fetch playlist if not cached.
        var productLink = '';
        var productName = '';
        try {
            var pageH1 = document.querySelector('.product-detail-name, h1.product-name, h1[itemprop="name"]');
            if (pageH1) productName = (pageH1.textContent || '').trim();
            productLink = window.location.href;
        } catch (e) {}

        fetchPlaylist(productId).then(function (data) {
            if (!data || !data.tracks || data.tracks.length === 0) {
                dlog('no playlist for product', productId);
                return;
            }
            var safeIdx = (trackIdx >= 0 && trackIdx < data.tracks.length) ? trackIdx : 0;
            postToIframe('load', {
                productId:   productId,
                productName: data.product_name || productName,
                productUrl:  data.product_url  || productLink,
                playlist:    data.tracks,
                startIndex:  safeIdx,
                autoplay:    true,
            });
        });
    }

    function bindIntegratedPlaylistDelegate() {
        // Delegated click on document so it works for the playlist
        // markup whether it was rendered server-side or injected by
        // a Swup swap or AS4 listing update.
        document.addEventListener('click', function (ev) {
            try {
                if (!ev.target || !ev.target.closest) return;
                var btn = ev.target.closest('.orp-product-playlist .orp-track-play');
                if (!btn) return;
                ev.preventDefault();
                ev.stopPropagation();
                handleIntegratedTrackClick(btn);
            } catch (e) { dlog('integrated click delegate error', e); }
        }, false);
    }

    /* ============================================================ *
     *  CURRENT PLAYING TRACKING                                    *
     * ============================================================ */

    function setCurrentPlaying(productId, trackIdx, isPlaying) {
        // Update mini-button highlight on miniature cards.
        if (currentPlayingProductId !== productId) {
            if (currentPlayingProductId !== null) {
                var oldBtns = document.querySelectorAll('.orp-card-play[data-orp-product="' + currentPlayingProductId + '"]');
                for (var i = 0; i < oldBtns.length; i++) oldBtns[i].classList.remove('orp-card-play--playing');
            }
            currentPlayingProductId = productId;
            if (productId !== null) {
                var newBtns = document.querySelectorAll('.orp-card-play[data-orp-product="' + productId + '"]');
                for (var j = 0; j < newBtns.length; j++) newBtns[j].classList.add('orp-card-play--playing');
            }
        }
        currentPlayingTrackIdx = (typeof trackIdx === 'number' ? trackIdx : -1);
        currentIsPlaying = !!isPlaying;
        syncIntegratedPlaylistIcons();
    }

    /**
     * Updates the play/pause icon visibility on every `.orp-track-play`
     * button in the integrated product playlist (rendered by
     * product-playlist.tpl). Only the row matching the currently
     * playing track shows the pause icon; all others show play.
     */
    function syncIntegratedPlaylistIcons() {
        try {
            var rows = document.querySelectorAll('.orp-product-playlist .orp-track-play');
            for (var i = 0; i < rows.length; i++) {
                var btn       = rows[i];
                var pid       = parseInt(btn.getAttribute('data-product-id'), 10);
                var idx       = parseInt(btn.getAttribute('data-track-index'), 10);
                var isThisOne = (currentIsPlaying
                                 && pid === currentPlayingProductId
                                 && idx === currentPlayingTrackIdx);
                var iconPlay  = btn.querySelector('.orp-track-play__icon--play');
                var iconPause = btn.querySelector('.orp-track-play__icon--pause');
                if (iconPlay)  iconPlay.style.display  = isThisOne ? 'none' : '';
                if (iconPause) iconPause.style.display = isThisOne ? '' : 'none';
                var row = btn.closest('.orp-product-playlist__track');
                if (row) {
                    if (isThisOne) row.classList.add('orp-product-playlist__track--playing');
                    else row.classList.remove('orp-product-playlist__track--playing');
                }
            }
        } catch (e) { dlog('syncIntegratedPlaylistIcons error', e); }
    }

    /* ============================================================ *
     *  RE-INJECTION ON DYNAMIC CONTENT (Swup nav, AS4 search, etc.)*
     * ============================================================ */

    function scheduleInject() {
        // Throttle: re-inject after 150ms (covers AS4 facet ajax,
        // Swup content:replace, infinite scroll, etc.)
        clearTimeout(scheduleInject._t);
        scheduleInject._t = setTimeout(function () {
            injectButtonsIntoCards(findProductCards());
        }, 150);
    }

    function bindReinjectionTriggers() {
        // Swup hooks (if Swup is on the page)
        if (window.swup && window.swup.hooks && typeof window.swup.hooks.on === 'function') {
            try { window.swup.hooks.on('content:replace', scheduleInject); }
            catch (e) {}
        }
        // PrestaShop core event for product list updates (faceted search, sort)
        if (window.prestashop && typeof window.prestashop.on === 'function') {
            try {
                window.prestashop.on('updateProductList',  scheduleInject);
                window.prestashop.on('updatedProductList', scheduleInject);
            } catch (e) {}
        }
        // AS4-specific event (jQuery custom event, if jQuery is around)
        if (window.jQuery) {
            try {
                window.jQuery(document).on('as4-After-Set-Results-Contents', scheduleInject);
            } catch (e) {}
        }
    }

    /* ============================================================ *
     *  INIT                                                        *
     * ============================================================ */

    function safeStep(label, fn) {
        try {
            var result = fn();
            recordStep(label, true, typeof result === 'string' ? result : '');
            return result;
        } catch (e) {
            recordStep(label, false, (e && e.message) || String(e));
            return null;
        }
    }

    function init() {
        recordStep('config-present', !!window.onlyrootsPlayerConfig,
            window.onlyrootsPlayerConfig ? 'CONFIG keys=' + Object.keys(CONFIG).join(',') : 'window.onlyrootsPlayerConfig missing');

        // Inject the iframe ourselves (no PS hook dependency).
        ensureIframeInjected();
        if (!iframeEl) {
            recordStep('iframe-ready', false, 'iframeEl null after ensureIframeInjected');
            showDebugOverlay(diagnosticSteps.filter(function (s) { return !s.ok; }));
            return;
        }

        safeStep('message-listener-bound', function () {
            window.addEventListener('message', onIframeMessage, false);
        });
        safeStep('ios-warmup-bound', function () { bindIOSWarmup(); });
        safeStep('integrated-playlist-delegate-bound', function () { bindIntegratedPlaylistDelegate(); });
        safeStep('reinjection-triggers-bound', function () { bindReinjectionTriggers(); });
        safeStep('initial-card-buttons-injected', function () {
            var cards = findProductCards();
            injectButtonsIntoCards(cards);
            return cards.length + ' card(s) scanned';
        });
        // Sync icons in case the integrated playlist is already on the
        // page at boot AND the iframe will restore state from
        // localStorage. The 'state' message handler will re-sync once
        // the iframe responds.
        safeStep('integrated-icons-synced', function () { syncIntegratedPlaylistIcons(); });

        var failed = diagnosticSteps.filter(function (s) { return !s.ok; });
        if (failed.length > 0) {
            showDebugOverlay(failed);
        } else {
            dlog('bridge initialised cleanly, frameUrl=', deduceFrameUrl(), 'apiUrl=', getApiUrl());
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
