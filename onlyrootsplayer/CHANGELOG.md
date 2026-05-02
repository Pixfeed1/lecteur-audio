# Changelog

## 3.0.11 — 2026-05-02

### Back-port of v2.5.10–v2.5.15 Swup hardening into the v3 base

The v3.0.10 architectural rewrite introduced the iframe player
(audio survives every navigation regardless of DOM mutations) but
the rewritten `swup-init.js` dropped every Swup hardening that the
v2.5.x patch chain had accumulated. The iframe protects audio, but
the parent page's Swup layer still goes through the same
DOM-mutation rounds as before — and operators reported the same
dropdown / language / megamenu glitches that v2.5.10–v2.5.15 had
fixed.

Re-applied the missing fixes inside `views/js/swup-init.js`. The
iframe architecture stays untouched.

### Fixed — listener stacking via `SwupScriptsPlugin` (was 2.5.10/2.5.11)

ScriptsPlugin re-runs every inline `<script>` after each swap.
PrestaShop core, ZOneTheme, and most modules embed inline scripts
that bind delegated listeners (`$(document).on(...)`,
`document.addEventListener(...)`, `prestashop.on(...)`,
`$('.js-dropdown').on('show.bs.dropdown', ...)`,
`$(window).on('load', ...)`, etc.). Each re-run stacks a new
handler without removing the previous one. After a few nav hops:
multiple handlers per click → "dropdown opens then closes",
"add-to-cart counts twice", "language flag unresponsive".

Re-applied the v2.5.11 regex that flags listener-binding inline
scripts with `data-swup-ignore-script` before each swap so
ScriptsPlugin skips them:

```
/var\s+prestashop\s*=|prestashop\.(on|emit)\(|
 \$\(\s*[^)]+\s*\)\.on\(|addEventListener\(/
```

Operator escape hatch unchanged: `data-swup-reload-script` on a
`<script>` tag forces re-execution.

### Fixed — language switcher blocked by Swup (was 2.5.7+)

ZOneTheme's `ps_languageselector` template renders language items
as `<a data-iso-code="en" href="...">`. Without exclusion, Swup's
linkSelector intercepts the click and tries to swap to the new
language URL — leaves either an empty container or a wrong-language
mash-up.

Re-applied:
- `linkSelector: 'a[href]:not([data-iso-code])...'` — Swup now
  ignores language anchors natively.
- `tagLanguageLinks()` runs at boot AND after every
  `content:replace`, flagging any anchor matching `[data-iso-code]`
  or `[href*="id_lang="]` with `data-no-swup` for belt-and-braces.
- `ignoreVisit()` returns `true` for any URL with an `id_lang`
  query param OR a different 2-letter language prefix in the path.

### Fixed — `prestashop` event emitter clobbered (was 2.0.0+)

PS pages serialize the `prestashop` config object into an inline
`<script>var prestashop = {...};</script>`. After init,
`window.prestashop` is a live EventEmitter with active listeners
from every PS module on the page. Re-running the data block from a
swapped HTML would replace the live emitter with a fresh data-only
object, killing every listener.

Re-applied `mergePrestashopData(html)`: parses the new HTML's
`var prestashop = {...}` block and merges only the pure-data keys
(`cart`, `customer`, `page`, `urls`, `breadcrumb`, `language`,
`currency`, `country`, `shop`, `field_required`, `static_token`,
`token`, `time`) into the live emitter without touching its
listeners.

### Fixed — Bootstrap dropdown unreachable on ZOneTheme (was 2.5.13)

ZOneTheme bundles Bootstrap 5 inside webpack `theme.js` and never
exposes `window.bootstrap` globally (verified in production console:
`typeof window.bootstrap === 'undefined'`). Any
`bootstrap.Dropdown.getInstance(...)` call returns `null`. After a
Swup swap, the `.show` class state is stale and Bootstrap's own
delegated handler may have lost its reference.

Re-applied the v2.5.13 strategy: a single click delegate on
`document` that drives `.show` / `aria-expanded` ourselves, using
the same class names Bootstrap would set (so the theme CSS still
works). Plus an Escape keydown listener and an outside-click
closer. Bound exactly once per session via
`window.__orpDropdownDelegateBound`. Resets visual state on every
swap to clear "phantom open" toggles.

### Fixed — Contact page slug coverage

The v3.0.10 `excluded` array hard-coded `/contactez-nous` and
`/contact-us` only. Shops with a different localized slug
(`/nous-contacter`, `/contact`) bypassed the exclusion → Swup
attempted the swap → catastrophic-swap bug returned. Added the two
missing slug forms.

### What's NOT changed in 3.0.11

The iframe architecture from v3.0.10 stays as-is: same
`controllers/front/frame.php`, same `frame-injector.tpl`, same
`bridge.js`, same `frame.tpl`. Audio still lives inside the iframe.
The fixes above only apply to the parent-side Swup layer that
governs the rest of the page.

### Migration note

In-place upgrade from 3.0.10. After installing 3.0.11:
1. Vide cache PrestaShop (BO → Avancé → Performances → Vider le cache)
2. Hard refresh front (Ctrl+Shift+R) to evict cached `swup-init.js`
3. Aucune action BO requise — la config existante est compatible

## 3.0.0 — 2026-05-02

### Full architectural rewrite

The audio engine is now isolated in a same-origin iframe. The parent
page only carries a small messenger script (`bridge.js`, ~10KB) which
communicates with the iframe via `postMessage`. This ends the
shared-realm cohabitation of v2.5.x where every theme JS bug, every
third-party AJAX module re-init, and every popstate handler in the
wild could (and did) trip the audio.

