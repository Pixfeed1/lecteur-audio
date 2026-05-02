/**
 * OnlyRoots Persistent Audio Player — ZOneTheme reinit preset
 *
 * Re-implements the parts of ZOneTheme's $(window).on('load', ...) handlers
 * that are needed after a Swup content swap. Calibrated against the
 * v2.7.3 ZOneTheme source (fournie en archive sur la branche main).
 *
 * Why we don't simply call the theme's named functions:
 * ZOneTheme's `_dev/js/aone/*.js` modules are bundled via webpack into
 * `assets/js/theme.js`. Each module is wrapped in its own IIFE by webpack,
 * so top-level `function stickyHeader() {}` declarations DO NOT end up on
 * `window`. We verified this empirically: the diagnostic monitor in v2.4.1
 * captured `fnsMissing=stickyHeader,mobileToggleEvent,...` for ALL 17
 * function names we tried.
 *
 * What we do instead:
 *   - Re-call the jQuery plugins directly ($.fn.slick, $.fn.nivoSlider,
 *     $.fn.sticky) on the same DOM selectors ZOneTheme uses, with the
 *     same options read from the same data-* attributes.
 *   - Re-attach the click/touch handlers ZOneTheme installs on its menu
 *     and sidebar triggers.
 *
 * This is intentionally tightly coupled to ZOneTheme's selector and
 * data-attribute conventions. If ZOneTheme renames a class in a future
 * update, we'll see it in the monitor's `orp:preset:invoked` telemetry
 * (the relevant counter will go to 0) and patch this file.
 *
 * IMPORTANT: this preset INTENTIONALLY does NOT call $(window).trigger('load').
 * Re-firing window.load wakes up every other module's load handler and
 * several call `prestashop.on(...)` which throws after a Swup swap.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */
