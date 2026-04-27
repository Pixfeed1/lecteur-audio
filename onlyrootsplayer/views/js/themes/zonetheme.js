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
        'setCurrentMenuItem',
        // Likely slider init functions in ZOneTheme. Tried defensively —
        // typeof guards mean a missing one is a no-op, no error.
        'productHomeFeatured',
        'homeSliderTabs',
        'lazyloadHomeSliders',
        'productSlider',
        'initSlick',
        'initSliders',
        'reinitSliders'
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
     * Calls each reinit function by name. Returns a summary suitable for
     * the diagnostic monitor: which functions were found and called, and
     * which were missing. One buggy theme function doesn't stop the rest.
     */
    function reinitThemeComponents() {
        var found   = [];
        var missing = [];
        var threw   = [];

        for (var i = 0; i < REINIT_FUNCTIONS.length; i++) {
            var name = REINIT_FUNCTIONS[i];
            var fn   = window[name];
            if (typeof fn !== 'function') {
                missing.push(name);
                continue;
            }

            try {
                fn();
                found.push(name);
            } catch (e) {
                threw.push(name);
                safeWarn('[ORP zonetheme] ' + name + ' threw:', e);
            }
        }

        return { found: found, missing: missing, threw: threw };
    }

    /**
     * Generic slider re-initialisation. ZOneTheme's specific slider init
     * functions are often missing from window globals (they're invoked via
     * jQuery.ready in the theme bundle). After a Swup swap, the new HTML
     * has slider markup but no library has run on it yet. We probe the
     * three common libraries and reinitialise any uninitialised carousel.
     *
     * Each library is guarded by a typeof check so we never blow up on a
     * shop that uses Slick but not Owl, or vice versa.
     */
    function reinitSliders($) {
        var counts = { slick: 0, owl: 0, swiper: 0 };

        // Slick: read config from data-slick attribute, skip
        // already-initialised instances.
        if ($.fn && typeof $.fn.slick === 'function') {
            try {
                $('[data-slick]:not(.slick-initialized), .slick-slider:not(.slick-initialized)').each(function () {
                    try {
                        $(this).slick();
                        counts.slick++;
                    } catch (e) {
                        safeWarn('[ORP zonetheme] slick init threw:', e);
                    }
                });
            } catch (e) {
                safeWarn('[ORP zonetheme] slick scan threw:', e);
            }
        }

        // Owl Carousel: same idea, skip already-loaded carousels.
        if ($.fn && typeof $.fn.owlCarousel === 'function') {
            try {
                $('.owl-carousel:not(.owl-loaded)').each(function () {
                    try {
                        $(this).owlCarousel();
                        counts.owl++;
                    } catch (e) {
                        safeWarn('[ORP zonetheme] owl init threw:', e);
                    }
                });
            } catch (e) {
                safeWarn('[ORP zonetheme] owl scan threw:', e);
            }
        }

        // Swiper: each container exposes its instance via element.swiper.
        // Skip elements that already have one.
        if (typeof window.Swiper === 'function') {
            try {
                $('.swiper, .swiper-container').each(function () {
                    if (!this.swiper) {
                        try {
                            new window.Swiper(this);
                            counts.swiper++;
                        } catch (e) {
                            safeWarn('[ORP zonetheme] swiper init threw:', e);
                        }
                    }
                });
            } catch (e) {
                safeWarn('[ORP zonetheme] swiper scan threw:', e);
            }
        }

        return counts;
    }

    window.orpThemePresets.zonetheme = function (context) {
        // Defence in depth: only run when explicitly invoked from the
        // Swup content:replace hook in player.js. The expected call site
        // passes { trigger: 'swup-content-replace' }.
        if (!context || context.trigger !== 'swup-content-replace') {
            safeWarn('[ORP zonetheme] preset called outside Swup context, skipping to avoid double-init');
            return;
        }

        if (typeof window.jQuery === 'undefined') {
            safeWarn('[ORP zonetheme] jQuery not loaded — preset skipped');
            return;
        }
        var $ = window.jQuery;

        cleanupListeners($);
        var fns      = reinitThemeComponents();
        var sliders  = reinitSliders($);

        // Surface what actually happened so the diagnostic monitor can show
        // which theme functions are present (and re-attached) vs. missing
        // — without this, the operator has no way to know whether the
        // preset actually fixed anything on each swap.
        if (typeof window.__orpMonitorEnqueue === 'function') {
            try {
                window.__orpMonitorEnqueue('orp:preset:invoked', {
                    preset: 'zonetheme',
                    fnsFound:   fns.found.join(','),
                    fnsMissing: fns.missing.join(','),
                    fnsThrew:   fns.threw.join(','),
                    slickInit:  sliders.slick,
                    owlInit:    sliders.owl,
                    swiperInit: sliders.swiper,
                });
            } catch (e) {}
        }
    };
})();
