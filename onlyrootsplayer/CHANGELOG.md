# Changelog

All notable changes to OnlyRoots Persistent Audio Player are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.13] — 2026-04-29

### Fixed (real fix this time)

- **Pages cassées (vides) après navigation Swup, encore.** Le v2.4.10
  était censé fixer ça via jQuery.lazyload mais le monitor v2.4.12
  capturait `lazyImages=0` partout — ce qui veut dire que mon code
  retournait 0 silencieusement à chaque fois. Cause : `$.fn.lazyload`
  est **webpack-scopé** dans le bundle ZOneTheme (comme NivoSlider
  pour le hero) — le plugin n'est pas exposé sur le `window.jQuery`
  global, donc mon `if (typeof $.fn.lazyload !== 'function') return 0;`
  bailait toujours. Le fix v2.4.10 n'a jamais effectivement tourné en
  prod malgré l'apparence.

  Nouveau fix : remplacement complet de `reinitLazyLoad` par une
  version qui ne dépend d'aucun plugin. Lecture directe de
  l'attribut `data-original` (la convention legacy jQuery.lazyload
  qu'utilise ZOneTheme — confirmé via grep sur
  `modules/zoneslideshow/.../banners.tpl`) et swap manuel dans
  `img.src`. Retire la classe `js-lazy` après swap pour idempotence.

  Conséquence : les images des pages produits, fiches catégorie, et
  toute autre page qui utilise `img.js-lazy` se chargent maintenant
  immédiatement après chaque swap Swup, sans dépendre de la présence
  du plugin externe.

### Telemetry

`orp:preset:invoked` continue de rapporter `lazyImages=N`. Cette fois
c'est le compteur réel d'images dont on a swappé `data-original` →
`src` à cette nav, donc tu devrais voir des valeurs > 0 sur les pages
qui utilisent des images lazy.

### Note sur les erreurs `setControlsSize`

Le log v2.4.12 montrait aussi du spam `Uncaught TypeError: Cannot
read properties of undefined (reading 'setControlsSize')` sur les
fiches produit. C'est jQuery elevateZoom (le zoom sur image produit)
qui ne se ré-initialise pas après un swap. Pas critique pour le
rendu de la page (juste le zoom au survol qui ne marche plus, mais
l'image elle-même s'affiche). À traiter dans une prochaine itération
si besoin.

## [2.4.12] — 2026-04-29

### Fixed

- **Bouton play encore décalé verticalement sur certains breakpoints
  (iPhone 12 simulé, etc.) malgré le `align-self: center` de v2.4.11.**
  Lecture directe du source ZOneTheme
  (`_dev/css/components/products.scss` lignes 880-889) montre que
  `.add-to-cart` reçoit `margin-top: 10px` dans le contexte
  `.pg-bnl .product-list .grid .product-miniature .buttons-sections`
  — donc la grille en mode listing sur certaines pages. Le margin
  s'applique au bouton panier mais pas à mon bouton play, d'où le
  décalage de 10 px exactement.

  Plutôt que dupliquer le sélecteur ZOneTheme (fragile face aux
  futures mises à jour du thème), `buildInlineButton` lit maintenant
  via `window.getComputedStyle(cartBtn).marginTop` la valeur calculée
  du bouton panier voisin et l'applique en inline style sur le bouton
  play. Résultat : alignement parfait quel que soit le breakpoint /
  contexte / version ZOneTheme. La copie n'a lieu que si le bouton
  panier a effectivement un margin-top non-nul, pour ne pas pousser
  notre bouton vers le bas dans les contextes qui n'en ont pas besoin.

## [2.4.11] — 2026-04-29

### Fixed

- **Bouton play "Écouter" décalé verticalement par rapport au bouton
  panier sur certains breakpoints responsive.** Le wrapper qui contient
  les deux boutons (`.buttons-sections` chez ZOneTheme) est un flex
  container qui sur certains viewports utilise `align-items: flex-start`,
  ce qui collait notre bouton au top tandis que le bouton panier (qui
  a son propre `align-self`) restait centré → décalage vertical.

  Fix : ajout de `align-self: center` et `flex: 0 0 auto` sur
  `.orp-play-btn-inline` pour forcer le centrage vertical en flex
  parent quel que soit le `align-items` du wrapper. Sans impact sur les
  contextes non-flex (le `align-self` est juste ignoré).

## [2.4.10] — 2026-04-29

### Fixed

- **Pages produits / catégories apparaissent vides après navigation
  Swup.** L'opérateur a confirmé qu'un `Ctrl+F5` ré-affiche correctement
  la page : le contenu serveur est bon, c'est l'init JS qui manque
  après le swap. ZOneTheme branche jQuery.lazyload sur `img.js-lazy`
  une seule fois dans son `$(window).on('load', ...)` handler de
  `_aonethememanager.js` (avec setTimeout 1000ms). Sur une fiche
  produit, **tout le bloc détail** (cover, galerie, produits liés)
  utilise des placeholders `js-lazy` qui ne se déclenchent jamais
  après un swap → la page paraît vide.

  Fix : nouvelle fonction `reinitLazyLoad($)` dans le preset zonetheme
  qui ré-attache `$('img.js-lazy').lazyload({...})` après chaque
  `content:replace` avec exactement les mêmes options que
  ZOneTheme. Idempotent (les images déjà chargées perdent leur classe
  `js-lazy` via le callback `load`). Trigger immédiat de `'appear'`
  sur les images visibles dans le viewport pour qu'elles n'attendent
  pas un scroll.