(function () {
    'use strict';

    window.orpThemePresets = window.orpThemePresets || {};

    function safeWarn() {
        try {
            if (window.console && typeof window.console.warn === 'function') {
                window.console.warn.apply(window.console, arguments);
            }
        } catch (e) {}
    }

    /* ============================================================ */
    /*  ZOneTheme POPSTATE KILLER (v2.5.16)                         */
    /* ============================================================ */

    /**
     * Neutralises ZOneTheme's `window.location.href = e.state.current_url`
     * popstate handler (themes/ZOneTheme/_dev/js/listing.js line 388).
     * Without this, browser back/forward after a Swup nav forces a full
     * reload and kills the persistent player audio.
     *
     * Bound exactly once via a window flag.
     */
    function killZoneThemePopstateHandler() {
        if (window.__orpPopstateKillerBound) return false;
        window.__orpPopstateKillerBound = true;

        window.addEventListener('popstate', function (ev) {
            try {
                if (!ev || !ev.state || typeof ev.state !== 'object') return;
                if (typeof ev.state.current_url !== 'string') return;
                if (typeof ev.stopImmediatePropagation === 'function') {
                    ev.stopImmediatePropagation();
                }
            } catch (e) {
                safeWarn('[ORP zonetheme] popstate killer error', e);
            }
        }, true /* capture phase */);

        return true;
    }

    /* ============================================================ */
    /*  pm_advancedsearch4 REBIND (v2.5.17)                         */
    /* ============================================================ */

    /**
     * Restore pm_advancedsearch4 (the "advancedsearch4" PrestaShop
     * module by PrestaModule) functionality after a Swup swap.
     *
     * pm_advancedsearch4 fully replaces the native ps_facetedsearch
     * with its own faceted-search engine. Its lifecycle relies on:
     *   1. A `<script>` inline in the document <head> that assigns
     *      `as4Plugin.params[N] = { ... }` with the search context
     *      (id_search, criterions, etc.). This script is regenerated
     *      server-side for every page load.
     *   2. `as4Plugin.initSearchBlock(N, 'search', 'init')` called once
     *      at $(window).on('load') to bind change/click handlers on
     *      checkboxes inside `.PM_ASBlockOutput`.
     *   3. A `prestashop.on('updateProductList', ...)` listener
     *      registered globally that does `$('#js-product-list').html(data.rendered_products)`
     *      to swap in the new product DOM after a facet change.
     *
     * Three things break under Swup:
     *
     *   A. The <head> script is INSIDE swup-head-plugin's scope but
     *      not ré-évaluated because head-plugin only re-executes
     *      scripts whose content changed — and as4Plugin.params is
     *      idempotent at the syntax level (just an assignment), so
     *      head-plugin sees no diff and skips it. After the swap,
     *      `as4Plugin.params` is empty for the new page.
     *
     *   B. `initSearchBlock` was only called once at $(window).on('load')
     *      in the original page lifecycle. The new checkboxes that
     *      arrive in the swapped #content-wrapper have no event
     *      handlers.
     *
     *   C. The native `updateProductList` listener does:
     *         $('#js-product-list').html(data.rendered_products)
     *      But `data.rendered_products` from the server is HTML that
     *      INCLUDES the `<div id="js-product-list">` wrapper itself
     *      (cf. tested response in production: 8763 chars starting
     *      with `<div id="js-product-list">`). Setting that as
     *      .html() of an existing `#js-product-list` produces a
     *      duplicate ID and a structurally-broken DOM that browsers
     *      render as the OLD content. The user sees the loader,
     *      sees the AJAX fire, but visually nothing changes.
     *
     * Fix:
     *   1. Re-fetch the current URL, extract the as4Plugin.params script,
     *      eval it. (We use `new Function()` not `eval()` to avoid strict
     *      mode + lexical scope issues.)
     *   2. Call `initSearchBlock(N, 'search', 'init')` for each
     *      `.PM_ASBlockOutput[data-id-search]` we find in the live DOM.
     *   3. Replace the broken `updateProductList` listener with our own
     *      that uses `$('#js-product-list').replaceWith(data.rendered_products)`
     *      instead of `.html(...)`. This handles the wrapper-included
     *      response correctly.
     *
     * Step 3 is bound exactly once — replacing it on every swap would
     * stack handlers and re-introduce the duplication issues we already
     * see with other ZOneTheme listeners (cf. v2.5.11 inline-bindings
     * regex).
     */

    var __orpAs4ListenerInstalled = false;

    function installAs4UpdateProductListHandler() {
        if (__orpAs4ListenerInstalled) return false;
        if (typeof window.prestashop !== 'object' || typeof window.prestashop.on !== 'function') return false;

        try {
            // Drop any existing listeners — they're the broken native ones
            // that use .html() instead of .replaceWith() and would race ours.
            // We re-introduce known-good behaviour ourselves.
            if (typeof window.prestashop.removeAllListeners === 'function') {
                window.prestashop.removeAllListeners('updateProductList');
            }

            window.prestashop.on('updateProductList', function (data) {
                try {
                    if (!data) return;

                    // GUARD 1 — URL relevance check.
                    // Production diagnosis showed that when the user clicks
                    // away from a faceted-search page (e.g. category → home)
                    // before the AS4 AJAX response has settled, the
                    // updateProductList event fires AFTER the Swup swap has
                    // already moved the user to a different page (e.g. /fr/).
                    // The handler then runs `$('#js-product-list').replaceWith(...)`
                    // against the home's #js-product-list (or any other
                    // page that happens to also have one), corrupting the
                    // freshly-swapped DOM. Result: the user lands on the
                    // home with a wiped #content-wrapper containing only
                    // an empty <div class="center-wrapper">.
                    //
                    // The AS4 response payload includes `current_url` (the
                    // canonical URL the search results correspond to). If
                    // that URL no longer matches the live URL, we know the
                    // user navigated away mid-AJAX and must not apply the
                    // payload.
                    if (data.current_url && typeof data.current_url === 'string') {
                        var liveUrl = window.location.href;
                        // Loose match: payload current_url must be a prefix
                        // of liveUrl (or vice versa) up to query/hash.
                        var dataPath = data.current_url.split('?')[0].split('#')[0];
                        var livePath = liveUrl.split('?')[0].split('#')[0];
                        // Tolerate trailing slash differences.
                        var normalize = function (u) { return u.replace(/\/+$/, ''); };
                        if (normalize(dataPath) !== normalize(livePath)) {
                            // Stale event — user navigated away. Drop silently.
                            return;
                        }
                    }

                    // GUARD 2 — sanity check the live DOM structure before
                    // committing destructive operations. If the live page
                    // has no #js-product-list at all, it's not a listing
                    // page (we may have landed on home or a CMS page after
                    // a swap that races with this event). Don't touch.
                    var $liveProductList = window.jQuery('#js-product-list');
                    if (!$liveProductList.length) return;

                    if (data.rendered_products) {
                        $liveProductList.replaceWith(data.rendered_products);
                    }
                    if (data.rendered_products_top) {
                        var $top = window.jQuery('#js-product-list-top');
                        if ($top.length) $top.replaceWith(data.rendered_products_top);
                    }
                    if (data.rendered_products_bottom) {
                        var $bot = window.jQuery('#js-product-list-bottom');
                        if ($bot.length) $bot.replaceWith(data.rendered_products_bottom);
                    }
                    if (data.rendered_active_filters) {
                        var $filters = window.jQuery('.PM_ASSelections, .active_filters, .js-active-filters').first();
                        if ($filters.length) $filters.html(data.rendered_active_filters);
                    }
                    if (data.rendered_facets) {
                        // Re-render the left-column facet groups themselves so unselected
                        // facets reflect the post-filter counts. This is the ZOneTheme/
                        // ps_facetedsearch contract too.
                        var $facets = window.jQuery('#search_filters_wrapper, .js-search-filters-wrapper, #search_filters').first();
                        if ($facets.length) $facets.replaceWith(data.rendered_facets);
                    }
                } catch (e) {
                    safeWarn('[ORP zonetheme] updateProductList handler error', e);
                }
            });

            __orpAs4ListenerInstalled = true;
            return true;
        } catch (e) {
            safeWarn('[ORP zonetheme] failed to install as4 listener', e);
            return false;
        }
    }

    /**
     * Defensively wrap `as4Plugin.getParamValue` so it returns an empty
     * string instead of throwing when `as4Plugin.params[idSearch]` is
     * missing. This closes the race window where the user clicks an AS4
     * facet AFTER a Swup swap but BEFORE `rehydrateAs4Params()` has
     * re-fetched the inline params script (typically 50–300ms).
     *
     * Without this wrapper, `as4Plugin.getParamValue(idSearch, key)`
     * accesses `as4Plugin.params[idSearch][key]` and crashes with
     * "Cannot read properties of undefined (reading
     * 'as4_productFilterListData')" — the exact error captured in the
     * production monitor log on 2026-05-02 14:58:04.
     *
     * Source of the original function: `pm_advancedsearch4/views/js/
     * as4_plugin.js` (called from 8 sites: lines 98, 120, 565, 602,
     * 681, 764 plus the `-17.js` variant). It accesses
     * `as4Plugin.params[idSearch]['as4_productFilterListData']` (and
     * other keys: `as4_productFilterListSource`, `scrollTopActive`,
     * `resetURL`).
     *
     * Returning '' is safe because the PHP template
     * (`pm_advancedsearch.tpl` line 79) literally outputs the string
     * `''` when `$as4_productFilterListData` is empty, so callers
     * already handle that empty-string case in their JSON.parse logic.
     *
     * Idempotent: the `__orpPatched` flag on the wrapped function
     * prevents double-wrapping if the function is called more than
     * once per swap (which it is — preset runs cleanup + reinit
     * passes that may both invoke this).
     *
     * @return {boolean} true if the patch was applied (or was already
     *   applied), false if `as4Plugin.getParamValue` isn't available
     *   yet (page doesn't have AS4, or pm_advancedsearch4 hasn't
     *   booted yet — in which case there's nothing to patch).
     */
    function patchAs4GetParamValue() {
        try {
            if (typeof window.as4Plugin !== 'object' || !window.as4Plugin) return false;
            if (typeof window.as4Plugin.getParamValue !== 'function') return false;
            if (window.as4Plugin.getParamValue.__orpPatched) return true;

            var origGetParamValue = window.as4Plugin.getParamValue.bind(window.as4Plugin);
            var wrapped = function (idSearch, paramName) {
                try {
                    if (!window.as4Plugin.params || !window.as4Plugin.params[idSearch]) {
                        return '';
                    }
                    return origGetParamValue(idSearch, paramName);
                } catch (e) {
                    return '';
                }
            };
            wrapped.__orpPatched = true;
            window.as4Plugin.getParamValue = wrapped;
            return true;
        } catch (e) {
            safeWarn('[ORP zonetheme] patchAs4GetParamValue threw:', e);
            return false;
        }
    }

    /**
     * Re-fetch the current URL and re-eval the as4Plugin.params inline
     * script. Returns a Promise that resolves with the number of params
     * blocks that were re-injected, or 0 if as4 isn't on the page.
     */
    function rehydrateAs4Params() {
        if (typeof window.as4Plugin !== 'object' || !window.as4Plugin) {
            return Promise.resolve(0);
        }
        // Check there's actually an as4 block in the live DOM before fetching.
        var blocks = document.querySelectorAll('.PM_ASBlockOutput[data-id-search]');
        if (!blocks.length) return Promise.resolve(0);

        // Don't re-fetch if params are already populated for every block on the page.
        var allKnown = true;
        for (var i = 0; i < blocks.length; i++) {
            var idSearch = blocks[i].getAttribute('data-id-search');
            if (!idSearch || !window.as4Plugin.params || !window.as4Plugin.params[idSearch]) {
                allKnown = false; break;
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
                    safeWarn('[ORP zonetheme] as4 params eval failed', e);
                }
            });
            return count;
        }).catch(function (e) {
            safeWarn('[ORP zonetheme] as4 params fetch failed', e);
            return 0;
        });
    }

    /**
     * Re-init pm_advancedsearch4 search blocks present in the live DOM.
     * Caller is expected to have called rehydrateAs4Params() first
     * (and to have awaited its Promise) so that as4Plugin.params is
     * populated, otherwise initSearchBlock will throw.
     *
     * @return {number} number of blocks successfully re-init'd
     */
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
                safeWarn('[ORP zonetheme] as4 initSearchBlock failed for id_search=' + idSearch, e);
            }
        }
        return count;
    }

    /**
     * Top-level orchestration for the as4 rebind. Fires once per swap.
     * Async (returns a Promise) because we need to fetch the page HTML
     * to recover as4Plugin.params before re-init can happen.
     */
    function rebindAdvancedSearch4() {
        installAs4UpdateProductListHandler();
        // Patch getParamValue FIRST, before the async rehydration starts.
        // This closes the race window: if the user clicks an AS4 facet
        // while rehydrateAs4Params() is in-flight, the wrapper returns
        // '' instead of throwing on `params[idSearch]['as4_product...']`.
        // Once rehydration completes, params are populated and the
        // wrapper falls through to the original function.
        patchAs4GetParamValue();
        return rehydrateAs4Params().then(function () {
            // Re-patch in case as4Plugin was redefined during the
            // synchronous re-eval of the params block — defensive,
            // idempotent thanks to the __orpPatched flag.
            patchAs4GetParamValue();
            return reinitAs4SearchBlocks();
        });
    }

    /* ============================================================ */
    /*  CLEANUP                                                     */
    /* ============================================================ */

    function cleanupListeners($) {
        try {
            // Megamenu (desktop + mobile) — ZOneTheme reattaches these on
            // each load; without cleanup they'd be doubled.
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

            // Sticky-header: each load re-wraps the header. The wrapper added
            // by previous loads is in the OLD DOM (already discarded by Swup),
            // so the new content has no wrapper — but the existing wrapper(s)
            // on `<body>` outside the swap area may still be there. Unwrap to
            // avoid double-wrapping when stickyHeader runs again.
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

    /* ============================================================ */
    /*  SLIDER REINIT (4 ZOneTheme slider types)                    */
    /* ============================================================ */

    /**
     * #aoneSlider — Hero slideshow on home, jQuery NivoSlider plugin.
     * Source: _dev/js/aone/_aoneslideshow.js
     */
    function reinitAoneSlider($) {
        if (typeof $.fn.nivoSlider !== 'function') return 0;

        var $slider = $('#aoneSlider');
        if (!$slider.length) return 0;
        // NivoSlider sets `nivoSlider` data flag on init. Skip if present.
        if ($slider.data('nivoslider') || $slider.hasClass('nivoSlider')) return 0;

        var settings = $slider.data('settings');
        if (!settings) return 0;

        try {
            $slider.nivoSlider({
                src: 'data-src',
                effect: settings.effect,
                slices: Number(settings.slices),
                boxCols: Number(settings.boxCols),
                boxRows: Number(settings.boxRows),
                animSpeed: Number(settings.animSpeed),
                pauseTime: Number(settings.pauseTime),
                startSlide: Number(settings.startSlide),
                directionNav: settings.directionNav,
                controlNav: settings.controlNav,
                controlNavThumbs: settings.controlNavThumbs,
                pauseOnHover: settings.pauseOnHover,
                manualAdvance: settings.manualAdvance,
                randomStart: settings.randomStart,
                afterLoad: function () {
                    $('#js-nivoSliderOverlay').fadeOut(100, function () {
                        $slider.fadeIn(400);
                    });
                }
            });
            return 1;
        } catch (e) {
            safeWarn('[ORP zonetheme] nivoSlider init threw:', e);
            return 0;
        }
    }

    /**
     * .js-home-block-slider — homepage product carousels
     * ("Derniers arrivages", "Nouveautés", "Onlyroots Records").
     * Slick plugin, options come from data-slickoptions on each slider.
     * Source: _dev/js/aone/_aonehomeblocks.js
     */
    function reinitHomeBlockSliders($) {
        if (typeof $.fn.slick !== 'function') return 0;

        var count = 0;
        $('.js-home-block-slider:not(.slick-initialized)').each(function () {
            var $s  = $(this);
            var opt = $s.data('slickoptions');
            if (!opt) return;

            try {
                $s.slick({
                    slidesToShow: opt.slidesToShow,
                    slidesToScroll: opt.slidesToShow,
                    adaptiveHeight: false,
                    infinite: true,
                    draggable: opt.draggable,
                    speed: opt.speed,
                    autoplay: opt.autoplay,
                    dots: opt.dots,
                    arrows: opt.arrows,
                    rtl: opt.rtl,
                    responsive: [
                        { breakpoint: 1220, settings: { slidesToShow: opt.slidesToShow_1220, slidesToScroll: opt.slidesToShow_1220 } },
                        { breakpoint: 992,  settings: { slidesToShow: opt.slidesToShow_992,  slidesToScroll: opt.slidesToShow_992  } },
                        { breakpoint: 768,  settings: { slidesToShow: opt.slidesToShow_768,  slidesToScroll: opt.slidesToShow_768  } }
                    ]
                });
                $s.on('beforeChange', function () {
                    $s.find('.slick-active img.js-lazy').trigger('appear');
                });
                count++;
            } catch (e) {
                safeWarn('[ORP zonetheme] homeBlockSlider init threw:', e);
            }
        });
        return count;
    }

    /**
     * .js-brand-logo-slider — manufacturer logos carousel.
     * Slick, hardcoded breakpoints, autoscroll from data-autoscroll.
     * Source: _dev/js/aone/_aonebrandlogo.js
     */
    function reinitBrandLogoSliders($, rtl) {
        if (typeof $.fn.slick !== 'function') return 0;

        var count = 0;
        $('.js-brand-logo-slider:not(.slick-initialized)').each(function () {
            var $s     = $(this);
            var scroll = $s.data('autoscroll');

            try {
                $s.slick({
                    slidesToShow: 6,
                    slidesToScroll: 1,
                    adaptiveHeight: false,
                    infinite: true,
                    speed: 700,
                    autoplay: scroll,
                    dots: false,
                    arrows: true,
                    draggable: false,
                    rtl: rtl,
                    responsive: [
                        { breakpoint: 1220, settings: { slidesToShow: 5 } },
                        { breakpoint: 992,  settings: { slidesToShow: 4 } },
                        { breakpoint: 768,  settings: { slidesToShow: 3 } },
                        { breakpoint: 576,  settings: { slidesToShow: 2 } }
                    ]
                });
                $s.on('beforeChange', function () {
                    $s.find('.slick-active img.js-lazy').trigger('appear');
                });
                count++;
            } catch (e) {
                safeWarn('[ORP zonetheme] brandLogoSlider init threw:', e);
            }
        });
        return count;
    }

    /**
     * .js-featured-categories-slider — featured categories block.
     * Slick, slidesToShow comes from data-slidestoshow.
     * Source: _dev/js/aone/_aonefeaturedcategories.js
     */
    function reinitFeaturedCategoriesSliders($, rtl) {
        if (typeof $.fn.slick !== 'function') return 0;

        var count = 0;
        $('.js-featured-categories-slider:not(.slick-initialized)').each(function () {
            var $s  = $(this);
            var sts = $s.data('slidestoshow');

            try {
                $s.slick({
                    slidesToShow: sts,
                    slidesToScroll: sts,
                    adaptiveHeight: true,
                    infinite: true,
                    draggable: false,
                    speed: 1000,
                    autoplay: false,
                    dots: false,
                    arrows: true,
                    rtl: rtl,
                    responsive: [
                        { breakpoint: 992, settings: { slidesToShow: Math.min(2, sts - 1), slidesToScroll: Math.min(2, sts - 1) } },
                        { breakpoint: 576, settings: { slidesToShow: Math.min(1, sts),     slidesToScroll: Math.min(1, sts)     } }
                    ]
                });
                $s.on('beforeChange', function () {
                    $s.find('.slick-active img.js-lazy').trigger('appear');
                });
                count++;
            } catch (e) {
                safeWarn('[ORP zonetheme] featuredCategoriesSlider init threw:', e);
            }
        });
        return count;
    }

    /**
     * Bootstrap tab listener — re-positions slick sliders inside tabs when
     * the tab becomes visible (slick can't measure dimensions in a hidden
     * panel, so it needs an explicit setPosition once the tab is shown).
     * Source: updateSlickInTabs() in _aonehomeblocks.js
     */
    function rebindTabSlickRefresh($) {
        // Off first to avoid duplicate handlers stacking up across swaps.
        $('a[data-bs-toggle="tab"]').off('shown.bs.tab.orpZoneTheme');
        $('a[data-bs-toggle="tab"]').on('shown.bs.tab.orpZoneTheme', function (e) {
            var anchor = $(e.target).attr('href');
            try { $('.js-home-block-slider', anchor).slick('setPosition'); } catch (er) {}
            $('img.js-lazy', anchor).trigger('appear');
        });
    }

    /* ============================================================ */
    /*  STICKY HEADER REINIT                                        */
    /* ============================================================ */

    /**
     * Re-applies the jQuery sticky plugin to the desktop and mobile menu
     * containers. ZOneTheme adds wrappers with these specific class names,
     * so the cleanupListeners() unwrap step matches them by class.
     * Source: stickyHeader() in _aonethememanager.js
     */
    function reinitStickyHeader($) {
        if (typeof $.fn.sticky !== 'function') return false;

        var $stickyMenu       = $('.desktop-header-version [data-sticky-menu]');
        var $mobileStickyMenu = $('.mobile-header-version [data-mobile-sticky]');
        var did = false;

        if ($stickyMenu.length) {
            try {
                $stickyMenu.sticky({ wrapperClassName: 'desktop-sticky-wrapper' });
                $('[data-sticky-cart]').html($('[data-header-cart-source]').html());
                did = true;
            } catch (e) {
                safeWarn('[ORP zonetheme] desktop sticky init threw:', e);
            }
        }
        if ($mobileStickyMenu.length) {
            try {
                $mobileStickyMenu.sticky({ wrapperClassName: 'mobile-sticky-wrapper' });
                did = true;
            } catch (e) {
                safeWarn('[ORP zonetheme] mobile sticky init threw:', e);
            }
        }
        return did;
    }

    /* ============================================================ */
    /*  MEGAMENU + SIDEBARS + SCROLL-TO-TOP                         */
    /* ============================================================ */

    /**
     * Mobile megamenu toggle. Source: mobileToggleEvent() in _aonemegamenu.js
     */
    function rebindMobileMegamenu($) {
        $('#mobile-amegamenu .amenu-item.plex > .amenu-link').on('click', function () {
            if (!$(this).hasClass('expanded')) {
                $('#mobile-amegamenu .expanded').removeClass('expanded')
                    .next('.adropdown').slideUp();
            }
            $(this).next('.adropdown').stop().slideToggle();
            $(this).toggleClass('expanded');
            return false;
        });
    }

    /**
     * Tablet hover for desktop megamenu. Source: enableHoverMenuOnTablet()
     */
    function rebindTabletHoverMegamenu($) {
        $('html').off('touchstart.orpZoneTheme')
            .on('touchstart.orpZoneTheme', function () {
                $('#amegamenu .amenu-item').removeClass('hover');
            });
        $('#amegamenu').on('touchstart', function (e) { e.stopPropagation(); });
        $('#amegamenu .amenu-item.plex > .amenu-link').on('touchstart', function (e) {
            var li = $(this).parent('li');
            if (li.hasClass('hover')) return true;
            $('#amegamenu .amenu-item').removeClass('hover');
            li.addClass('hover');
            e.preventDefault();
            return false;
        });
    }

    /**
     * Mark the currently-active item in the ajax mega menu. Source:
     * setCurrentMenuItem() in _aonemegamenu.js
     */
    function markCurrentMenuItem($) {
        if (typeof window.varBreadcrumbLinks === 'undefined') return;
        $('.js-ajax-mega-menu .amenu-item').each(function () {
            var href = $(this).find('a.amenu-link').attr('href');
            if ($.inArray(href, window.varBreadcrumbLinks) !== -1) {
                $(this).addClass('curr-menu');
            }
        });
    }

    /**
     * Left nav + cart sidebar triggers. Source: loadSidebarNavigation()
     * + loadSidebarCart() in _aonethememanager.js
     */
    function rebindSidebars($) {
        if ($('[data-st-menu]').length) {
            $('[data-left-nav-trigger]').on('click', function () {
                $('html').addClass('st-effect-left st-menu-open');
                return false;
            });
            $('[data-close-st-menu]').on('click', function () {
                $('html').removeClass('st-menu-open st-effect-left');
            });
        }
        if ($('[data-st-cart]').length) {
            $('[data-sidebar-cart-trigger]').on('click', function () {
                $('html').addClass('st-effect-right st-menu-open');
                return false;
            });
            $('[data-close-st-cart]').on('click', function () {
                $('html').removeClass('st-menu-open st-effect-right');
            });
        }
    }

    /**
     * Source: scrollToTopButton() in _aonethememanager.js
     */
    function rebindScrollToTop($) {
        var $sttb = $('[data-scroll-to-top]');
        if (!$sttb.length) return;

        // The window.scroll handler is global and survives Swup; we don't
        // re-bind it (would just duplicate). The click handler however IS
        // attached to a specific DOM element which Swup discards/replaces.
        $('a', $sttb).on('click', function () {
            if (typeof $.smoothScroll === 'function') {
                $.smoothScroll({ speed: 500, scrollTarget: '#page' });
            } else {
                $('html, body').animate({ scrollTop: 0 }, 500);
            }
            return false;
        });
    }

    /* ============================================================ */
    /*  AJAX MEGAMENU CONTENT (dropdowns loaded async by ZOneTheme) */
    /* ============================================================ */

    /**
     * ZOneTheme defers the megamenu dropdown content loading to a single
     * `ajaxLoadDrodownContent()` call inside its `$(window).on('load',...)`
     * handler. After a Swup swap the new page's HTML has empty
     * `.js-dropdown-content` placeholders inside `.js-ajax-mega-menu` and
     * window.load doesn't fire again — so hover on a megamenu category
     * shows nothing. Source: `ajaxLoadDrodownContent()` in
     * `_dev/js/aone/_aonemegamenu.js`. The destination URL is exposed as
     * the global `varMenuDropdownContentController` (set by an inline
     * <script> the theme renders).
     */
    function reinitAjaxMegamenuContent($) {
        var $ajaxmenu = $('.js-ajax-mega-menu');
        if (!$ajaxmenu.length) return false;
        if (typeof window.varMenuDropdownContentController === 'undefined') return false;

        // Skip if dropdowns are already populated (no `.js-dropdown-content`
        // placeholder left to replace). Idempotent across re-runs.
        var $placeholders = $('.js-dropdown-content', $ajaxmenu);
        if (!$placeholders.length) return false;

        try {
            $.ajax({
                type: 'GET',
                url: window.varMenuDropdownContentController,
                dataType: 'json',
                success: function (dropdown) {
                    try {
                        $('.js-dropdown-content', $ajaxmenu).each(function () {
                            var item = $(this).data('id-menu');
                            if (dropdown && dropdown[item]) {
                                $(this).replaceWith(dropdown[item]);
                            }
                        });
                        // After replacing dropdowns, re-position them. Source:
                        // updateDropdownPosition() in _aonemegamenu.js — needs
                        // the dropdown content actually rendered to measure
                        // widths, hence why it runs in the success callback.
                        updateMegamenuDropdownPosition($);
                    } catch (e) {
                        safeWarn('[ORP zonetheme] dropdown replace failed:', e);
                    }
                },
                error: function (xhr) {
                    safeWarn('[ORP zonetheme] varMenuDropdownContentController fetch failed:', xhr && xhr.status);
                }
            });
            return true;
        } catch (e) {
            safeWarn('[ORP zonetheme] ajax megamenu init threw:', e);
            return false;
        }
    }

    /**
     * Re-positions each `.adropdown` so it stays within the megamenu's
     * horizontal bounds. Source: newUpdateDropdownPosition() and
     * newUpdateDropdownPositionRTL() in _aonemegamenu.js.
     */
    function updateMegamenuDropdownPosition($) {
        try {
            var $amegamenu = $('#amegamenu');
            if (!$amegamenu.length) return;

            var rtl = $amegamenu.hasClass('amegamenu_rtl');
            var mmWidth = $amegamenu.outerWidth();

            $('.adropdown', $amegamenu).each(function () {
                var $dropdown = $(this);
                var $menu     = $dropdown.parent('.amenu-item');
                var dWidth    = $dropdown.outerWidth();

                if (mmWidth <= dWidth) return;

                var mid;
                var gap;
                if (rtl) {
                    mid = (mmWidth - dWidth) / 2;
                    gap = ((mmWidth - $menu.outerWidth()) / 2)
                        - (mmWidth - $menu.position().left - $menu.outerWidth() - parseFloat($menu.css('margin-right')));
                    if (mid > gap) {
                        if (mid - gap + dWidth > mmWidth) {
                            $dropdown.css('margin-right', (mmWidth - dWidth) + 'px');
                        } else {
                            $dropdown.css('margin-right', (mid - gap) + 'px');
                        }
                    } else {
                        $dropdown.css('margin-right', '0px');
                    }
                } else {
                    mid = (mmWidth - dWidth) / 2;
                    gap = ((mmWidth - $menu.outerWidth()) / 2)
                        - ($menu.position().left + parseFloat($menu.css('margin-left')));
                    if (mid > gap) {
                        if (mid - gap + dWidth > mmWidth) {
                            $dropdown.css('margin-left', (mmWidth - dWidth) + 'px');
                        } else {
                            $dropdown.css('margin-left', (mid - gap) + 'px');
                        }
                    } else {
                        $dropdown.css('margin-left', '0px');
                    }
                }
            });
        } catch (e) {
            safeWarn('[ORP zonetheme] updateMegamenuDropdownPosition threw:', e);
        }
    }

    /* ============================================================ */
    /*  LAZY LOAD (img.js-lazy)                                     */
    /* ============================================================ */

    /**
     * ZOneTheme initialises jQuery.lazyload on `img.js-lazy` inside its
     * single $(window).on('load',...) handler in _aonethememanager.js
     * (with a 1s setTimeout). After a Swup swap, new pages contain fresh
     * `img.js-lazy` placeholders that never get hooked.
     *
     * IMPORTANT: $.fn.lazyload is webpack-scoped in ZOneTheme's bundle
     * (the v2.4.12 monitor capture confirmed `lazyImages=0` in every
     * orp:preset:invoked event — the plugin call returned 0 silently
     * because the global jQuery doesn't expose the plugin). So we don't
     * call the plugin at all. Instead we mimic its behaviour directly:
     * read `data-original` (or `data-src` as a fallback for less
     * legacy themes) and swap it into `src`.
     *
     * Source attribute confirmed via grep on
     * modules/zoneslideshow/.../banners.tpl:
     *
     *     data-original = "{$image_baseurl}{$aslide.image}"
     *     class = "img-fluid js-lazy"
     *
     * Idempotent across swaps: once an image's `src` matches its
     * `data-original`, we skip it. The `js-lazy` class is removed so a
     * second pass doesn't reprocess. Returns the count of images we
     * actually swapped this run (for telemetry).
     */
    function reinitLazyLoad($) {
        var $imgs = $('img.js-lazy');
        if (!$imgs.length) return 0;

        var swapped = 0;
        $imgs.each(function () {
            try {
                var img = this;
                var src = img.getAttribute('data-original') || img.getAttribute('data-src');
                if (!src) return;
                if (img.getAttribute('src') === src) {
                    // Already at final src — just clean the class.
                    img.classList.remove('js-lazy');
                    return;
                }
                img.setAttribute('src', src);
                img.classList.remove('js-lazy');
                swapped++;
            } catch (e) {
                safeWarn('[ORP zonetheme] lazyload swap threw:', e);
            }
        });
        return swapped;
    }

    /* ============================================================ */
    /*  BOOTSTRAP DROPDOWNS — manual delegate (BS API unreachable)   */
    /* ============================================================ */

    /**
     * Workaround for ZOneTheme — Bootstrap is not exposed on
     * `window.bootstrap`. The compiled `theme.js` bundle keeps it in
     * webpack-local scope, so we cannot call `bootstrap.Dropdown
     * .getInstance(el).dispose()` to repair stale instances after a
     * Swup swap. The previous v2.5.12 fix was a no-op for this reason.
     *
     * Instead of fighting Bootstrap's instance map, we handle dropdown
     * open/close ourselves via a single delegated click handler on
     * `document`. The handler survives every Swup swap because we
     * never replace `document` — only `<body>` content gets swapped.
     *
     * Mechanics:
     *   1. Click on any `[data-bs-toggle="dropdown"]`:
     *      - Close any other open dropdowns first.
     *      - Toggle `.show` on the toggle's parent `.dropdown` and on
     *        the sibling `.dropdown-menu`.
     *      - Mirror the state into `aria-expanded`.
     *   2. Click outside any open dropdown: close them all.
     *   3. Escape key: close them all.
     *
     * The CSS classes `.show` on `.dropdown-menu` are exactly what
     * Bootstrap 5 uses, so the existing theme styles render correctly
     * (the visual toggle is CSS-driven, not JS-driven).
     *
     * Bound exactly once via the orpDropdownDelegateBound flag on
     * window so a re-injected zonetheme.js doesn't stack handlers.
     */
    function bindDropdownDelegateOnce() {
        if (window.__orpDropdownDelegateBound) return false;
        window.__orpDropdownDelegateBound = true;

        function findToggleAncestor(node) {
            // Walk up max 4 hops looking for an element with the toggle attr.
            // The user might click on the inner <span>, <img>, etc.
            for (var i = 0; i < 4 && node && node !== document.body; i++) {
                if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-bs-toggle')
                    && node.getAttribute('data-bs-toggle') === 'dropdown') {
                    return node;
                }
                node = node.parentNode;
            }
            return null;
        }

        function closeAllDropdowns(except) {
            var openMenus = document.querySelectorAll('.dropdown-menu.show, .dropdown.show');
            for (var i = 0; i < openMenus.length; i++) {
                if (except && (openMenus[i] === except || openMenus[i].contains(except))) continue;
                openMenus[i].classList.remove('show');
            }
            var openToggles = document.querySelectorAll('[data-bs-toggle="dropdown"][aria-expanded="true"]');
            for (var j = 0; j < openToggles.length; j++) {
                if (except && openToggles[j].closest && openToggles[j].closest('.dropdown') === except) continue;
                openToggles[j].setAttribute('aria-expanded', 'false');
            }
        }

        document.addEventListener('click', function (ev) {
            var toggle = findToggleAncestor(ev.target);
            if (toggle) {
                ev.preventDefault();
                ev.stopPropagation();
                var dropdownContainer = toggle.closest('.dropdown') || toggle.parentNode;
                if (!dropdownContainer) return;
                var menu = dropdownContainer.querySelector('.dropdown-menu');
                var willOpen = !(menu && menu.classList.contains('show'));
                closeAllDropdowns(willOpen ? dropdownContainer : null);
                if (menu) menu.classList.toggle('show', willOpen);
                dropdownContainer.classList.toggle('show', willOpen);
                toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                return;
            }

            // Click outside any toggle and any open menu — close everything.
            var insideOpenMenu = ev.target.closest && ev.target.closest('.dropdown-menu.show');
            if (!insideOpenMenu) {
                closeAllDropdowns(null);
            }
        }, false);

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' || ev.keyCode === 27) {
                closeAllDropdowns(null);
            }
        }, false);

        return true;
    }

    /**
     * Called from the preset entry point on every successful swap.
     * After a swap, the toggles in the new DOM may have stale
     * `aria-expanded="true"` from before they were replaced. Reset
     * everything to a closed state so the next click opens cleanly.
     *
     * The delegated handler stays bound across swaps via document
     * (which is never replaced).
     *
     * @return {number} count of toggles found in the live DOM
     */
    function reinitBootstrapDropdowns($) {
        bindDropdownDelegateOnce();

        var toggles = document.querySelectorAll('[data-bs-toggle="dropdown"]');
        for (var i = 0; i < toggles.length; i++) {
            try {
                toggles[i].setAttribute('aria-expanded', 'false');
                var container = toggles[i].closest('.dropdown');
                if (container) container.classList.remove('show');
            } catch (e) {}
        }
        var openMenus = document.querySelectorAll('.dropdown-menu.show');
        for (var k = 0; k < openMenus.length; k++) {
            openMenus[k].classList.remove('show');
        }
        return toggles.length;
    }

    /* ============================================================ */
    /*  PRESET ENTRY POINT                                          */
    /* ============================================================ */

    window.orpThemePresets.zonetheme = function (context) {
        if (!context || context.trigger !== 'swup-content-replace') {
            safeWarn('[ORP zonetheme] preset called outside Swup context, skipping to avoid double-init');
            return;
        }
        if (typeof window.jQuery === 'undefined') {
            safeWarn('[ORP zonetheme] jQuery not loaded — preset skipped');
            return;
        }

        var $   = window.jQuery;
        var rtl = !!(window.prestashop
            && window.prestashop.language
            && (window.prestashop.language.is_rtl == '1' || window.prestashop.language.is_rtl === true));

        // Kill ZOneTheme's popstate handler (idempotent, runs once).
        var popstateKilled = killZoneThemePopstateHandler();

        // Re-init pm_advancedsearch4 if present (async — fires AJAX
        // re-fetch of the current URL to recover as4Plugin.params from
        // the document <head>). Returns a count via the promise.
        var as4Promise = rebindAdvancedSearch4();

        cleanupListeners($);

        // Sliders (the four ZOneTheme types). All idempotent — already
        // initialised carousels are skipped by their respective guards.
        var sliders = {
            aone:     reinitAoneSlider($),
            home:     reinitHomeBlockSliders($),
            brand:    reinitBrandLogoSliders($, rtl),
            featured: reinitFeaturedCategoriesSliders($, rtl)
        };
        rebindTabSlickRefresh($);

        // Header / nav / sidebars / scroll-to-top.
        var stickyOk = reinitStickyHeader($);
        rebindMobileMegamenu($);
        rebindTabletHoverMegamenu($);
        markCurrentMenuItem($);
        rebindSidebars($);
        rebindScrollToTop($);

        // Bootstrap dropdowns (language selector, currency selector,
        // user account menu, etc.). Swup either nukes the per-element
        // instance (host replaced) or duplicates it (head-plugin re-
        // evaluated theme.js). dispose+recreate heals both.
        var dropdownsReinit = reinitBootstrapDropdowns($);

        // AJAX megamenu dropdown content. Returns true if the AJAX request
        // was fired (placeholders existed and the controller URL is known).
        // The actual dropdown HTML is replaced asynchronously in the
        // success callback — won't show in this telemetry tick.
        var megamenuAjaxFired = reinitAjaxMegamenuContent($);

        // Lazy-load on the new content (cover image, gallery, related
        // products on a product page; product miniatures on category
        // listings). Without this, the product detail block looks empty
        // after Swup nav.
        var lazyImagesHooked = reinitLazyLoad($);

        // Surface what actually fired so the diagnostic monitor can confirm
        // each step, and so we can spot a renamed selector in a future
        // ZOneTheme update before the customer notices.
        if (typeof window.__orpMonitorEnqueue === 'function') {
            try {
                window.__orpMonitorEnqueue('orp:preset:invoked', {
                    preset:           'zonetheme',
                    aoneSlider:       sliders.aone,
                    homeBlockSliders: sliders.home,
                    brandSliders:     sliders.brand,
                    featuredSliders:  sliders.featured,
                    stickyHeader:     stickyOk ? 1 : 0,
                    bootstrapDropdowns: dropdownsReinit,
                    popstateKilled:   popstateKilled ? 1 : 0,
                    as4Detected:      document.querySelectorAll('.PM_ASBlockOutput[data-id-search]').length,
                    megamenuAjax:     megamenuAjaxFired ? 1 : 0,
                    lazyImages:       lazyImagesHooked,
                    rtl:              rtl ? 1 : 0,
                });
            } catch (e) {}
        }
    };
})();
