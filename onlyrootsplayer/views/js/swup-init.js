/**
 * OnlyRoots Persistent Audio Player — Swup initialization (v3.0.11)
 *
 * Bootstraps Swup as the SPA navigation layer for the parent page.
 * The audio player itself lives in a same-origin iframe (`#orp-frame`)
 * which sits OUTSIDE the Swup container chain, so audio survives
 * every Swup-handled navigation by construction.
 *
 * What this file does NOT need any more (vs v2.5.x):
 *   - Catastrophic-swap watchdog: the iframe makes audio resilient
 *     even to total DOM wipes; the watchdog's only job was to bail
 *     out of broken swaps to save the audio. Not needed now.
 *   - Theme presets (zonetheme.js, slider re-init, megamenu rebuild,
 *     sticky header dance): the iframe doesn't depend on theme JS,
 *     so the theme can do whatever it wants on each swap. Sliders /
 *     megamenu may visually glitch on theme-side, but the audio is
 *     unaffected.
 *
 * What this file DOES still need (this was missing in v3.0.10 and is
 * the reason the operator still sees dropdown / language / theme bugs
 * after switching to v3 — back-ported from v2.5.10–v2.5.15):
 *   - IGNORE_SCRIPT_PATTERNS to mark inline scripts that bind
 *     listeners on document/window/element; ScriptsPlugin would
 *     otherwise re-execute them on every swap and stack listeners
 *     to infinity, producing the "dropdown opens then closes" /
 *     "click counted twice" / "menu unresponsive after 3 navs"
 *     symptoms.
 *   - tagLanguageLinks() to flag every `[data-iso-code]` and
 *     `[href*="id_lang="]` link with `data-no-swup` so Swup's
 *     linkSelector excludes them and the language switch falls
 *     through to a normal full-reload navigation.
 *   - linkSelector that excludes `[data-iso-code]` natively as a
 *     belt-and-braces complement to the tag pass.
 *   - ignoreVisit detection of `id_lang=` query strings: PrestaShop's
 *     `url entity='language'` helper produces those URLs when
 *     friendly URLs are off, and the path-prefix language heuristic
 *     can't catch them.
 *   - mergePrestashopData(): the live `window.prestashop` object is
 *     a live event emitter; without this, ScriptsPlugin re-running
 *     `var prestashop = {...}` would clobber it, taking out every
 *     module that has `prestashop.on(...)` listeners attached.
 *   - reinitBootstrapDropdowns + click delegate (back-ported from
 *     v2.5.13): ZOneTheme's Bootstrap is webpack-scoped and
 *     `window.bootstrap` is undefined; we drive the dropdown
 *     open/close state ourselves by toggling the `.show` classes
 *     Bootstrap would set, with a single `document` click delegate
 *     that survives every swap.
 *
 * @author PixFeed - Marc Gueffie
 * @version 3.0.11
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

    /* ============================================================ *
     *  LISTENER-STACKING IGNORE (back-ported from v2.5.11)         *
     *                                                              *
     * SwupScriptsPlugin re-runs every inline <script> after each   *
     * swap. Any script that binds a listener via $(...).on(...),   *
     * addEventListener(), or prestashop.on() would stack a new     *
     * listener every nav. Mark them with data-swup-ignore-script.  *
     * ============================================================ */

    var IGNORE_SCRIPT_PATTERNS = /var\s+prestashop\s*=|prestashop\.(on|emit)\(|\$\(\s*[^)]+\s*\)\.on\(|addEventListener\(/;

    /* ============================================================ *
     *  PRESTASHOP DATA MERGE (back-ported from v2.5.x player.js)   *
     *                                                              *
     * Live `window.prestashop` is an EventEmitter. Re-running the  *
     * `var prestashop = {...}` block from a swapped HTML would     *
     * destroy the emitter and every listener attached to it.       *
     * Instead, parse the new HTML's data block and merge only      *
     * the pure-data keys.                                          *
     * ============================================================ */

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
                    var mergeKeys = [
                        'cart', 'customer', 'page', 'urls', 'breadcrumb',
                        'language', 'currency', 'country', 'shop',
                        'field_required', 'static_token', 'token', 'time'
                    ];
                    mergeKeys.forEach(function (k) {
                        if (typeof newData[k] !== 'undefined') {
                            window.prestashop[k] = newData[k];
                        }
                    });
                } catch (parseErr) {}
                break;
            }
        } catch (e) {}
    }

    /* ============================================================ *
     *  LANGUAGE-LINK TAGGING (back-ported from v2.5.7)             *
     *                                                              *
     * Flag every detectable language-switch link with              *
     * data-no-swup so Swup's linkSelector excludes it. Browser     *
     * follows the href naturally → full reload → language change   *
     * actually happens.                                            *
     * ============================================================ */

    function tagLanguageLinks(root) {
        try {
            var scope = root || document;
            var anchors = scope.querySelectorAll('a[data-iso-code],a[href*="id_lang="]');
            for (var i = 0; i < anchors.length; i++) {
                anchors[i].setAttribute('data-no-swup', 'true');
            }
        } catch (e) {}
    }

    /* ============================================================ *
     *  BOOTSTRAP DROPDOWN MANUAL DELEGATE (back-ported from 2.5.13)*
     *                                                              *
     * ZOneTheme bundles Bootstrap inside webpack; window.bootstrap *
     * is undefined. We drive open/close ourselves by toggling the  *
     * .show classes Bootstrap would set, via a single document     *
     * click delegate that survives every Swup swap.                *
     * ============================================================ */

    function closeAllDropdowns() {
        try {
            var openMenus = document.querySelectorAll('.dropdown-menu.show');
            for (var i = 0; i < openMenus.length; i++) openMenus[i].classList.remove('show');
            var openContainers = document.querySelectorAll('.dropdown.show, .dropup.show, .dropend.show, .dropstart.show');
            for (var j = 0; j < openContainers.length; j++) openContainers[j].classList.remove('show');
            var expandedToggles = document.querySelectorAll('[data-bs-toggle="dropdown"][aria-expanded="true"]');
            for (var k = 0; k < expandedToggles.length; k++) expandedToggles[k].setAttribute('aria-expanded', 'false');
        } catch (e) {}
    }

    function findToggleAncestor(target) {
        try {
            var node = target;
            for (var depth = 0; depth < 5 && node && node !== document; depth++) {
                if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-bs-toggle') === 'dropdown') {
                    return node;
                }
                node = node.parentNode;
            }
        } catch (e) {}
        return null;
    }

    function bindDropdownDelegateOnce() {
        if (window.__orpDropdownDelegateBound) return;
        window.__orpDropdownDelegateBound = true;

        try {
            document.addEventListener('click', function (ev) {
                try {
                    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                    var toggle = findToggleAncestor(ev.target);
                    if (toggle) {
                        ev.preventDefault();
                        ev.stopPropagation();

                        var container = toggle.closest('.dropdown, .dropup, .dropend, .dropstart');
                        var menu = container ? container.querySelector(':scope > .dropdown-menu') : null;
                        if (!menu) {
                            var sib = toggle.nextElementSibling;
                            while (sib && !sib.classList.contains('dropdown-menu')) sib = sib.nextElementSibling;
                            menu = sib;
                        }

                        var isOpen = menu && menu.classList.contains('show');

                        var openMenus = document.querySelectorAll('.dropdown-menu.show');
                        for (var i = 0; i < openMenus.length; i++) if (openMenus[i] !== menu) openMenus[i].classList.remove('show');
                        var openContainers = document.querySelectorAll('.dropdown.show, .dropup.show, .dropend.show, .dropstart.show');
                        for (var j = 0; j < openContainers.length; j++) if (openContainers[j] !== container) openContainers[j].classList.remove('show');
                        var expandedToggles = document.querySelectorAll('[data-bs-toggle="dropdown"][aria-expanded="true"]');
                        for (var k = 0; k < expandedToggles.length; k++) if (expandedToggles[k] !== toggle) expandedToggles[k].setAttribute('aria-expanded', 'false');

                        if (isOpen) {
                            if (menu) menu.classList.remove('show');
                            if (container) container.classList.remove('show');
                            toggle.setAttribute('aria-expanded', 'false');
                        } else {
                            if (menu) menu.classList.add('show');
                            if (container) container.classList.add('show');
                            toggle.setAttribute('aria-expanded', 'true');
                        }
                        return;
                    }

                    var insideMenu = ev.target && ev.target.closest && ev.target.closest('.dropdown-menu.show');
                    if (!insideMenu) closeAllDropdowns();
                } catch (e) {}
            }, false);

            document.addEventListener('keydown', function (ev) {
                try {
                    if (ev.key === 'Escape' || ev.keyCode === 27) {
                        if (document.querySelector('.dropdown-menu.show')) closeAllDropdowns();
                    }
                } catch (e) {}
            }, false);
        } catch (e) {
            try { window.__orpDropdownDelegateBound = false; } catch (e2) {}
        }
    }

    function reinitBootstrapDropdowns() {
        bindDropdownDelegateOnce();
        try {
            var toggles = document.querySelectorAll('[data-bs-toggle="dropdown"]');
            for (var i = 0; i < toggles.length; i++) {
                try { toggles[i].setAttribute('aria-expanded', 'false'); } catch (e) {}
            }
            var openMenus = document.querySelectorAll('.dropdown-menu.show');
            for (var j = 0; j < openMenus.length; j++) openMenus[j].classList.remove('show');
            var openContainers = document.querySelectorAll('.dropdown.show, .dropup.show, .dropend.show, .dropstart.show');
            for (var k = 0; k < openContainers.length; k++) openContainers[k].classList.remove('show');
        } catch (e) {}
    }

    /* ============================================================ *
     *  Plugin instances                                            *
     * ============================================================ */

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

    /* ============================================================ *
     *  Containers                                                  *
     * ============================================================ */

    var containers = (CFG.swupContainers || '#content-wrapper, #content, main, #main')
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

    /* ============================================================ *
     *  URL exclusions                                              *
     * ============================================================ */

    var excluded = [
        '/panier', '/commande', '/authentification', '/identite',
        '/historique-des-commandes', '/adresses',
        '/cart', '/order', '/login', '/register', '/identity',
        '/order-history', '/addresses'
    ];
    if (CFG.swupExcludeContact) {
        excluded.push('/contactez-nous', '/contact-us', '/nous-contacter', '/contact');
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

    /* ============================================================ *
     *  Boot                                                        *
     * ============================================================ */

    try {
        // Tag language links + bind dropdown delegate BEFORE Swup
        // initializes its own click handler, so our data-no-swup
        // attributes are in place when Swup builds its delegate.
        tagLanguageLinks();
        bindDropdownDelegateOnce();

        window.swup = new window.Swup({
            containers: containers,
            animationSelector: false,
            cache: true,
            // linkSelector: exclude data-iso-code links so the language
            // switcher always falls through to a full-reload navigation
            // (the only correct behaviour on language change anyway,
            // since the entire shop content is re-rendered).
            linkSelector: 'a[href]:not([target]):not([download]):not([data-no-swup]):not([data-iso-code])'
                + (excludeFunctions.length ? ':not(' + excludeFunctions.join('):not(') + ')' : ''),
            plugins: plugins,
            ignoreVisit: function (url) {
                if (!url) return false;
                try {
                    var u = new URL(url, window.location.origin);
                    if (u.searchParams && u.searchParams.has('id_lang')) return true;
                    var curMatch = window.location.pathname.match(/^\/([a-z]{2})(\/|$)/);
                    var tgtMatch = u.pathname.match(/^\/([a-z]{2})(\/|$)/);
                    if (curMatch && tgtMatch && curMatch[1] !== tgtMatch[1]) return true;
                } catch (e) {}
                for (var i = 0; i < excluded.length; i++) {
                    if (url.indexOf(excluded[i]) !== -1) return true;
                }
                return false;
            }
        });

        // Hook into Swup's lifecycle to apply our fixes on each swap.
        try {
            window.swup.hooks.before('content:replace', function (visit) {
                try {
                    var html = visit && visit.to && visit.to.html ? visit.to.html : '';
                    if (html) mergePrestashopData(html);

                    var doc = visit && visit.to && visit.to.document ? visit.to.document : null;
                    if (!doc) return;
                    // Mark inline scripts that bind listeners so they
                    // don't get re-executed and stack handlers.
                    var scripts = doc.querySelectorAll('script:not([src])');
                    scripts.forEach(function (s) {
                        if (s.hasAttribute('data-swup-reload-script')) return; // operator opt-out
                        var code = s.textContent || '';
                        if (IGNORE_SCRIPT_PATTERNS.test(code)) {
                            s.setAttribute('data-swup-ignore-script', '');
                        }
                    });
                } catch (e) {}
            });

            window.swup.hooks.on('content:replace', function () {
                try {
                    tagLanguageLinks();         // freshly-swapped DOM may have new lang links
                    reinitBootstrapDropdowns(); // reset .show / aria-expanded on toggles
                } catch (e) {}
            });
        } catch (e) {}

        if (window.console && window.console.log) {
            console.log('[orp] Swup initialized (containers=' + containers.join(',') +
                        ', plugins=' + plugins.length +
                        ', listener-stacking guard ON, language exclusion ON, dropdown delegate ON)');
        }
    } catch (e) {
        if (window.console && window.console.error) {
            console.error('[orp] Swup init failed', e);
        }
    }
})();