### Added

- `controllers/front/frame.php` — serves the iframe HTML page with
  appropriate cache + security headers (`X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Cache-Control: max-age=300`, `X-Robots-Tag: noindex`).
- `views/templates/front/frame.tpl` — standalone HTML document loaded
  as the iframe's `src`. Contains the player UI markup (visually
  identical to v2.5.x, same `orp-*` classes, same SVG icons, same
  `player.css`).
- `views/templates/hook/frame-injector.tpl` — inserts the `<iframe>`
  element via `displayBeforeBodyClosingTag` (very bottom of every page,
  outside the theme footer markup).
- `views/js/bridge.js` — parent-side messenger. Discovers product cards,
  injects play buttons, forwards clicks to the iframe via
  `postMessage`. Listens to Turbo navigation events and PrestaShop's
  `updateProductList` event. Includes a defensive ZOneTheme popstate
  guard (capture-phase, only fires on the specific signature).
- `views/css/bridge.css` — parent-side styling for the injected
  `.orp-card-play` button and the `#orp-frame` visibility states.
- `views/js/lib/turbo.min.js` — Hotwire Turbo 8.0.23 (~98KB minified),
  optional SPA layer. With `data-turbo-permanent` on the iframe, the
  iframe's window/document/audio survive across navigations and audio
  truly never cuts on internal links.
- New BO configuration: **Navigation Turbo (SPA)** toggle (default ON).
  When OFF, the iframe still works but reloads on every navigation;
  state is restored from `localStorage` in ~200-500ms.
- New BO configuration: **Préchargement au survol** toggle (default ON).
  Hovering a card play button warms the API cache for that product.

### Changed

- All audio-engine code (`<audio>` element, MediaSession API, progress
  bar, volume bar, queue management, persistence) now lives inside the
  iframe (`views/js/player.js`). It's never loaded into the parent
  page's JS realm.
- Player UI markup moved from the `displayFooter` hook (parent side) to
  the iframe document. Visually identical to v2.5.x — same DOM, same
  classes, same `player.css`. The only addition is a wrapping
  `<html>/<body>` and an iframe-specific style override (`position:
  absolute` instead of `position: fixed` since the iframe itself
  provides the fixed slot).
- `localStorage` key bumped from `orp_state_v1` to `orp_state_v3` —
  state from previous versions is ignored (different schema, different
  realm).
- Configuration form simplified to 8 fields (vs 14 in v2.5.x).

### Removed

- **Swup** and all Swup plugins (`swup-head-plugin`, `swup-scripts-plugin`,
  `swup-body-class-plugin`, `swup-preload-plugin`). Replaced by Turbo or
  no SPA at all (BO toggle).
- **`views/js/themes/zonetheme.js`** (~47KB). The 1000+ lines of theme
  reinit logic, syncSidebarColumns, megamenu rebuilds, AS4 patches,
  popstate killers, etc. — all gone. The iframe doesn't need any of it
  because it isn't sharing a realm with the theme.
- **Theme presets system** (`CFG_THEME_PRESET`, `views/js/themes/*`).
  Theme-agnostic by construction now.
- Configuration keys: `ORP_SWUP_ENABLED`, `ORP_SWUP_CONTAINER`,
  `ORP_SWUP_PRELOAD`, `ORP_SWUP_IP_WHITELIST`, `ORP_EXTRA_EXCLUDES`,
  `ORP_WATCHDOG_MS`, `ORP_POST_SWAP_JS`, `ORP_THEME_PRESET`,
  `ORP_INCLUDE_CONTACT`. They are deleted on uninstall; on upgrade they
  remain in the database but are unused.
- Hook registrations: `displayFooter`, `actionAdminControllerInitAfter`,
  `actionObjectPappAudioPlaylistAddAfter` (and Update/Delete). The
  data-source change hooks weren't actually used in v2.5.x.

### Bug fixes (vs v2.5.x cumulative)

This release retires the entire patch chain accumulated since v2.5.0:

- ZOneTheme popstate hijack races (v2.5.5, v2.5.7, v2.5.16) — no longer
  applicable: the iframe survives popstate.
- AS4 re-init after AJAX facets (v2.5.8) — no longer applicable: the
  audio element doesn't live in the same DOM as the AS4 markup.
- syncSidebarColumns DOM corruption (v2.5.10) — no longer applicable:
  no shared DOM.
- Contact-page exclusion (v2.5.4) — no longer applicable: the iframe
  is rendered on every page including contact, but disabled internally
  if the source product is unavailable.
- Watchdog ms tuning (v2.5.6, v2.5.13) — removed: no watchdog needed.
- Post-swap JS injection (v2.5.11) — removed: no swap to react to.

### Migration

After installing 3.0.0 over 2.5.x:

1. **Clear PS cache** (BO → Advanced → Performance → Clear cache).
2. **Hard-refresh the front-office** (Ctrl+Shift+R) to evict cached
   `player.js`.
3. Re-check BO config — old keys are gone, new defaults applied.
4. If you had custom `ORP_PRODUCT_SELECTORS` or `ORP_BUTTON_ANCHOR`,
   they are preserved (same key names). Custom `ORP_THEME_PRESET`,
   `ORP_POST_SWAP_JS`, etc. are ignored.

### Known limitations

- Audio still cuts on: login, logout, language switch, currency switch,
  payment navigation, hard reload (F5). These force a full document
  replacement that no SPA layer can prevent.
- Without Turbo, navigation reloads the iframe → ~200-500ms gap.
- iOS Safari may need two play-button taps the first time (autoplay
  policy + iframe context interaction).
