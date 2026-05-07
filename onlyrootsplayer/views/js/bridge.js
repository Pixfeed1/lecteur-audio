/**
 * OnlyRoots Persistent Audio Player — parent-side messenger
 *
 * Runs in the PARENT page (every front URL of the shop). The audio
 * engine itself lives inside the persistent iframe loaded via
 * frame-injector.tpl. This script's job:
 *
 *   1. Find product cards on listing pages and check which ones have
 *      audio (batched API call). Inject a small play button on each.
 *   2. On product card play click: fetch the full playlist for that
 *      product, then postMessage("load") to the iframe to start it.
 *   3. Listen to iframe messages and update parent UI state (which
 *      product is currently playing, "playing" highlight on cards).
 *   4. iOS user-gesture warm-up: on first user click anywhere in the
 *      parent, postMessage("warmup-audio") to the iframe so its
 *      AudioContext gets unlocked. Subsequent programmatic
 *      audio.play() calls will then succeed even though the gesture
 *      came from the parent frame.
 *
 * Visual integration: the iframe is positioned `fixed bottom: 0`
 * across the full width with a fixed height (~72px). It overlays the
 * page content like the v2.5.x player did, but is now in its own
 * document so it can never be touched by the theme or other modules.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @version   3.0.0
 */
(function () {
    'use strict';

    if (typeof onlyrootsPlayerConfig === 'undefined') return;
    var CONFIG = window.onlyrootsPlayerConfig;
    var DEBUG  = !!CONFIG.debug;

    function dlog() {
        if (!DEBUG || !window.console) return;
        try { window.console.log.apply(window.console, ['[ORP/bridge]'].concat([].slice.call(arguments))); } catch (e) {}
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
        if (findIframe()) return iframeEl;
        if (!CONFIG.frameUrl) {
            dlog('CONFIG.frameUrl missing, cannot inject iframe');
            return null;
        }
        try {
            iframeEl = document.createElement('iframe');
            iframeEl.id = 'orp-frame';
            iframeEl.src = CONFIG.frameUrl;
            iframeEl.title = 'Audio player';
            iframeEl.scrolling = 'no';
            iframeEl.setAttribute('allow', 'autoplay; encrypted-media');
            iframeEl.setAttribute('loading', 'eager');
            // data-swup-persist tells Swup (if present) to never touch
            // this element across swaps.
            iframeEl.setAttribute('data-swup-persist', 'orp-frame');
            // Don't let the iframe steal Tab focus by default.
            iframeEl.setAttribute('tabindex', '-1');
            document.body.appendChild(iframeEl);
            dlog('iframe injected', CONFIG.frameUrl);
        } catch (e) {
            dlog('iframe injection error', e);
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

    function getApiUrl() {
        // hookDisplayHeader exposes the playlist endpoint URL as
        // `apiUrl` on `onlyrootsPlayerConfig` (legacy v2.5.x name kept
        // for compat). bridge.js consumes it under the same key.
        return CONFIG.apiUrl || CONFIG.apiBase || '';
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

    function init() {
        // Inject the iframe ourselves (no PS hook dependency).
        ensureIframeInjected();
        if (!iframeEl) {
            dlog('iframe could not be created, abort');
            return;
        }

        window.addEventListener('message', onIframeMessage, false);
        bindIOSWarmup();
        bindIntegratedPlaylistDelegate();
        bindReinjectionTriggers();
        injectButtonsIntoCards(findProductCards());
        // Sync icons in case the integrated playlist is already on the
        // page at boot AND the iframe will restore state from
        // localStorage. The 'state' message handler will re-sync once
        // the iframe responds.
        syncIntegratedPlaylistIcons();

        // The iframe sends a 'ready' message via load event — until
        // then, postToIframe queues commands. We don't need to
        // explicitly request-state here because the iframe will send
        // its own 'state' (with restored data) right after 'ready'.

        dlog('bridge initialised, frameUrl=', CONFIG.frameUrl, 'apiUrl=', getApiUrl());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
