/**
 * OnlyRoots Persistent Audio Player — Swup initialization (v3.0)
 *
 * Bootstraps Swup as the SPA navigation layer. The iframe (orp-frame)
 * lives outside `#content-wrapper`, so Swup never touches it; the
 * audio context survives every Swup-handled navigation by construction.
 *
 * Compared to v2.5.18's player.js boot sequence, this is dramatically
 * simpler:
 *   - No theme presets (no zonetheme.js, no slider re-init, no
 *     mega-menu re-bind). Those lived in v2.5.18 because the player
 *     itself was integrated in the page DOM and competed with theme
 *     JS for ownership. Now the player is in an iframe — theme JS
 *     can do whatever it wants, the audio is unaffected.
 *   - No catastrophic-swap watchdog. The watchdog existed to detect
 *     swaps that wiped the DOM and trigger a full reload to recover.
 *     With the iframe, even the most catastrophic DOM wipe can't
 *     hurt the audio, so we don't need the safety net any more.
 *   - No popstate hijack. (The popstate killer for ZOneTheme is in
 *     bridge.js because it's a parent-side concern that can short-
 *     circuit Swup itself, before this file even runs.)
 *
 * The only Swup customisations here are the container set, the URL
 * exclusion list, and the plugin chain (head, body-class, scripts).
 *
 * @author PixFeed - Marc Gueffie
 */
(function () {
    'use strict';

    var CFG = window.onlyrootsPlayerConfig || {};

    // Don't init twice (defensive: if this script is loaded by both
    // the module and a theme override).
    if (window.swup) return;

    if (typeof window.Swup !== 'function') {
        // Swup library failed to load; fall back to standard nav.
        return;
    }

    /* ------------------------------------------------------------ *
     *  Plugin instances                                            *
     * ------------------------------------------------------------ */

    var plugins = [];

    if (typeof window.SwupHeadPlugin === 'function') {
        plugins.push(new window.SwupHeadPlugin({
            persistAssets: true,
            persistTags: 'meta'
        }));
    }
    if (typeof window.SwupBodyClassPlugin === 'function') {
        plugins.push(new window.SwupBodyClassPlugin());
    }
    if (typeof window.SwupScriptsPlugin === 'function') {
        plugins.push(new window.SwupScriptsPlugin({
            head: false,
            body: true,
            optin: false
        }));
    }
    if (CFG.swupPreload && typeof window.SwupPreloadPlugin === 'function') {
        plugins.push(new window.SwupPreloadPlugin({
            preloadVisibleLinks: { enabled: true, threshold: 0.5 },
            preloadHoveredLinks: true
        }));
    }

    /* ------------------------------------------------------------ *
     *  Containers                                                  *
     *                                                              *
     * Multiple containers are tried in order; Swup picks the first *
     * one that exists in both the current and the next page.       *
     * ------------------------------------------------------------ */

    var containers = (CFG.swupContainers || '#content-wrapper, #content, main, #main')
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

    /* ------------------------------------------------------------ *
     *  URL exclusions                                              *
     *                                                              *
     * Some PrestaShop pages need a full reload (form-heavy pages,  *
     * checkout flow, captcha-laden pages). We list them here.      *
     *                                                              *
     * The Contact page is excluded by default because it loads     *
     * reCAPTCHA and Brevo Chat in a way that doesn't survive Swup  *
     * swaps cleanly; this can be opted-in via the BO toggle below  *
     * if the operator has tuned those modules to be SPA-friendly.  *
     * ------------------------------------------------------------ */

    var excluded = [
        '/panier',
        '/commande',
        '/authentification',
        '/identite',
        '/historique-des-commandes',
        '/adresses',
        '/cart',
        '/order',
        '/login',
        '/register',
        '/identity',
        '/order-history',
        '/addresses'
    ];
    if (CFG.swupExcludeContact) {
        excluded.push('/contactez-nous', '/contact-us');
    }
    if (CFG.swupExtraExclusions) {
        var extra = String(CFG.swupExtraExclusions)
            .split(',')
            .map(function (s) { return s.trim(); })
            .filter(Boolean);
        excluded = excluded.concat(extra);
    }

    var excludeFunctions = excluded.map(function (path) {
        return 'a[href*="' + path + '"]';
    });

    /* ------------------------------------------------------------ *
     *  Boot                                                        *
     * ------------------------------------------------------------ */

    try {
        window.swup = new window.Swup({
            containers: containers,
            animationSelector: false,            // no fade — instant swap
            cache: true,
            linkSelector: 'a[href]:not([target]):not([download]):not([data-no-swup]):not(' + excludeFunctions.join('):not(') + ')',
            plugins: plugins,
            ignoreVisit: function (url) {
                if (!url) return false;
                for (var i = 0; i < excluded.length; i++) {
                    if (url.indexOf(excluded[i]) !== -1) return true;
                }
                return false;
            }
        });

        if (window.console && window.console.log) {
            console.log('[orp] Swup initialized (containers=' + containers.join(',') +
                        ', plugins=' + plugins.length + ')');
        }
    } catch (e) {
        if (window.console && window.console.error) {
            console.error('[orp] Swup init failed', e);
        }
    }
})();
