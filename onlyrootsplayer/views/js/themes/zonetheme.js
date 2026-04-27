/**
 * OnlyRoots Persistent Audio Player — ZOneTheme reinit preset
 *
 * Re-initialises ZOneTheme components that don't survive a Swup content swap
 * by themselves: amegamenu (desktop + mobile), left/right sidebars, scroll-to
 * -top, sticky header wrappers, and the various $(window).on('load', ...)
 * handlers the theme registers.
 *
 * IMPORTANT: this preset INTENTIONALLY does NOT call $(window).trigger('load').
 * Re-firing window.load wakes up every other module's load handler — Google
 * Analytics, vatnumbercleaner, etc. — and several of them call
 * `prestashop.on(...)` which throws after a Swup swap because the prestashop
 * object has been clobbered by re-executed inline scripts. We instead invoke
 * the specific ZOneTheme reinit functions by name, which is both safer and
 * faster.
 *
 * The function attaches itself to window.orpThemePresets.zonetheme so the
 * core player.js can call it from its `content:replace` Swup hook.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */
(function () {
    'use strict';

    window.orpThemePresets = window.orpThemePresets || {};

    // Theme functions to re-invoke after each swap. Each one is gated by a
    // typeof check so a missing/renamed function in a future ZOneTheme update
    // logs a warning instead of breaking the whole reinit chain.
    var REINIT_FUNCTIONS = [
        'handleCookieMessage',
        'stickyHeader',
        'scrollToTopButton',
        'loadSidebarNavigation',
        'loadSidebarCart',
        'lazyItemMobileSliderScroll',
        'ajaxLoadDrodownContent',
        'mobileToggleEvent',
        'enableHoverMenuOnTablet',
        'setCurrentMenuItem'
    ];

    function safeWarn() {
        try {
            if (window.console && typeof window.console.warn === 'function') {
                window.console.warn.apply(window.console, arguments);
            }
        } catch (e) {}
    }

    /**
     * Removes duplicate listeners on theme triggers before they get
     * re-attached. Without this, every Swup swap doubles the click handlers
     * (megamenu opens twice, sidebar toggles twice, etc.).
     */
    function cleanupListeners($) {
        try {
            // Megamenu (desktop + mobile)
            $('#mobile-amegamenu .amenu-item.plex > .amenu-link').off('click');
            $('#amegamenu .amenu-item.plex > .amenu-link').off('touchstart');
            $('#amegamenu').off('touchstart');

            // Sidebars (left nav + cart preview)
            $('[data-left-nav-trigger]').off('click');
            $('[data-close-st-menu]').off('click');
            $('[data-sidebar-cart-trigger]').off('click');
            $('[data-close-st-cart]').off('click');

            // Scroll-to-top button
            $('[data-scroll-to-top] a').off('click');

            // Sticky-header: each swap wraps the header in a new sticky
            // wrapper. Without unwrapping, we get nested wrappers that break
            // CSS positioning. Only unwrap when there is exactly one child
            // (the safe case).
            $('.desktop-sticky-wrapper, .mobile-sticky-wrapper').each(function () {
                var $w = $(this);
                if ($w.children().length === 1) {
                    $w.children().first().unwrap();
                }
            });
        } catch (e) {
            safeWarn('[ORP zonetheme] cleanup error:', e);
        }
    }

    /**
     * Calls each reinit function by name. Each one is wrapped in its own
     * try/catch so one buggy theme function doesn't stop the rest.
     */
    function reinitThemeComponents() {
        for (var i = 0; i < REINIT_FUNCTIONS.length; i++) {
            var name = REINIT_FUNCTIONS[i];
            var fn   = window[name];
            if (typeof fn !== 'function') continue;

            try {
                fn();
            } catch (e) {
                safeWarn('[ORP zonetheme] ' + name + ' threw:', e);
            }
        }
    }

    window.orpThemePresets.zonetheme = function () {
        if (typeof window.jQuery === 'undefined') {
            safeWarn('[ORP zonetheme] jQuery not loaded — preset skipped');
            return;
        }
        var $ = window.jQuery;

        cleanupListeners($);
        reinitThemeComponents();
    };
})();
