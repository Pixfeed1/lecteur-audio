# Changelog

All notable changes to OnlyRoots Persistent Audio Player are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
