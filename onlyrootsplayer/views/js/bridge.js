/**
 * OnlyRoots Persistent Audio Player — bridge.js (parent-side, v3.0)
 *
 * The single piece of JS that runs on every PrestaShop page. Its job:
 *
 *   1. Discover product cards on the current page that have audio
 *      (via batch query to /module/onlyrootsplayer/playlist?action=batch).
 *   2. Inject inline play buttons into those cards.
 *   3. Forward play-button clicks to the iframe via postMessage.
 *   4. Receive state changes from the iframe and reflect them in the
 *      parent UI (active card highlight, iframe show/hide animation).
 *   5. Re-run discovery on Turbo navigation events (if Turbo enabled)
 *      or on standard page load if not.
 *
 * What this file does NOT do, on purpose:
 *   - It does NOT touch the audio element (that lives in the iframe).
 *   - It does NOT bind anything to the theme's own event chain
 *     (no popstate hijack, no megamenu reinit, no jQuery delegation
 *     on theme elements). The 47KB zonetheme.js of v2.5.18 is gone.
 *   - It does NOT patch third-party modules (pm_advancedsearch4, etc).
 *     The iframe is isolated, so when those modules re-render the DOM
 *     after AJAX, all we have to do is re-discover product cards.
 *
 * @author PixFeed - Marc Gueffie
 * @version 3.0.0
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------ *
     *  Config + state                                              *
     * ------------------------------------------------------------ */

    var CFG = window.onlyrootsPlayerConfig || {};
    var L10N = window.onlyrootsPlayerL10n || {};

    if (!CFG.available) {
        // The audio source module isn't installed/active. Stay silent.
        return;
    }

    var FRAME_ID       = 'orp-frame';
    var FRAME_VISIBLE  = 'orp-frame--visible';
    var BODY_HAS_PLAYER = 'orp-has-player';
    var INJECTED_FLAG  = 'data-orp-injected';
    // Keep the v2.5.18 class so the existing skin CSS in player.css
    // applies to the button without any rework.
    var PLAY_BUTTON_CLASS = 'orp-play-btn-inline';
    var PLAYING_CLASS  = 'orp-playing';
    var PARENT_ORIGIN  = window.location.origin;

    var iframeEl       = null;
    var iframeReady    = false;
    var pendingMessages = [];
    var audioUnlocked  = false;
    var debug          = !!CFG.debug;
    var monitorEndpoint = CFG.monitorEnabled ? CFG.monitorEndpoint : null;

    function log() {
        if (!debug) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[orp-bridge]');
        console.log.apply(console, args);
    }

    function monitor(event, data) {
        // Use the shared queue exposed by monitor.js (which also handles
        // batching, beacon transport, and rate limiting). Falls back to
        // direct POST if monitor.js wasn't loaded (legacy shape).
        try {
            if (typeof window.__orpMonitorEnqueue === 'function') {
                window.__orpMonitorEnqueue(event, data || {});
                return;
            }
            if (!monitorEndpoint) return;
            var payload = JSON.stringify({ events: [{ type: event, data: data || {} }] });
            if (navigator.sendBeacon) {
                navigator.sendBeacon(monitorEndpoint, payload);
            } else {
                fetch(monitorEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true,
                });
            }
        } catch (e) { /* swallow */ }
    }

    /* ------------------------------------------------------------ *
     *  Iframe handle + postMessage transport                       *
     * ------------------------------------------------------------ */

    function getIframe() {
        if (iframeEl && document.body.contains(iframeEl)) {
            return iframeEl;
        }
        iframeEl = document.getElementById(FRAME_ID);
        return iframeEl;
    }

    function send(action, payload) {
        var msg = { source: 'orp-bridge', action: action, payload: payload || {} };
        if (!iframeReady) {
            pendingMessages.push(msg);
            return;
        }
        var f = getIframe();
        if (!f || !f.contentWindow) {
            pendingMessages.push(msg);
            return;
        }
        try {
            f.contentWindow.postMessage(msg, PARENT_ORIGIN);
        } catch (e) {
            log('postMessage failed', e);
        }
    }

    function flushPending() {
        if (!iframeReady || !pendingMessages.length) return;
        var f = getIframe();
        if (!f || !f.contentWindow) return;
        var queue = pendingMessages.slice();
        pendingMessages.length = 0;
        for (var i = 0; i < queue.length; i++) {
            try {
                f.contentWindow.postMessage(queue[i], PARENT_ORIGIN);
            } catch (e) { /* swallow */ }
        }
    }

    function showFrame() {
        var f = getIframe();
        if (!f) return;
        f.classList.add(FRAME_VISIBLE);
        f.style.height = '80px';
        f.removeAttribute('aria-hidden');
        f.removeAttribute('tabindex');
        document.body.classList.add(BODY_HAS_PLAYER);
    }

    function hideFrame() {
        var f = getIframe();
        if (!f) return;
        f.classList.remove(FRAME_VISIBLE);
        f.style.height = '0px';
        f.setAttribute('aria-hidden', 'true');
        f.setAttribute('tabindex', '-1');
        document.body.classList.remove(BODY_HAS_PLAYER);
    }

    /* ------------------------------------------------------------ *
     *  Inbound message handler (from iframe)                       *
     * ------------------------------------------------------------ */

    window.addEventListener('message', function (e) {
        // Strict origin check — same-origin only
        if (e.origin !== PARENT_ORIGIN) return;
        var data = e.data;
        if (!data || data.source !== 'orp-frame') return;

        switch (data.action) {
            case 'ready':
                iframeReady = true;
                log('iframe ready');
                flushPending();
                // If iframe restored from localStorage, it may already
                // be in a "playing" state and asking us to show ourselves.
                if (data.payload && data.payload.visible) {
                    showFrame();
                }
                break;
            case 'show':
                showFrame();
                break;
            case 'hide':
                hideFrame();
                break;
            case 'state':
                // Mirror playing track in card UI (active highlight)
                updateActiveCard(data.payload);
                break;
            case 'navigate':
                // The iframe wants the parent to navigate (e.g. user
                // clicked the track title which links to the product page).
                if (data.payload && data.payload.url) {
                    window.location.href = data.payload.url;
                }
                break;
            default:
                break;
        }
    });

    /* ------------------------------------------------------------ *
     *  Audio unlock for iOS / Safari                                *
     *                                                              *
     * On mobile Safari and some Chrome variants, audio cannot start *
     * without a user gesture in the same JS realm as the <audio>.  *
     * Since our <audio> lives in the iframe, the FIRST user click  *
     * on the parent must be forwarded as an "unlock" event so the  *
     * iframe can prime its AudioContext / play a silent buffer.    *
     * ------------------------------------------------------------ */

    function unlockOnce() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        send('unlock', {});
        document.removeEventListener('click',     unlockOnce, true);
        document.removeEventListener('touchend',  unlockOnce, true);
        document.removeEventListener('keydown',   unlockOnce, true);
    }
    document.addEventListener('click',    unlockOnce, true);
    document.addEventListener('touchend', unlockOnce, true);
    document.addEventListener('keydown',  unlockOnce, true);

    /* ------------------------------------------------------------ *
     *  Click delegation for OUR play buttons (in product cards)    *
     *  AND for the integrated product-page playlist (.orp-track-play)
     *                                                              *
     * Debounced: a play-product / play-track command fired more    *
     * than once within 250ms is dropped. This protects against     *
     * stray double-events from event bubbling, accidental DOM-     *
     * delegated clicks during AJAX swaps, etc.                     *
     * ------------------------------------------------------------ */

    var lastPlayCommand = 0;
    var PLAY_DEBOUNCE_MS = 250;

    document.addEventListener('click', function (e) {
        // 1) Inline play button in product card (injected by us)
        var cardBtn = e.target.closest && e.target.closest('.' + PLAY_BUTTON_CLASS);
        if (cardBtn) {
            e.preventDefault();
            e.stopPropagation();
            var idProduct = parseInt(cardBtn.getAttribute('data-id-product'), 10);
            if (idProduct > 0) {
                var now = Date.now();
                if (now - lastPlayCommand < PLAY_DEBOUNCE_MS) {
                    log('play-product debounced (too fast after last play command)');
                    return;
                }
                lastPlayCommand = now;
                send('play-product', { idProduct: idProduct });
                showFrame(); // optimistic; iframe will confirm via 'show'
            }
            return;
        }

        // 2) Track row in product-page playlist
        var trackBtn = e.target.closest && e.target.closest('.orp-track-play');
        if (trackBtn) {
            e.preventDefault();
            e.stopPropagation();
            var trackUrl   = trackBtn.getAttribute('data-track-url') || '';
            var trackTitle = trackBtn.getAttribute('data-track-title') || '';
            var trackIndex = parseInt(trackBtn.getAttribute('data-track-index'), 10) || 0;
            var prodId     = parseInt(trackBtn.getAttribute('data-product-id'), 10) || 0;
            if (trackUrl) {
                var nowT = Date.now();
                if (nowT - lastPlayCommand < PLAY_DEBOUNCE_MS) {
                    log('play-track debounced (too fast after last play command)');
                    return;
                }
                lastPlayCommand = nowT;
                send('play-track', {
                    idProduct: prodId,
                    trackIndex: trackIndex,
                    trackUrl: trackUrl,
                    trackTitle: trackTitle
                });
                showFrame();
            }
            return;
        }
    }, false);

    /* ------------------------------------------------------------ *
     *  Hover preload (optional)                                    *
     * ------------------------------------------------------------ */

    if (CFG.hoverPreload) {
        var hoverTimeout = null;
        document.addEventListener('mouseover', function (e) {
            var btn = e.target.closest && e.target.closest('.' + PLAY_BUTTON_CLASS);
            if (!btn) return;
            var idProduct = parseInt(btn.getAttribute('data-id-product'), 10);
            if (idProduct <= 0) return;
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(function () {
                send('preload-product', { idProduct: idProduct });
            }, 200);
        }, false);
        document.addEventListener('mouseout', function () {
            clearTimeout(hoverTimeout);
        }, false);
    }

    /* ------------------------------------------------------------ *
     *  Discovery + button injection                                *
     *                                                              *
     * For every product card on the page, we batch-query the API  *
     * to find which products have audio, and inject a play button *
     * into those cards. Idempotent: re-running discovery on the   *
     * same DOM is safe.                                            *
     * ------------------------------------------------------------ */

    function $$(selector, root) {
        try {
            return Array.prototype.slice.call((root || document).querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    function findProductCards(root) {
        var selectors = (CFG.productSelectors || '').split(',').map(function (s) {
            return s.trim();
        }).filter(Boolean);
        var seen = new Set();
        var out = [];
        for (var i = 0; i < selectors.length; i++) {
            var matches = $$(selectors[i], root);
            for (var j = 0; j < matches.length; j++) {
                var el = matches[j];
                if (!seen.has(el)) {
                    seen.add(el);
                    out.push(el);
                }
            }
        }
        return out;
    }

    function findAnchor(card) {
        var selectors = (CFG.buttonAnchor || '').split(',').map(function (s) {
            return s.trim();
        }).filter(Boolean);
        for (var i = 0; i < selectors.length; i++) {
            var el = card.querySelector(selectors[i]);
            if (el) return el;
        }
        return card; // fallback: append to card root
    }

    function injectPlayButton(card, idProduct) {
        if (card.getAttribute(INJECTED_FLAG) === '1') return;
        card.setAttribute(INJECTED_FLAG, '1');

        var anchor = findAnchor(card);
        var btn = document.createElement('button');
        btn.type = 'button';
        // Use the v2.5.18 class so existing skin CSS applies untouched.
        // The icon is drawn by a CSS mask in player.css (.orp-play-btn-inline::before),
        // so we don't put any SVG inside the button itself.
        btn.className = PLAY_BUTTON_CLASS;
        btn.setAttribute('data-id-product', String(idProduct));
        btn.setAttribute('data-product-id', String(idProduct)); // legacy alias
        btn.setAttribute('data-no-swup', '');                   // tell Swup not to navigate
        btn.setAttribute('aria-label', L10N.listenSample || 'Listen sample');
        btn.title = L10N.listenSample || 'Listen sample';

        // Find the cart button and place ourselves BEFORE it so the
        // visual order is [play] [cart] (matches v2.5.18 layout).
        var cartBtn = null;
        try {
            cartBtn = anchor.querySelector('.add-to-cart, .ajax_add_to_cart_button, [data-button-action="add-to-cart"]');
        } catch (e) { /* no-op */ }

        if (cartBtn && cartBtn.parentNode === anchor) {
            anchor.insertBefore(btn, cartBtn);
        } else {
            anchor.appendChild(btn);
        }

        // Match the cart button's vertical metrics so we sit on the same
        // baseline (ZOneTheme applies margin-top to .add-to-cart in some
        // grid contexts).
        if (cartBtn) {
            try {
                var cartTopMargin = window.getComputedStyle(cartBtn).marginTop;
                if (cartTopMargin && cartTopMargin !== '0px') {
                    btn.style.marginTop = cartTopMargin;
                }
            } catch (e) { /* no-op */ }
        }
        card.classList.add('orp-has-audio');
    }

    function discover(root) {
        var cards = findProductCards(root || document);
        if (!cards.length) return;

        // Build a map of idProduct → card[] (multiple cards can share an id
        // e.g. featured-products + category listing on the same page)
        var byId = new Map();
        var ids = [];
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (card.getAttribute(INJECTED_FLAG) === '1') continue;
            var rawId = card.getAttribute('data-id-product');
            var id = parseInt(rawId, 10);
            if (!id || id <= 0) continue;
            if (!byId.has(id)) {
                byId.set(id, []);
                ids.push(id);
            }
            byId.get(id).push(card);
        }
        if (!ids.length) return;

        log('discover: querying audio for', ids.length, 'products');

        // Batch query to find which products have audio
        var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?')
                + 'action=batch&ids=' + ids.join(',');

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : { products: [] }; })
            .then(function (data) {
                var withAudio = (data && data.products) ? data.products : [];
                for (var k = 0; k < withAudio.length; k++) {
                    var pid = parseInt(withAudio[k], 10);
                    var matched = byId.get(pid);
                    if (!matched) continue;
                    for (var m = 0; m < matched.length; m++) {
                        injectPlayButton(matched[m], pid);
                    }
                }
                log('discover: injected', withAudio.length, 'buttons');
            })
            .catch(function (err) {
                log('discover: error', err);
            });
    }

    /* Active card highlight (when a product is playing) */
    function updateActiveCard(state) {
        // 1. Listing/category cards (`.orp-play-btn-inline`)
        var prevCards = document.querySelectorAll('.' + PLAY_BUTTON_CLASS + '.' + PLAYING_CLASS);
        for (var i = 0; i < prevCards.length; i++) {
            prevCards[i].classList.remove(PLAYING_CLASS);
        }

        // 2. Product-page playlist tracks (`.orp-track-play` button +
        // `.orp-product-playlist__track` parent <li>) — these live in
        // views/templates/hook/product-playlist.tpl and are rendered
        // server-side. The skin CSS targets `.is-playing` on the parent
        // <li>, so we add the class to BOTH the button (for symmetry
        // with listing buttons) and the parent <li> (for the skin).
        var prevTracks = document.querySelectorAll('.orp-track-play.' + PLAYING_CLASS);
        for (var t = 0; t < prevTracks.length; t++) {
            prevTracks[t].classList.remove(PLAYING_CLASS);
            var prevLi = prevTracks[t].closest('.orp-product-playlist__track');
            if (prevLi) prevLi.classList.remove('is-playing');
        }
        // Defensive: also clear any orphan is-playing on track <li>s
        var orphanLis = document.querySelectorAll('.orp-product-playlist__track.is-playing');
        for (var ol = 0; ol < orphanLis.length; ol++) {
            orphanLis[ol].classList.remove('is-playing');
        }

        if (!state || !state.idProduct || !state.playing) return;

        // Highlight matching listing card buttons (any track of the product
        // counts — we don't have track-index granularity on listing cards).
        var pid = parseInt(state.idProduct, 10);
        var btns = document.querySelectorAll('.' + PLAY_BUTTON_CLASS + '[data-id-product="' + pid + '"]');
        for (var j = 0; j < btns.length; j++) {
            btns[j].classList.add(PLAYING_CLASS);
        }

        // Highlight the matching product-page track button. If we have a
        // trackIndex in state, target only that one; otherwise highlight
        // all tracks of that product (degraded mode).
        var trackSel = '.orp-track-play[data-product-id="' + pid + '"]';
        if (typeof state.trackIndex !== 'undefined' && state.trackIndex !== null) {
            trackSel += '[data-track-index="' + parseInt(state.trackIndex, 10) + '"]';
        }
        var trackBtns = document.querySelectorAll(trackSel);
        for (var k = 0; k < trackBtns.length; k++) {
            trackBtns[k].classList.add(PLAYING_CLASS);
            var li = trackBtns[k].closest('.orp-product-playlist__track');
            if (li) li.classList.add('is-playing');
        }
    }

    /* ------------------------------------------------------------ *
     *  Defensive guards                                            *
     *                                                              *
     * One known nasty in production: ZOneTheme listens for popstate*
     * and does `window.location.href = e.state.current_url` which  *
     * triggers a full reload — killing audio. We catch in capture  *
     * phase and stop propagation IF the event carries a string     *
     * `current_url` (the ZOneTheme-specific signature).            *
     * ------------------------------------------------------------ */

    window.addEventListener('popstate', function (e) {
        if (e && e.state && typeof e.state.current_url === 'string') {
            e.stopImmediatePropagation();
            log('zonetheme popstate killer: stopped');
            monitor('zonetheme_popstate_killed', {});
        }
    }, true); // capture phase: runs BEFORE bubbling listeners

    /* ------------------------------------------------------------ *
     *  Re-discovery triggers                                       *
     *                                                              *
     * The iframe lives at the very bottom of <body>, OUTSIDE the   *
     * `#content-wrapper` that Swup swaps. So the iframe (and its   *
     * audio context) survives every internal navigation by         *
     * construction — no Turbo, no permanent-element trick needed.  *
     *                                                              *
     * What we DO need to re-run on every navigation: bridge.js     *
     * discovery — find new product cards and inject the play       *
     * button. We hook every reasonable event source:               *
     *                                                              *
     *   - Swup `content:replace`       : the SPA swap finished     *
     *   - Swup `visit:end`             : fallback if content:replace*
     *                                    didn't fire               *
     *   - DOMContentLoaded             : initial page load          *
     *   - prestashop `updateProductList`: faceted-search / pagination *
     *   - MutationObserver             : safety net for AJAX       *
     *                                    inserts not covered above *
     * ------------------------------------------------------------ */

    /* ------------------------------------------------------------ *
     *  Iframe persistence across Swup navigations                  *
     *                                                              *
     * The iframe lives at the very bottom of <body> (injected via  *
     * displayBeforeBodyClosingTag), OUTSIDE the #content-wrapper   *
     * Swup container. In theory Swup should ignore it.             *
     *                                                              *
     * In practice however, the SERVER-rendered HTML of every page  *
     * also contains a fresh `<iframe id="orp-frame">` (because     *
     * displayBeforeBodyClosingTag fires on every render). When     *
     * swup-head-plugin runs, or when swup-scripts-plugin re-       *
     * evaluates body scripts, the new iframe element ends up       *
     * present in the DOM alongside (or replacing) ours. Either way *
     * the audio context dies.                                      *
     *                                                              *
     * Strategy: hook visit:start (BEFORE the swap) to grab a       *
     * reference to OUR iframe, and visit:end / content:replace     *
     * (AFTER the swap) to:                                         *
     *   - remove any duplicate orp-frame the server injected;      *
     *   - if our iframe was somehow removed, reinsert it (audio    *
     *     will cut, but at least the player stays).                *
     *                                                              *
     * The reference is held in JS memory, NEVER detached from the  *
     * DOM, because detaching an iframe unloads its document and    *
     * stops audio with no way to recover.                          *
     * ------------------------------------------------------------ */

    var preservedIframe = null;

    function preserveIframe() {
        var f = document.getElementById('orp-frame');
        if (f) {
            preservedIframe = f;
            log('iframe preserved before swap');
            monitor('orp:iframe:check', {
                phase: 'preserve',
                exists: true,
                parent: f.parentElement ? f.parentElement.tagName + (f.parentElement.id ? '#' + f.parentElement.id : '') : 'none',
                page: window.location.pathname,
            });
        } else {
            monitor('orp:iframe:lost', {
                phase: 'preserve',
                page: window.location.pathname,
            });
        }
    }

    function reconcileIframe() {
        var allFrames = document.querySelectorAll('iframe#orp-frame');

        monitor('orp:iframe:check', {
            phase: 'reconcile',
            count: allFrames.length,
            preservedAlive: !!(preservedIframe && preservedIframe.contentWindow && preservedIframe.contentWindow.document),
            preservedInDom: !!(preservedIframe && document.body.contains(preservedIframe)),
            page: window.location.pathname,
        });

        if (allFrames.length === 0) {
            // Scenario 4
            if (preservedIframe) {
                document.body.appendChild(preservedIframe);
                log('iframe reattached (scenario 4 — none present)');
                monitor('orp:iframe:reattach', {
                    scenario: 4,
                    page: window.location.pathname,
                });
            }
            return;
        }

        if (allFrames.length === 1) {
            var only = allFrames[0];
            if (preservedIframe && only === preservedIframe) {
                // Scenario 1 — nothing to do
                monitor('orp:iframe:check', { scenario: 1, page: window.location.pathname });
                return;
            }
            if (preservedIframe && preservedIframe.contentWindow &&
                preservedIframe.contentWindow.document) {
                only.parentNode.removeChild(only);
                document.body.appendChild(preservedIframe);
                log('iframe restored from server-injected duplicate (scenario 3a)');
                monitor('orp:iframe:reattach', {
                    scenario: '3a',
                    page: window.location.pathname,
                });
                return;
            }
            preservedIframe = only;
            log('iframe replaced by fresh server-injected one (scenario 3b — audio lost)');
            monitor('orp:iframe:lost', {
                scenario: '3b',
                page: window.location.pathname,
            });
            return;
        }

        // Scenario 2 — multiple
        var removed = 0;
        for (var i = 0; i < allFrames.length; i++) {
            if (allFrames[i] !== preservedIframe) {
                allFrames[i].parentNode.removeChild(allFrames[i]);
                removed++;
                log('removed duplicate orp-frame (scenario 2)');
            }
        }
        monitor('orp:iframe:duplicate', {
            scenario: 2,
            removed: removed,
            page: window.location.pathname,
        });
    }

    function hookSwup() {
        if (!window.swup) {
            monitor('orp:swup:api-detected', { found: false, reason: 'window.swup undefined' });
            return false;
        }
        // Swup v3 (modern API): swup.hooks.on(name, handler)
        if (window.swup.hooks && typeof window.swup.hooks.on === 'function') {
            monitor('orp:swup:api-detected', {
                version: 'v3',
                hasBefore: typeof window.swup.hooks.before === 'function',
                hooks: window.swup.hooks ? Object.keys(window.swup.hooks).slice(0, 10) : [],
            });

            if (typeof window.swup.hooks.before === 'function') {
                window.swup.hooks.before('content:replace', function (visit) {
                    try {
                        if (!visit || !visit.to || !visit.to.document) {
                            monitor('orp:bridge:hook-fired', {
                                hook: 'before:content:replace',
                                hasVisit: !!visit,
                                hasVisitTo: !!(visit && visit.to),
                                hasDocument: !!(visit && visit.to && visit.to.document),
                            });
                            return;
                        }
                        var newFrames = visit.to.document.querySelectorAll('#orp-frame');
                        for (var i = 0; i < newFrames.length; i++) {
                            newFrames[i].parentNode && newFrames[i].parentNode.removeChild(newFrames[i]);
                        }
                        if (newFrames.length) {
                            log('stripped ' + newFrames.length + ' duplicate orp-frame(s) from incoming HTML');
                            monitor('orp:iframe:strip', {
                                count: newFrames.length,
                                page: window.location.pathname,
                            });
                        } else {
                            monitor('orp:bridge:hook-fired', {
                                hook: 'before:content:replace',
                                stripped: 0,
                            });
                        }
                    } catch (e) {
                        log('before content:replace handler error', e);
                        monitor('js:error', {
                            message: 'before content:replace: ' + (e && e.message),
                            page: window.location.pathname,
                        });
                    }
                });
                monitor('orp:bridge:hook-installed', { hook: 'before:content:replace' });
            }

            window.swup.hooks.on('visit:start', function (visit) {
                log('swup:visit:start');
                monitor('orp:bridge:hook-fired', {
                    hook: 'visit:start',
                    fromUrl: window.location.pathname,
                    toUrl: visit && visit.to ? (visit.to.url || '?') : '?',
                });
                preserveIframe();
            });
            monitor('orp:bridge:hook-installed', { hook: 'visit:start' });

            window.swup.hooks.on('content:replace', function () {
                log('swup:content:replace');
                monitor('orp:bridge:hook-fired', {
                    hook: 'content:replace',
                    page: window.location.pathname,
                });
                reconcileIframe();
                setTimeout(function () {
                    discover();
                    rebindAdvancedSearch4();
                }, 16);
            });
            monitor('orp:bridge:hook-installed', { hook: 'content:replace' });

            window.swup.hooks.on('visit:end', function () {
                log('swup:visit:end');
                monitor('orp:bridge:hook-fired', {
                    hook: 'visit:end',
                    page: window.location.pathname,
                });
                reconcileIframe();
                setTimeout(function () {
                    discover();
                    rebindAdvancedSearch4();
                }, 16);
            });
            monitor('orp:bridge:hook-installed', { hook: 'visit:end' });
            return true;
        }
        // Swup v2 fallback (older API)
        if (typeof window.swup.on === 'function') {
            monitor('orp:swup:api-detected', { version: 'v2' });
            window.swup.on('willReplaceContent', function () {
                log('swup:willReplaceContent (v2)');
                monitor('orp:bridge:hook-fired', { hook: 'willReplaceContent (v2)' });
                preserveIframe();
            });
            window.swup.on('contentReplaced', function () {
                log('swup:contentReplaced (v2)');
                monitor('orp:bridge:hook-fired', { hook: 'contentReplaced (v2)' });
                reconcileIframe();
                setTimeout(function () {
                    discover();
                    rebindAdvancedSearch4();
                }, 16);
            });
            return true;
        }
        monitor('orp:swup:api-detected', {
            found: false,
            hasHooks: !!window.swup.hooks,
            hasOn: typeof window.swup.on,
            keys: Object.keys(window.swup).slice(0, 15),
        });
        return false;
    }

    // Swup may load slightly after bridge.js — try now and retry once
    // if not yet available.
    if (!hookSwup()) {
        var swupRetries = 0;
        var swupRetryTimer = setInterval(function () {
            if (hookSwup() || ++swupRetries > 20) {
                clearInterval(swupRetryTimer);
                if (swupRetries > 20) log('swup not detected, falling back to MutationObserver only');
            }
        }, 250);
    }

    document.addEventListener('DOMContentLoaded', function () {
        discover();
        // Initial iframe state check
        var f0 = document.getElementById('orp-frame');
        monitor('orp:iframe:check', {
            phase: 'boot',
            exists: !!f0,
            page: window.location.pathname,
            readyState: document.readyState,
            swupAvailable: !!window.swup,
            swupKeys: window.swup ? Object.keys(window.swup).slice(0, 10) : [],
        });
    });
    if (document.readyState !== 'loading') {
        // We loaded after DOMContentLoaded — discover immediately
        setTimeout(discover, 0);
    }

    // Watchdog: check iframe state every 2 seconds and report any change.
    // This catches situations where iframe disappears OR a new one appears
    // even when our Swup hooks didn't fire (e.g. hooks not bound, full
    // reload, or iframe killed by another script).
    var lastIframeId = null;
    var lastIframeCount = -1;
    setInterval(function () {
        var frames = document.querySelectorAll('iframe#orp-frame');
        var curId = (frames.length === 1 && frames[0]) ? (frames[0].dataset.orpWatchdogId || '') : '';
        if (curId === '' && frames.length === 1) {
            // Tag the iframe so we can detect replacement
            frames[0].dataset.orpWatchdogId = 'wd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            curId = frames[0].dataset.orpWatchdogId;
        }
        if (frames.length !== lastIframeCount || curId !== lastIframeId) {
            monitor('orp:iframe:check', {
                phase: 'watchdog',
                count: frames.length,
                id: curId,
                wasCount: lastIframeCount,
                wasId: lastIframeId,
                page: window.location.pathname,
            });
            lastIframeCount = frames.length;
            lastIframeId = curId;
        }
    }, 2000);

    /* ------------------------------------------------------------ *
     *  pm_advancedsearch4 (faceted search) compatibility           *
     *                                                              *
     * The third-party module pm_advancedsearch4 fully replaces the *
     * native ps_facetedsearch with its own engine. Three issues    *
     * arise on PrestaShop 8 + Swup:                                *
     *                                                              *
     *   A. The inline <script>as4Plugin.params[N] = {...}</script> *
     *      lives in document <head>; swup-head-plugin doesn't      *
     *      re-execute it after a swap, so as4Plugin.params is      *
     *      empty for the new page (initSearchBlock would throw).   *
     *                                                              *
     *   B. Click handlers on facet checkboxes are direct, not      *
     *      delegated. After a swap they're gone — facet clicks do  *
     *      nothing.                                                *
     *                                                              *
     *   C. The native `updateProductList` listener does            *
     *      `$('#js-product-list').html(data.rendered_products)`.   *
     *      But `data.rendered_products` from the server INCLUDES   *
     *      the `<div id="js-product-list">` wrapper itself. The    *
     *      `.html()` produces nested duplicate IDs and a broken    *
     *      DOM that browsers render as the OLD content (or, more   *
     *      visibly: the left column disappears).                   *
     *                                                              *
     * Fix bundles three operations:                                *
     *   1. installAs4UpdateProductListHandler() — replace native   *
     *      listener with a `.replaceWith()`-based one that handles *
     *      wrapper-included responses correctly.                   *
     *   2. rehydrateAs4Params() — refetch the current URL, extract *
     *      the inline params script, eval it.                      *
     *   3. reinitAs4SearchBlocks() — call as4Plugin.initSearchBlock*
     *      for each .PM_ASBlockOutput[data-id-search] in the DOM.  *
     * ------------------------------------------------------------ */

    var __orpAs4ListenerInstalled = false;

    function installAs4UpdateProductListHandler() {
        if (__orpAs4ListenerInstalled) return false;
        if (typeof window.prestashop !== 'object' || typeof window.prestashop.on !== 'function') return false;

        try {
            // Drop any existing listeners — the native pm_advancedsearch4
            // one uses .html() which corrupts the DOM. Replace with our own.
            if (typeof window.prestashop.removeAllListeners === 'function') {
                window.prestashop.removeAllListeners('updateProductList');
            }

            window.prestashop.on('updateProductList', function (data) {
                try {
                    if (!data) return;

                    // Guard 1 — URL relevance check. If the AS4 response
                    // arrived after the user navigated away, drop it.
                    if (data.current_url && typeof data.current_url === 'string') {
                        var dataPath = data.current_url.split('?')[0].split('#')[0];
                        var livePath = window.location.href.split('?')[0].split('#')[0];
                        var normalize = function (u) { return u.replace(/\/+$/, ''); };
                        if (normalize(dataPath) !== normalize(livePath)) {
                            return; // stale event, drop silently
                        }
                    }

                    // Guard 2 — DOM structure check. Don't touch if the
                    // live DOM has no #js-product-list (we may have landed
                    // on a non-listing page after a swap that races with
                    // this event).
                    var $jq = window.jQuery;
                    if (!$jq) return; // jQuery is required for replaceWith

                    var $live = $jq('#js-product-list');
                    if (!$live.length) return;

                    if (data.rendered_products) {
                        $live.replaceWith(data.rendered_products);
                    }
                    if (data.rendered_products_top) {
                        var $top = $jq('#js-product-list-top');
                        if ($top.length) $top.replaceWith(data.rendered_products_top);
                    }
                    if (data.rendered_products_bottom) {
                        var $bot = $jq('#js-product-list-bottom');
                        if ($bot.length) $bot.replaceWith(data.rendered_products_bottom);
                    }
                    if (data.rendered_active_filters) {
                        var $filters = $jq('.PM_ASSelections, .active_filters, .js-active-filters').first();
                        if ($filters.length) $filters.html(data.rendered_active_filters);
                    }
                    if (data.rendered_facets) {
                        var $facets = $jq('#search_filters_wrapper, .js-search-filters-wrapper, #search_filters').first();
                        if ($facets.length) $facets.replaceWith(data.rendered_facets);
                    }

                    // Re-discover audio buttons in the new product list
                    setTimeout(discover, 16);
                } catch (e) {
                    log('updateProductList handler error', e);
                }
            });

            __orpAs4ListenerInstalled = true;
            log('as4 updateProductList handler installed');
            return true;
        } catch (e) {
            log('failed to install as4 listener', e);
            return false;
        }
    }

    function rehydrateAs4Params() {
        if (typeof window.as4Plugin !== 'object' || !window.as4Plugin) {
            return Promise.resolve(0);
        }
        var blocks = document.querySelectorAll('.PM_ASBlockOutput[data-id-search]');
        if (!blocks.length) return Promise.resolve(0);

        // Skip refetch if all blocks already have their params populated.
        var allKnown = true;
        for (var i = 0; i < blocks.length; i++) {
            var idSearch = blocks[i].getAttribute('data-id-search');
            if (!idSearch || !window.as4Plugin.params || !window.as4Plugin.params[idSearch]) {
                allKnown = false;
                break;
            }
        }
        if (allKnown) return Promise.resolve(0);

        return fetch(window.location.href, { credentials: 'same-origin' }).then(function (r) {
            return r.text();
        }).then(function (html) {
            var regex = /<script[^>]*>(?:(?!<\/script>)[\s\S])*?as4Plugin\.params\[\d+\][\s\S]*?<\/script>/g;
            var matches = html.match(regex);
            if (!matches) return 0;
            var count = 0;
            matches.forEach(function (s) {
                var code = s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
                try {
                    new Function(code)();
                    count++;
                } catch (e) {
                    log('as4 params eval failed', e);
                }
            });
            return count;
        }).catch(function (e) {
            log('as4 params fetch failed', e);
            return 0;
        });
    }

    function reinitAs4SearchBlocks() {
        if (typeof window.as4Plugin !== 'object' || !window.as4Plugin) return 0;
        if (typeof window.as4Plugin.initSearchBlock !== 'function') return 0;
        var blocks = document.querySelectorAll('.PM_ASBlockOutput[data-id-search]');
        var count = 0;
        for (var i = 0; i < blocks.length; i++) {
            var idSearch = blocks[i].getAttribute('data-id-search');
            if (!idSearch) continue;
            if (!window.as4Plugin.params || !window.as4Plugin.params[idSearch]) continue;
            try {
                window.as4Plugin.initSearchBlock(idSearch, 'search', 'init');
                count++;
            } catch (e) {
                log('as4 initSearchBlock failed for id_search=' + idSearch, e);
            }
        }
        return count;
    }

    function rebindAdvancedSearch4() {
        installAs4UpdateProductListHandler();
        return rehydrateAs4Params().then(function () {
            return reinitAs4SearchBlocks();
        });
    }

    // Run once at boot
    rebindAdvancedSearch4();

    // PrestaShop standard event for faceted-search / pagination updates.
    // Our installed handler above already takes care of the DOM swap and
    // re-discover; we keep this listener for non-AS4 modules (native
    // ps_facetedsearch, custom hooks) that emit the same event but rely
    // on the previous handler's discover() trigger.
    if (window.prestashop && typeof window.prestashop.on === 'function') {
        // We intentionally don't attach another handler here — our
        // installAs4UpdateProductListHandler() already covers the case
        // and re-running discover() here would race with the swap.
    }

    // MutationObserver safety net — only runs discover when product cards
    // are added to the DOM. Throttled to avoid hammering on every insert.
    var moTimer = null;
    var mo = new MutationObserver(function (mutations) {
        var shouldRun = false;
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var n = added[j];
                if (n.nodeType !== 1) continue;
                if (n.matches && (n.matches('[data-id-product]') ||
                                  n.querySelector && n.querySelector('[data-id-product]'))) {
                    shouldRun = true;
                    break;
                }
            }
            if (shouldRun) break;
        }
        if (shouldRun) {
            clearTimeout(moTimer);
            moTimer = setTimeout(discover, 100);
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    /* ------------------------------------------------------------ *
     *  Public API on window for debugging                          *
     * ------------------------------------------------------------ */

    window.OnlyRootsBridge = {
        version: '3.0.0',
        send: send,
        discover: discover,
        showFrame: showFrame,
        hideFrame: hideFrame,
        isReady: function () { return iframeReady; },
        isAudioUnlocked: function () { return audioUnlocked; }
    };

    log('bridge.js initialized', { version: '3.0.1' });

})();