### Telemetry

L'event `orp:preset:invoked` rapporte maintenant `lazyImages: N`,
le nombre d'images `img.js-lazy` qui ont été (ré-)attachées au plugin
sur cette navigation.

## [2.4.9] — 2026-04-28

### Fixed

- **Megamenu dropdowns empty on hover after Swup navigation.** ZOneTheme
  defers the actual dropdown HTML to a single AJAX call inside its
  `$(window).on('load', ...)` handler in `_aonemegamenu.js`:
  `ajaxLoadDrodownContent()` fetches `varMenuDropdownContentController`
  and replaces every `.js-dropdown-content` placeholder with the loaded
  markup. Window.load doesn't fire on Swup swaps, so on every navigated-
  to page, hovering a megamenu category opened an empty dropdown. The
  v2.4.8 monitor capture confirmed it: the user reported "quand je
  survole une catégorie, le dropdown ne s'ouvre pas" right after the
  visual-color fix landed.

  Fix: `reinitAjaxMegamenuContent()` re-implements the AJAX call inline
  in the preset. Idempotent (skips if no `.js-dropdown-content`
  placeholders remain in the DOM), gated on
  `varMenuDropdownContentController` being defined globally (which it
  is, via the inline `<script>` ZOneTheme renders — preserved across
  Swup swaps by `SwupScriptsPlugin`'s re-execution of inline scripts).

  After the placeholders are replaced, `updateMegamenuDropdownPosition()`
  re-runs ZOneTheme's `newUpdateDropdownPosition` /
  `newUpdateDropdownPositionRTL` math to keep each `.adropdown` aligned
  inside the megamenu's horizontal bounds. Both LTR and RTL layouts
  handled per the original source.

### Telemetry

The `orp:preset:invoked` event now reports `megamenuAjax: 1` when the
AJAX fetch was fired (placeholders existed AND the controller URL was
known) or `0` when skipped. The 0 case typically means the destination
page didn't have a megamenu (CMS / contact / etc.) or the dropdowns
are already populated from a previous run on this page.

## [2.4.8] — 2026-04-28

### Fixed

- **Theme custom colours wiped on every Swup swap (header noir →
  blanc, megamenu hover broken).** ZOneTheme renders an inline
  `<style>` tag in `<head>` from its BO color settings (template
  `_partials/stylesheets.tpl`, fed by `$stylesheets.inline`). The
  `SwupHeadPlugin` we configured with no options was running its
  default diff algorithm, which removed that `<style>` because it
  doesn't always re-serialise to identical `outerHTML` between two
  Smarty renders even when the content is logically the same. Symptom:
  the v2.4.7 monitor capture showed `inlineStyleTags: "3" -> "2"` on
  every navigation, exactly matching the visual breakage the operator
  reported (color inversion, megamenu cassé, etc.).

  Fix: pass `persistAssets: true` to `SwupHeadPlugin`. Per the plugin
  source, that auto-enables `persistTags:
  "link[rel=stylesheet], script[src], style"` — meaning every
  stylesheet link, every script-src, and every inline `<style>` in
  `<head>` is preserved across navigations regardless of what the
  destination's `<head>` contains.

  This is a safer default for any PrestaShop deployment, not just
  ZOneTheme: per-page CSS variations are uncommon, while shop-wide
  theme styles are universal — so persisting all of them avoids a
  whole class of silent regressions.

## [2.4.7] — 2026-04-28

### Fixed

- **"CLÉ DE SÉCURITÉ INVALIDE" page when clicking "Vider le log" or
  "Télécharger le log" in the BO Diagnostic panel.** The forms posted to
  `getAdminLink('AdminModules', false)` — second arg `false` skips
  appending PrestaShop's admin CSRF token. Without it, PS's anti-CSRF
  middleware rejects the POST. Switched both clear-log and download-log
  forms to `getAdminLink('AdminModules', true)` so the token is in the
  action URL.

### Validation

The v2.4.6 monitor capture from 22:56:51 onwards confirmed the contact-
page Swup-skip fix works in production: every navigation to
`/fr/nous-contacter` triggers `orp:swup:skipped-on-excluded-page`, and
subsequent navigations away land on a clean fully-rendered page (no
more catastrophic state). Also confirmed: the home-block slider
re-init on Swup return to `/fr/` (`homeBlockSliders=7`,
`sliders: "0" -> "7"` in dom:diff).

## [2.4.6] — 2026-04-28

The v2.4.5 monitor capture (with screenshot of a hollowed-out page)
proved two things:
1. The catastrophic state on `/fr/nous-contacter -> /fr/` is real and
   reproducible. `htmlClasses: "swup-enabled" -> ""` confirmed.
2. The v2.4.5 deferred-detector did NOT fire (no
   `orp:catastrophic-swap-recovered` in the log). The class was still
   present at the moment our hook ran inline; some later plugin in
   Swup's chain wipes it AFTER our hook executes.

### Fixed — primary fix: skip Swup init on excluded pages

`initSwup()` now self-checks the CURRENT URL against the exclusion list
(`shouldExcludeFromSwup(window.location.href)`) and bails early if the
current page is excluded. The previous logic only filtered OUTGOING
links via Swup's `ignoreVisit`; nothing prevented Swup from initialising
on an excluded page after a full reload landed there.

Concretely: when the user lands on `/fr/nous-contacter` (full reload via
the existing `contact` exclusion), Swup is no longer initialised.
Subsequent clicks (e.g., the OnlyRoots logo back to home) are normal
`<a>` navigations — full reloads, audio briefly pauses then resumes from
localStorage. No more half-swapped, hollowed-out home page.

Telemetry: `orp:swup:skipped-on-excluded-page` event when the skip
fires.

### Improved — safety-net detector now runs deferred

The `content:replace` catastrophic detector moved into a
`setTimeout(fn, 0)` so it runs after every other content:replace hook
(including whichever Swup plugin actually wipes `swup-enabled` on the
catastrophic path). The recovery (`window.location.assign(destUrl)`)
fires from there.

This is the safety net — the primary fix above prevents the catastrophe
from being triggered in the first place. The deferred detector catches
any OTHER fragile page we haven't listed in the static exclusion array
yet.

### Backwards compatibility

No breaking change. Operators who already rely on the contact / sitemap
/ stores exclusions added in 2.4.3 see strictly improved behaviour:
those pages no longer half-swap on departure.

## [2.4.5] — 2026-04-28

### Fixed

- **Catastrophic-swap detector now uses the right signal.** The v2.4.4
  detector checked `!document.querySelector('header, #header')`. In the
  v2.4.4 production capture on `/fr/nous-contacter -> /fr/`, that
  selector still matched somewhere in the broken page (likely a hidden
  cart sidebar header or a modal template), so the detector was
  false-negative and the recovery never fired — the user kept seeing the
  hollowed-out page.

  Replaced with a single, unambiguous check:
  `document.documentElement.classList.contains('swup-enabled')`. Swup
  adds that class to `<html>` at init; if it's gone after a swap, the
  swap removed `<html>`'s own attributes — exactly what the v2.4.3
  monitor captured (`htmlClasses: "swup-enabled" -> ""`). When that
  happens, `window.location.assign(visit.to.url)` recovers via full
  reload. Surfaces as `orp:catastrophic-swap-recovered missing=
  swup-enabled-class-on-html` in the monitor.

## [2.4.4] — 2026-04-27

Two follow-up fixes informed by the v2.4.3 monitor capture:
- `homeBlockSliders=7 sliders: "0" -> "7"` confirmed the slider re-init
  works when navigating back to home via Swup. Main bug solved.
- A leftover catastrophic swap was still happening when departing from
  `/fr/nous-contacter` (added to bypass list in 2.4.3, but the bypass
  only covers links *to* the contact page — links *from* it still went
  through Swup with a misresolved container).
- Hero NivoSlider on `#aoneSlider` reports `aoneSlider=0` consistently;
  this is expected, not a bug — the hero block sits outside Swup's
  swap container and stays alive across navigations (autoplay
  continues, no re-init needed).

### Fixed

- **Catastrophic swap recovery.** The `content:replace` Swup hook now
  detects when a swap left the page without a `<header>` element. When
  it does, the module bails to a full reload of the destination URL via
  `window.location.assign(visit.to.url)` instead of letting the user
  see a half-rendered page (no header, no footer, no megamenu, no
  inline styles — exactly the state captured in the v2.4.3 monitor for
  `/fr/nous-contacter -> /fr/`). Surfaces as
  `orp:catastrophic-swap-recovered` in the monitor log so we can track
  which URL pairs trigger the recovery.

### Improved

- **Persistent body class capture is now continuous.** v2.4.1 captured
  the persistent classes (`country-fr`, `lang-fr`, `currency-eur` etc.)
  once at init. If the user landed on a category page (which strips
  these classes on ZOneTheme), the cached set was empty and restoration
  did nothing on subsequent swaps. The new
  `topUpPersistentBodyClasses()` runs after every `content:replace` and
  unions any new persistent classes seen on the post-swap body into the
  cached set. Once the user visits a "complete" page (home, product),
  the cache is populated for all subsequent navigations.

### Telemetry

New event type `orp:catastrophic-swap-recovered` whitelisted in
`controllers/front/monitor.php`. Each occurrence logs the destination
URL and which landmark was missing (`header` for now; future versions
may detect missing footer/megamenu/sticky individually).

### Known limitation (not a bug)

The hero slider (`#aoneSlider`, jQuery NivoSlider) does not get
re-initialised after a Swup return to home. This is intentional — the
slider element is in a hook block placed outside Swup's swap container
on most ZOneTheme deployments, so the original slider stays alive
across navigations and autoplay continues unchanged. The
`aoneSlider=0` count in `orp:preset:invoked` reflects this: the preset
correctly skips the slider when it sees the existing `.nivoSlider`
class.

## [2.4.3] — 2026-04-27

### Fixed

- **Contact / sitemap / stores pages now bypass Swup by default.** The
  v2.4.2 monitor capture on OnlyRoots Reggae proved `/fr/nous-contacter`
  triggered a catastrophic swap: `<html>` lost all classes, the header
  and footer disappeared, the megamenu went from 6 items to 0, every
  inline `<style>` was wiped. The contact page template diverges enough
  from the standard layout that Swup's container resolution lands on
  the wrong element and effectively hollows out the page.

  `contact`, `sitemap`, and `stores` are now listed in the standard
  PrestaShop pages that bypass Swup (alongside `cart`, `order`,
  `authentication`, etc.). The exclusion uses `Link::getPageLink()` so
  it adapts to the shop's language and friendly URL settings — `/fr/
  nous-contacter`, `/en/contact-us`, `/de/kontakt`, all caught
  automatically. Operators no longer need to add these manually to
  `ORP_EXTRA_EXCLUDES`.

### Backwards compatibility

No breaking change. Operators who already added `/nous-contacter` (or
similar) to their `ORP_EXTRA_EXCLUDES` setting can leave it there — the
two lists are merged and deduplicated by `getSwupExcludePaths()`.

## [2.4.2] — 2026-04-27

Calibrated against the actual ZOneTheme v2.7.3 source archive (provided
by the operator on `main`). The v2.4.1 monitor log proved beyond doubt
that ZOneTheme's `_dev/js/aone/*.js` modules are bundled via webpack —
each module wraps top-level function declarations in its own IIFE, so
none of `stickyHeader`, `mobileToggleEvent`, `setCurrentMenuItem`,
`productHomeFeatured` etc. ever reach `window`. All 17 attempted name
matches came back `fnsMissing` with `slickInit=0`.

### Replaced — `views/js/themes/zonetheme.js` rewritten end-to-end

The preset no longer tries to call ZOneTheme functions by name. Instead,
it re-implements their bodies directly, using the same selectors and
same data attributes ZOneTheme uses. Verified against the unminified
sources in the operator-provided archive.

#### Sliders (4 ZOneTheme types now re-initialised)

- **`#aoneSlider`** (NivoSlider). Reads `data-settings`, calls
  `$.fn.nivoSlider({...})` with the full option set from
  `_aoneslideshow.js`.
- **`.js-home-block-slider`** (Slick — "Derniers arrivages",
  "Nouveautés", "Onlyroots Records"). Reads `data-slickoptions`, calls
  `$.fn.slick({...})` with all the responsive breakpoints from
  `_aonehomeblocks.js`. Re-binds the `beforeChange → appear` lazy-image
  trigger on each slider.
- **`.js-brand-logo-slider`** (Slick). Hardcoded breakpoints from
  `_aonebrandlogo.js`, `data-autoscroll` for the autoplay flag, RTL
  detected from `prestashop.language.is_rtl`.
- **`.js-featured-categories-slider`** (Slick). `data-slidestoshow`
  drives the responsive options from `_aonefeaturedcategories.js`.

All four are idempotent: the Slick ones use `:not(.slick-initialized)`,
and NivoSlider checks the `nivoslider` data flag and the auto-added
`.nivoSlider` class.

#### Bootstrap tab → slick setPosition

`a[data-bs-toggle="tab"]` listener re-bound on every preset run,
namespaced as `shown.bs.tab.orpZoneTheme` so the previous binding is
removed before the new one is attached (no listener doubling). Inside
the shown tab we trigger `slick('setPosition')` so a slider that was
created in a hidden panel measures itself correctly.

#### Sticky header

`reinitStickyHeader()` calls `$.fn.sticky` on
`.desktop-header-version [data-sticky-menu]` and
`.mobile-header-version [data-mobile-sticky]` with the wrapper class
names ZOneTheme expects. Sticky-cart preview is repopulated from
`[data-header-cart-source]`.

#### Megamenu

- `rebindMobileMegamenu`: click toggle on
  `#mobile-amegamenu .amenu-item.plex > .amenu-link`, slide-toggle the
  `.adropdown` sibling, manage the `expanded` class.
- `rebindTabletHoverMegamenu`: touchstart handlers on `<html>`,
  `#amegamenu`, and `#amegamenu .amenu-item.plex > .amenu-link`.
- `markCurrentMenuItem`: reads `window.varBreadcrumbLinks` and adds
  `curr-menu` class on the matching menu item.

#### Sidebars (left nav + cart preview)

`rebindSidebars` re-installs `[data-left-nav-trigger]`,
`[data-close-st-menu]`, `[data-sidebar-cart-trigger]`,
`[data-close-st-cart]` click handlers, gated by `[data-st-menu]` and
`[data-st-cart]` presence respectively.

#### Scroll-to-top

`rebindScrollToTop` re-binds the click handler on
`[data-scroll-to-top] a` to `$.smoothScroll` (with a vanilla `animate`
fallback if smoothScroll isn't available).

### Telemetry

The `orp:preset:invoked` event now reports per-component counts:
`aoneSlider`, `homeBlockSliders`, `brandSliders`, `featuredSliders`,
`stickyHeader`, `rtl`. If any go to 0 unexpectedly after a future
ZOneTheme update, the operator (and we) immediately see which selector
broke.

### Removed

- The dead-end `REINIT_FUNCTIONS` list (17 names that were always
  missing from `window` because of webpack scoping).
- The generic `reinitSliders` that probed `[data-slick]` /
  `.slick-slider` / `.owl-carousel` / `.swiper` selectors none of
  which ZOneTheme uses.

### Backwards compatibility

No breaking change. Operators on the `zonetheme` preset get a
substantially better experience. Operators on `none` see no change.

## [2.4.1] — 2026-04-27

First fix iteration informed by real diagnostic data captured via the
v2.4.0 monitor on OnlyRoots Reggae production. The monitor log showed:
sliders going from 7 (initial) to 0 (after Swup return), sticky-wrapper
count dropping from 1 to 0 on every swap, and `country-fr lang-fr
currency-eur` body classes being wiped on category page navigations.

### Fixed

- **Sliders not re-initialised after Swup return.** The ZOneTheme preset
  now ships a generic slider re-init step (`reinitSliders`) that probes
  Slick (`$.fn.slick`), Owl Carousel (`$.fn.owlCarousel`) and Swiper
  (`window.Swiper`), and re-initialises any slider element that lost its
  initialised state during the swap. Idempotent — already-initialised
  carousels are skipped via `slick-initialized` / `owl-loaded` /
  `element.swiper` guards.
- **Persistent body classes restored after each Swup swap.** Player core
  now captures `body` classes matching `^country-`, `^currency-`,
  `^lang-`, `^is-customer-`, `^no-customer-` at init time, and re-adds
  any of them missing after `content:replace`. This compensates for
  `SwupBodyClassPlugin`'s wholesale class replacement combined with
  category-page templates that omit those globals on ZOneTheme. Likely
  fix for the "couleurs noir/blanc inversées" symptom.

### Added — preset telemetry

The ZOneTheme preset now reports its own execution to the monitor log:
which reinit functions were found in `window` (so re-invoked) vs.
missing (likely renamed in a future ZOneTheme update), how many sliders
each library re-initialised, and which functions threw. Surfaces as
`orp:preset:invoked` events in `var/monitor.log`.

When the monitor sees `orp:body-class-restored` events, the operator
knows the body-class compensation kicked in for that swap.

### Extended ZOneTheme preset reinit list

Added likely slider init function names that ZOneTheme may expose as
globals: `productHomeFeatured`, `homeSliderTabs`, `lazyloadHomeSliders`,
`productSlider`, `initSlick`, `initSliders`, `reinitSliders`. Each is
gated by `typeof === 'function'` so a missing one is a silent no-op
that surfaces as a `fnsMissing` entry in the next preset:invoked event.

### Backwards compatibility

No breaking change. Same surface area as 2.4.0; this release strictly
adds reinit code paths and telemetry events.

### How to verify the fixes worked

1. Operate the site with `monitorEnabled = 1` and `themePreset = zonetheme`.
2. Reproduce the same navigation pattern as the v2.4.0 capture.
3. The new `var/monitor.log` should show:
   - `orp:preset:invoked` after every swap, with `slickInit > 0` / `owlInit
     > 0` / `swiperInit > 0` if sliders were re-initialised.
   - `dom:diff` should no longer report `sliders: 7 -> 0` losses (the
     post-swap snapshot reflects the just-re-initialised sliders).
   - `orp:body-class-restored` whenever the persistent classes had to
     be re-added — logs which classes each time.
   - If `fnsMissing` includes a slider-related name, ZOneTheme exposes
     its slider init under a different identifier; report it back so we
     can extend the preset.

## [2.4.0] — 2026-04-27

### Added — diagnostic monitor

A purpose-built telemetry layer designed to break the cycle of
"investigation au pifomètre" we've been stuck in. New BO toggle
`ORP_MONITOR_ENABLED` (off by default). When activated, the module:

- Loads a standalone `views/js/monitor.js` BEFORE `player.js`. The
  monitor captures:
  - Global JS errors (`window.onerror`)
  - Unhandled promise rejections (`window.unhandledrejection`)
  - Swup lifecycle events: `visit:start`, `content:replace`, `visit:end`,
    `visit:abort`, `fetch:error`
  - DOM snapshots before/after each `content:replace`, with diffs on:
    `<body>` classes, `<html>` classes, `<body>`/`<html>` datasets, header
    and footer presence, sticky-wrapper count, megamenu item count,
    product miniature count, slider count, image-load ratio, inline
    `<style>` tag count.
  - Theme preset failures (e.g. `prestashop.on is not a function` from
    the legacy `$(window).trigger('load')` snippet) surface as
    `orp:preset:error` events.
- POSTs events in batches via `navigator.sendBeacon` (with `fetch`
  fallback) to a new front controller `controllers/front/monitor.php`
  that:
  - Accepts only POST.
  - Enforces same-origin via the `Origin`/`Referer` header.
  - Rate-limits via the visitor's session: max 30 events / 60 seconds.
  - Caps each event line at 4096 bytes.
  - Validates event types against a whitelist; everything else dropped.
  - Strips control characters and caps each value at 512 chars before
    writing.
  - Writes to `var/monitor.log` inside the module directory, with
    automatic rotation when the file passes 1 MiB (keeps the last 512
    KiB plus a `[rotated …]` marker).
- Surfaces the log in the BO configuration page: a new "Diagnostic"
  panel above the configuration form shows the latest log entries in a
  scrollable monospace block, with **Vider le log** and
  **Télécharger le log** buttons. The panel is always visible (operators
  can read past captures even after disabling the monitor).

### Privacy

The monitor never logs query strings, cookies, headers, form data, or
any value outside its predefined snapshot schema. URLs are reduced to
path-only before transmission.

### How to use

1. BO → OnlyRoots Player → Configurer → set **Moniteur diagnostique** to
   `Activé`, save, vider le cache PS.
2. Reproduce the bug in browser (the home, a navigation, etc.). Wait a
   few seconds for the batched POST to flush (or simply close the tab —
   the buffer is flushed on `pagehide`).
3. Reload the BO config page. The "Diagnostic" panel above the form
   now shows the captured events. Click **Télécharger le log** to grab
   the file as an attachment for further analysis.
4. When done, switch the toggle off and **Vider le log**.

### Files added

- `controllers/front/monitor.php` — POST receiver, ~280 lines.
- `views/js/monitor.js` — front-end capture, ~250 lines.
- `var/index.php` — anti-listing, log lives in `var/monitor.log`.

### Backwards compatibility

Off by default — installs upgrading from 2.3.2 see no change in
behaviour until they flip the toggle.

## [2.3.2] — 2026-04-27

### Fixed
- **Production breakage on fresh 2.3.1 installs.** The 2.3.1 default of
  `themePreset = 'zonetheme'` caused a hard breakage on the OnlyRoots
  Reggae homepage (empty product sliders, missing images, broken layout)
  on fresh installs. Default reverted to `none` until a confirmed root
  cause is identified in staging. Operators on ZOneTheme switch the
  dropdown to `zonetheme` manually after validating in staging with the
  F12 console open.

### Honest note on the root cause

We do **not** yet know why a freshly-loaded `views/js/themes/zonetheme.js`
breaks the initial home page in production. Code inspection (verified by
grep) shows the preset function is called only inside the Swup
`content:replace` hook in `player.js` — never at initial load. The file
itself is a side-effect-free IIFE that just attaches a function to
`window.orpThemePresets.zonetheme`. So on paper, loading the file alone
should not break anything.

The empirical fact remains: enabling the preset on production breaks the
home. Until that paradox is reconciled (CCC bundling artefact? script
load-order conflict? actual bug in the reinit code path even when called
correctly?), the safe path is `none` by default.

### Defensive: context guard

To rule out the (unlikely) possibility that something else on the page
invokes the preset accidentally, the preset now requires an explicit
context argument:

```js
window.orpThemePresets.zonetheme({ trigger: 'swup-content-replace' });
```

Calls without that exact context object are silently no-op'd with a
`console.warn`. `player.js` has been updated to pass the context
explicitly. This is belt-and-suspenders — not a confirmed fix.

### Migration notes
- Fresh 2.3.2 installs: preset = `none` (safe). Operators enable
  `zonetheme` in BO after staging validation.
- Existing 2.3.1 installs that had the production breakage: switch to
  `none` manually in BO until the root cause is confirmed.

## [2.3.1] - 2026-04-27

### Changed
- Default theme preset is now `zonetheme` instead of `none`. The module is
  shipped primarily for OnlyRoots Reggae (ZOneTheme), so the most common
  installation no longer requires a manual BO configuration step. Operators
  on a different theme can switch back to `none` (or another preset) via
  the BO configuration panel as before.

### Migration notes
- Fresh installations: ZOneTheme reinit kicks in automatically.
- Existing 2.3.0 installations: the previously stored value is preserved
  (the install upsert only writes defaults for missing keys), so no surprise
  for production sites already configured.

## [2.3.0] — 2026-04-27

### Added

- **Theme reinit presets**, replacing the unmaintained pasted-snippet
  workflow that lived in the BO textarea. New BO dropdown
  `Preset de réinit thème` (`ORP_THEME_PRESET`) ships with two values
  out of the box:
  - `none` (default) — pure theme-agnostic, nothing runs after a swap.
    Existing installs upgrade in place to this value.
  - `zonetheme` — bundled snippet calibrated for ZOneTheme on
    OnlyRoots Reggae. Cleans up duplicate listeners on amegamenu (desktop
    + mobile), left/right sidebars, scroll-to-top, and sticky header
    wrappers; then re-invokes the 10 theme functions that ZOneTheme
    attaches to `$(window).on('load', ...)` (`handleCookieMessage`,
    `stickyHeader`, `scrollToTopButton`, `loadSidebarNavigation`,
    `loadSidebarCart`, `lazyItemMobileSliderScroll`,
    `ajaxLoadDrodownContent`, `mobileToggleEvent`,
    `enableHoverMenuOnTablet`, `setCurrentMenuItem`) **by name**, NOT by
    re-firing `$(window).trigger('load')`.
- **`views/js/themes/zonetheme.js`** — versioned, code-reviewable,
  testable replacement for the pasted snippet. The file registers
  `window.orpThemePresets.zonetheme` on load but does not run anything
  on its own; player.js invokes it from the `content:replace` Swup hook.

### Fixed

- **`prestashop.on is not a function` crash** that fired on every Swup
  navigation when the previous BO snippet ended with
  `$(window).trigger('load')`. Re-firing the load event woke up every
  module's load handler — Google Analytics, vatnumbercleaner,
  zonemegamenu, etc. — and several of them call `prestashop.on(...)`,
  which throws after a swap because PrestaShop's inline
  `var prestashop = {...}` script gets re-executed and clobbers the live
  prestashop object. The new ZOneTheme preset never calls
  `$(window).trigger('load')`; it invokes only the specific theme
  functions, leaving foreign modules alone.
- The same change incidentally stops the cascade of duplicate
  `module/vatnumbercleaner/vncfc` and Google Analytics XHRs that were
  firing on every swap.

### Changed

- The "JS personnalisé après swap Swup" textarea is no longer the
  primary integration path. Its description has been updated to
  "additional JS that runs AFTER the theme preset" so operators
  understand the order of execution.
- The `content:replace` hook now runs presets in this order:
  `scheduleInject` → `prestashop.emit('updatedProductList', ...)` →
  `initProductPage` → **theme preset (if any)** → **postSwapJs textarea
  (if any)** → adaptive watchdog measurement.

### Backwards compatibility

No breaking change.
- Existing 2.2.x installs upgrade to `themePreset = 'none'` so the swap
  pipeline is byte-identical to before the upgrade.
- Operators who pasted the legacy `$(window).trigger('load')` snippet
  into the textarea: switch the dropdown to `ZOneTheme` and **delete
  the textarea content**. Failing to clear the textarea will run both
  the bundled preset AND the legacy snippet, which re-introduces the
  prestashop crash.

### Adding new presets

`views/js/themes/<presetname>.js` should attach a function to
`window.orpThemePresets[presetname]` and do nothing else on load.
Register the preset name in
`OnlyRootsPlayer::VALID_THEME_PRESETS` and add an option to the BO
select in `renderForm()`. The PHP side already wires the file load
based on the selected preset — no additional plumbing needed.

## [2.2.2] — 2026-04-27

### Fixed

- **BO configuration page now displays in French unconditionally.** v2.1.0
  migrated all user-facing strings to English source keys with French XLF
  translations under `translations/fr-FR/`. On some PrestaShop installs the
  XLF cache failed to refresh after the module install, leaving the BO page
  in English on a French shop. The strings have been reverted to French
  source so display is independent of the XLF loader.

### Removed

- `translations/fr-FR/ModulesOnlyrootsplayerAdmin.xlf`
- `translations/fr-FR/ModulesOnlyrootsplayerShop.xlf`
- The `translations/` directory (now obsolete since FR is the source).

### Note for future English support

If an English target is needed later, create
`translations/en-US/ModulesOnlyrootsplayerAdmin.xlf` and
`ModulesOnlyrootsplayerShop.xlf` with `source-language="fr-FR"` and
`target-language="en-US"`, mapping the French source strings used in
`onlyrootsplayer.php` and `views/templates/hook/player-footer.tpl` to
their English equivalents. The `Modules.Onlyrootsplayer.{Admin,Shop}`
translation domains are preserved so the wiring already works.

## [2.2.1] — 2026-04-27

### Fixed

- **`prestashop.emit('updatedProduct', {})` removed from the `content:replace`
  hook.** Several third-party modules subscribe to that event and crash when
  the payload is empty (they expect a `reason` field and dereference it
  without a guard). On a Swup navigation we have no relevant payload to
  emit, so the call is dropped entirely.

### Changed

- **`updatedProductList` now emits a `reason` payload.** The single emit on
  `content:replace` now passes `{ reason: 'orp:swup-navigation' }` so listeners
  can distinguish a SPA navigation from an in-page faceted-search update.
- **`runPostSwapJs()` helper inlined** into the `content:replace` hook to
  match the canonical implementation. Behaviour is unchanged: still uses
  `new Function(CONFIG.postSwapJs)()`, still wrapped in try/catch with a
  `console.warn` on failure.

### Backwards compatibility

No breaking change. The dropped `updatedProduct` emit only ever fired with
an empty payload, which was useless to consumers; modules that were already
crashing on it are now fixed. Modules that listened legitimately would have
received `{}` and learned nothing actionable.

## [2.2.0] — 2026-04-27

### Added

- **"Custom JS after Swup swap" hook (`ORP_POST_SWAP_JS`).** A new BO textarea
  (`Modules → OnlyRoots Player → Configure → Custom JS after Swup swap`)
  accepts an arbitrary JS snippet that runs after every successful SPA swap.
  Designed for theme-specific reinit code that doesn't survive a fetch + DOM
  replace — megamenus, sticky headers, swipers, accordions, etc. The snippet
  executes via `new Function(code).call(window)` (no eval, no closure leak,
  full access to globals like `jQuery`, `prestashop`, `Swiper`) and is
  wrapped in a try/catch that logs to `console.warn` so a buggy snippet
  cannot break the player.
  *Files:* `onlyrootsplayer.php` (constant, install/uninstall, postProcess,
  BO field, header config exposure), `views/js/player.js` (`runPostSwapJs`
  helper called inside the `content:replace` hook).

### Notes

- The hook executes **before** the adaptive watchdog measurement block, so
  the runtime of operator-supplied reinit work is included in the swap
  duration. Themes that need a slow reinit get a proportionally larger
  watchdog window (capped at `--watchdogMaxMs`, default 5000 ms).
- New admin XLF trans-units: `Custom JS after Swup swap` + its description.

### Backwards compatibility

No breaking change. Existing 2.1.x installs upgrade in place; the new config
key `ORP_POST_SWAP_JS` defaults to an empty string, so behaviour is
identical until an operator pastes a snippet into the BO.

## [2.1.1] — 2026-04-27

### Changed

- **Inline "Listen" button restyled to match the ZOneTheme cart button.** The
  defaults shipped in `views/css/player.css` now reproduce the visual the
  client validated on OnlyRoots Reggae:
  - `--orp-btn-size: 42px` (was 38px) — same square as the cart button
  - `--orp-btn-bg: #a3a2a2` (new var) — neutral grey idle background
  - `--orp-btn-bg-hover: #868686` (new var)
  - `--orp-btn-radius: 6px` (unchanged)
  - 1 px translucent white border + soft drop shadow — identical chrome to
    the theme's cart button
  - Inner icon bumped from 14×14 to **18×18 px** (both play and pause)
- **"Now playing" state** now uses a dedicated reggae green
  (`--orp-playing-bg: #3f6e51`, `--orp-playing-bg-hover: #335a42`) instead of
  the orange/gold accent. Makes the playing state unambiguous against the
  grey idle state, and keeps the orange accent reserved for the footer
  player chrome.

### Theme-portability note

The new defaults target ZOneTheme. Every value is exposed as a `:root` CSS
variable, so any other theme can override the look without editing module
files — drop something like this in a theme stylesheet:

```css
:root {
    --orp-btn-bg: #000;
    --orp-btn-bg-hover: #333;
    --orp-playing-bg: #c00;
    --orp-btn-size: 38px;
}
```

A header comment block at the top of `player.css` documents this.

### Backwards compatibility

Pure CSS change. No PHP, JS, hook, config-key or template change. Existing
2.1.0 installs upgrade in place; the only visible difference is the inline
button rendering.

## [2.1.0] — 2026-04-25

### Added

- **Smart Swup container resolution.** When multiple comma-separated container
  selectors are configured, the runtime now picks the first one that exists
  AND contains at least one product card (per `productSelectors`). This fixes
  cases where `#content` matched but pointed to an empty wrapper above the
  actual listing. Falls back to "first existing" if no selector contains
  product cards (e.g. CMS pages).
  *File:* `views/js/player.js` (`resolveSwupContainer`).
- **Per-card anchor selector iteration.** `buttonAnchor` now honours
  comma-separated priority order — each selector is tried in order against the
  product card, first match wins. Previously the first selector matching
  anywhere in DOM order won, which could place buttons in unexpected locations
  on themes whose anchor structure varies between cards.
  *File:* `views/js/player.js` (`findButtonAnchor`).
- **Adaptive watchdog timeout.** New BO setting `ORP_WATCHDOG_MS` (default
  1500, range 500–5000). The runtime now also measures the duration of the
  first successful Swup swap; if that swap took > 1000 ms, the watchdog window
  is bumped to `min(duration × 2, 5000)` ms for the rest of the session and
  cached in `sessionStorage["orp_watchdog_ms"]`. Slow shops no longer get
  false-positive full-reload watchdog triggers.
  *Files:* `onlyrootsplayer.php` (config var + BO field),
  `views/js/player.js` (`getWatchdogMs`, watchdog adaptation in
  `content:replace` and `visit:start`).
- **Audio cache invalidation.** Four new hook handlers — three on the Papp
  ObjectModel lifecycle (`actionObjectPappAudioPlaylist{Add,Update,Delete}After`)
  and one safety net on `actionAdminControllerInitAfter` — flush
  `orp_with_audio_*` cache entries whenever the Papp data changes. Adding a
  new audio file from the back-office now becomes visible immediately on
  product listings instead of waiting for the cache to expire.
  *File:* `onlyrootsplayer.php` (new `flushAudioCache` + handlers).
- **`translations/fr-FR/ModulesOnlyrootsplayerAdmin.xlf`** and
  **`ModulesOnlyrootsplayerShop.xlf`** — proper PrestaShop 8 XLIFF translation
  files. All `$this->l(...)` and `{l s='...'}` calls now use English source
  keys, with French translations served from the XLF on FR shops.
- **Console warning** when no Swup container selector matches the DOM. Always
  emitted (not gated by debug mode), so production operators see misconfigured
  selectors in the browser console immediately.

### Changed

- **`audioSourceAvailable()` is now request-cached.** A static `$cached` member
  short-circuits the `SHOW TABLES` query after the first call. Previously this
  ran on every front controller bootstrap, costing one extra round-trip on
  every page.
  *File:* `onlyrootsplayer.php`.
- **`install()` no longer overwrites existing config values.** Configuration
  defaults are only written for keys that are missing — existing 2.0.0
  installations keep all of their tuned settings on upgrade.
  *File:* `onlyrootsplayer.php`.
- **All user-facing strings migrated to English source keys** with the
  `Modules.Onlyrootsplayer.{Admin,Shop}` translation domains. Aligns with
  PrestaShop 8's recommended XLIFF workflow.
- **Module version bumped** to `2.1.0` in `config.xml`, `onlyrootsplayer.php`,
  and `views/js/player.js`.

### Backwards compatibility

No breaking changes. Specifically:

- Existing 2.0.0 configuration in the `ps_configuration` table is preserved.
  The `install()` upgrade path only writes new keys (`ORP_WATCHDOG_MS`).
- The new `getWatchdogMs()` PHP helper falls back to the default when the
  config key is missing, so shops that haven't visited the BO since the
  upgrade still get a working watchdog.
- The JS `getWatchdogMs()` helper falls back to 1500 ms if
  `CONFIG.watchdogMs` is missing — protects against stale browser caches
  serving the old `player.js` against the new PHP.
- The Smarty template still works on shops that don't have the XLF
  translations loaded yet — the English source string is rendered as-is.
