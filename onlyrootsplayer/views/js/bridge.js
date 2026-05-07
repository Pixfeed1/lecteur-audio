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
    var audioProductIds = new Set();    // products that have audio (cached)

    /* ============================================================ *
     *  IFRAME DISCOVERY                                            *
     * ============================================================ */

    function findIframe() {
        if (iframeEl && document.body.contains(iframeEl)) return iframeEl;
        iframeEl = document.getElementById('orp-frame');
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
                break;
            case 'track-changed':
                if (msg.productId) {
                    setCurrentPlayingProduct(msg.productId);
                }
                break;
            case 'playing-state':
                if (msg.isPlaying === false) {
                    setCurrentPlayingProduct(null);
                }
                break;
            case 'closed':
                setCurrentPlayingProduct(null);
                break;
            // 'state', 'visibility', 'play-rejected', 'ended', 'error' —
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
        var url = CONFIG.apiBase + '?action=batch&ids=' + encodeURIComponent(ids.join(','));
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && Array.isArray(data.audio_ids)) return data.audio_ids;
                return [];
            })
            .catch(function (e) { dlog('fetchAudioProductIds error', e); return []; });
    }

    function fetchPlaylist(productId) {
        var url = CONFIG.apiBase + '?id_product=' + encodeURIComponent(productId);
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
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
                autoplay:    true,
            });
        });
    }

    /* ============================================================ *
     *  CURRENT PLAYING TRACKING                                    *
     * ============================================================ */

    function setCurrentPlayingProduct(productId) {
        if (currentPlayingProductId === productId) return;
        // Remove old highlight
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
        findIframe();
        if (!iframeEl) {
            dlog('iframe not found in DOM, abort');
            return;
        }

        window.addEventListener('message', onIframeMessage, false);
        bindIOSWarmup();
        bindReinjectionTriggers();
        injectButtonsIntoCards(findProductCards());

        // Ask iframe for current state (if it survived a parent reload).
        postToIframe('request-state', {});

        dlog('bridge initialised');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
