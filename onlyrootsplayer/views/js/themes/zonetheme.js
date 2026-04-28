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

        // AJAX megamenu dropdown content. Returns true if the AJAX request
        // was fired (placeholders existed and the controller URL is known).
        // The actual dropdown HTML is replaced asynchronously in the
        // success callback — won't show in this telemetry tick.
        var megamenuAjaxFired = reinitAjaxMegamenuContent($);

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
                    megamenuAjax:     megamenuAjaxFired ? 1 : 0,
                    rtl:              rtl ? 1 : 0,
                });
            } catch (e) {}
        }
    };
})();
