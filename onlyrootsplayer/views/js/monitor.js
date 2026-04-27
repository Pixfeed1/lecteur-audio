/**
 * OnlyRoots Persistent Audio Player — diagnostic monitor
 *
 * Standalone JS file loaded BEFORE player.js when ORP_MONITOR_ENABLED=1.
 * Captures:
 *   - Global JS errors (window.onerror)
 *   - Unhandled promise rejections (window.unhandledrejection)
 *   - Swup lifecycle events: visit:start, content:replace, visit:end,
 *     visit:abort, fetch:error
 *   - DOM snapshot diffs before/after each content:replace
 *
 * Events are buffered and POSTed in batches to the monitor controller via
 * navigator.sendBeacon when available, else fetch. Server-side validation
 * + rate-limiting handle the rest.
 *
 * Privacy: URLs are reduced to path-only before logging. No query strings,
 * cookies, headers or form data are captured.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */
(function () {
    'use strict';

    if (typeof onlyrootsPlayerConfig === 'undefined') return;
    var CONFIG = onlyrootsPlayerConfig;
    if (!CONFIG.monitorEnabled || !CONFIG.monitorEndpoint) return;

    if (window.__orpMonitorLoaded) return; // re-exec guard
    window.__orpMonitorLoaded = true;

    var ENDPOINT       = CONFIG.monitorEndpoint;
    var BATCH_INTERVAL = 5000;  // flush every 5s
    var BATCH_MAX      = 20;    // or sooner if buffer fills
    var queue          = [];
    var lastSnapshot   = null;

    /* ============================================================ */
    /*  TRANSPORT                                                   */
    /* ============================================================ */

    function send(events) {
        if (!events.length) return;

        var payload = JSON.stringify({ events: events });

        // sendBeacon is fire-and-forget and survives page unload, perfect
        // for diagnostic data. Falls back to fetch when unavailable
        // (e.g. older Safari) or rejected (some Content-Type rules).
        try {
            if (navigator && typeof navigator.sendBeacon === 'function') {
                var blob = new Blob([payload], { type: 'application/json' });
                if (navigator.sendBeacon(ENDPOINT, blob)) return;
            }
        } catch (e) {}

        try {
            fetch(ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            });
        } catch (e) {}
    }

    function flush() {
        if (!queue.length) return;
        var batch = queue.splice(0, BATCH_MAX);
        send(batch);
    }

    function enqueue(type, data) {
        try {
            queue.push({
                type: type,
                data: data || {},
            });
            if (queue.length >= BATCH_MAX) {
                flush();
            }
        } catch (e) {}
    }

    setInterval(flush, BATCH_INTERVAL);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide',     flush);

    // Expose enqueue() to the rest of the module (notably player.js) so it
    // can surface preset failures and other player-internal anomalies.
    window.__orpMonitorEnqueue = enqueue;

    /* ============================================================ */
    /*  PRIVACY HELPERS                                             */
    /* ============================================================ */

    function pathOnly(url) {
        if (!url) return '';
        try {
            var u = new URL(url, window.location.origin);
            return (u.pathname || '/');
        } catch (e) {
            // Probably already a relative path.
            return String(url).split('?')[0];
        }
    }

    function shortStr(s, max) {
        s = String(s == null ? '' : s);
        max = max || 256;
        if (s.length > max) s = s.substring(0, max - 3) + '...';
        return s;
    }

    /* ============================================================ */
    /*  GLOBAL ERROR CAPTURE                                        */
    /* ============================================================ */

    window.addEventListener('error', function (ev) {
        try {
            enqueue('js:error', {
                message: shortStr(ev && ev.message, 400),
                filename: pathOnly(ev && ev.filename),
                lineno: ev && ev.lineno,
                colno: ev && ev.colno,
                page: pathOnly(window.location.href),
            });
        } catch (e) {}
    });

    window.addEventListener('unhandledrejection', function (ev) {
        try {
            var reason = ev && ev.reason;
            var msg    = '';
            if (reason instanceof Error) {
                msg = reason.message + (reason.stack ? ' | ' + reason.stack.split('\n')[0] : '');
            } else if (typeof reason === 'string') {
                msg = reason;
            } else {
                try { msg = JSON.stringify(reason); } catch (e) { msg = '<unserializable>'; }
            }
            enqueue('js:unhandled-rejection', {
                reason: shortStr(msg, 500),
                page: pathOnly(window.location.href),
            });
        } catch (e) {}
    });

    /* ============================================================ */
    /*  DOM SNAPSHOT + DIFF                                         */
    /* ============================================================ */

    /**
     * Captures the visible state of theme-critical landmarks. The diff
     * between two snapshots reveals what a Swup swap silently broke
     * (lost body class, header gone, sliders count dropped, etc.).
     */
    function takeSnapshot() {
        try {
            var bodyClasses = document.body
                ? Array.prototype.slice.call(document.body.classList).sort().join(' ')
                : '';
            var htmlClasses = document.documentElement
                ? Array.prototype.slice.call(document.documentElement.classList).sort().join(' ')
                : '';

            return {
                page: pathOnly(window.location.href),
                bodyClasses: bodyClasses,
                htmlClasses: htmlClasses,
                bodyDataset: serializeDataset(document.body),
                htmlDataset: serializeDataset(document.documentElement),
                hasHeader: !!document.querySelector('header, #header'),
                hasFooter: !!document.querySelector('footer, #footer'),
                stickyWrappers: document.querySelectorAll('.desktop-sticky-wrapper, .mobile-sticky-wrapper').length,
                amegamenuItems: document.querySelectorAll('#amegamenu .amenu-item').length,
                productMiniatures: document.querySelectorAll('.js-product-miniature, .product-miniature, article.product').length,
                sliders: document.querySelectorAll('.slick-slider, .swiper, .owl-carousel').length,
                imagesLoaded: countImagesLoaded(),
                inlineStyleTags: document.querySelectorAll('head style, body style').length,
            };
        } catch (e) {
            return { error: shortStr(e && e.message, 200) };
        }
    }

    function serializeDataset(el) {
        if (!el || !el.dataset) return '';
        var keys = Object.keys(el.dataset).sort();
        var parts = [];
        for (var i = 0; i < keys.length && i < 12; i++) {
            parts.push(keys[i] + '=' + shortStr(el.dataset[keys[i]], 40));
        }
        return parts.join(',');
    }

    function countImagesLoaded() {
        var imgs = document.images || [];
        var loaded = 0;
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].complete && imgs[i].naturalWidth > 0) loaded++;
        }
        return imgs.length ? (loaded + '/' + imgs.length) : '0/0';
    }

    function diff(a, b) {
        if (!a || !b) return null;
        var changes = [];
        var keys = ['bodyClasses', 'htmlClasses', 'bodyDataset', 'htmlDataset',
                    'hasHeader', 'hasFooter', 'stickyWrappers', 'amegamenuItems',
                    'productMiniatures', 'sliders', 'imagesLoaded', 'inlineStyleTags'];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (String(a[k]) !== String(b[k])) {
                changes.push(k + ': "' + shortStr(a[k], 80) + '" -> "' + shortStr(b[k], 80) + '"');
            }
        }
        return changes.length ? changes.join(' | ') : null;
    }

    /* ============================================================ */
    /*  SWUP HOOK BINDING (deferred until Swup is up)               */
    /* ============================================================ */

    /**
     * player.js creates the Swup instance asynchronously. We poll a few
     * times for it to appear, then bind our hooks. If Swup is disabled
     * (standalone mode) we still capture window-level errors — just no
     * Swup-specific events.
     */
    var bindAttempts = 0;
    var BIND_INTERVAL = 200;
    var BIND_MAX_ATTEMPTS = 50; // 10 s total

    function tryBindSwupHooks() {
        bindAttempts++;
        // The player exposes its Swup instance via window.__orpSwup once
        // initSwup() has run. If after BIND_MAX_ATTEMPTS the global is still
        // missing, Swup is disabled or never initialised — give up silently.
        if (window.__orpSwup) {
            bindHooks(window.__orpSwup);
            return;
        }
        if (bindAttempts < BIND_MAX_ATTEMPTS) {
            setTimeout(tryBindSwupHooks, BIND_INTERVAL);
        }
    }

    function bindHooks(swup) {
        try {
            swup.hooks.on('visit:start', function (visit) {
                lastSnapshot = takeSnapshot();
                enqueue('swup:visit:start', {
                    from: pathOnly(window.location.href),
                    to:   pathOnly(visit && visit.to && visit.to.url),
                });
            });
            swup.hooks.on('content:replace', function () {
                var after = takeSnapshot();
                enqueue('swup:content:replace', { page: after.page });
                var d = diff(lastSnapshot, after);
                if (d) {
                    enqueue('dom:diff', { changes: d });
                }
                lastSnapshot = after;
            });
            swup.hooks.on('visit:end', function () {
                enqueue('swup:visit:end', { page: pathOnly(window.location.href) });
            });
            swup.hooks.on('visit:abort', function () {
                enqueue('swup:visit:abort', { page: pathOnly(window.location.href) });
            });
            swup.hooks.on('fetch:error', function (visit) {
                enqueue('swup:fetch:error', {
                    to: pathOnly(visit && visit.to && visit.to.url),
                });
            });
        } catch (e) {
            enqueue('js:error', {
                message: 'monitor: bindHooks failed: ' + shortStr(e && e.message, 200),
            });
        }
    }

    // Initial snapshot + start polling for Swup.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            lastSnapshot = takeSnapshot();
            enqueue('orp:player:init', {
                page: lastSnapshot.page,
                miniatures: lastSnapshot.productMiniatures,
                sliders: lastSnapshot.sliders,
            });
            tryBindSwupHooks();
        });
    } else {
        lastSnapshot = takeSnapshot();
        enqueue('orp:player:init', {
            page: lastSnapshot.page,
            miniatures: lastSnapshot.productMiniatures,
            sliders: lastSnapshot.sliders,
        });
        tryBindSwupHooks();
    }
})();
