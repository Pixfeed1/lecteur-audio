# OnlyRoots Persistent Audio Player

PrestaShop 8 module that adds a persistent footer audio player and inline
play buttons on product listings. Uses [Swup](https://swup.js.org/) for SPA
navigation so audio keeps playing across pages.

**Version 2.0.0** — full rewrite for theme-agnostic deployment.

---

## Requirements

- PrestaShop 8.0.0 → 8.99.x
- The third-party module **`productaudioplaylistplugin`** must be installed
  and active (this module reads its `papp_audio_playlist` table).

---

## What's new in 2.0.0

This version replaces the OnlyRoots / ZOneTheme-specific 1.x line with a
generic module compatible with any PrestaShop 8 theme.

### Removed

- 200 lines of ZOneTheme megamenu reinit code (`amegamenu`,
  `varMenuDropdownContentController`, `mobileToggleEvent`, etc.).
- The unauthenticated `/debug` endpoint that wrote to a server log file.
- All hardcoded French URLs in the Swup exclusion list (`/panier`,
  `/commande`, `/connexion`, etc.).
- All hardcoded French strings in the front-office JS.
- `#content-wrapper` hardcoded as the Swup container.

### Added

- Back-office configuration page (Modules → OnlyRoots Player → Configure):
  - Toggle Swup on/off
  - Container selector(s), with comma-separated fallbacks
  - Product card selector(s)
  - Play-button anchor selector(s)
  - Hover preload toggle
  - IP whitelist (preview mode for staff only)
  - Extra URL exclusion patterns
  - Debug mode (browser console only)
- Localised strings via `window.onlyrootsPlayerL10n`, populated by the
  PHP module class. Translatable through PrestaShop's standard translation
  workflow.
- URL exclusion list is built dynamically from
  `Link::getPageLink('cart')`, `getPageLink('order')`, etc., so it adapts
  to the shop's language and friendly URL settings.
- Wider set of product-card and cart-button fallback selectors, covering
  Classic, Hummingbird, Warehouse and most premium themes.
- Smarter Swup container resolution: the configured selector accepts
  multiple comma-separated fallbacks; the first one that matches wins.
  If none matches, Swup is silently disabled and the player falls back to
  localStorage-based persistence.

### Fixed

- `ps_versions_compliancy` was set to `_PS_VERSION_` (no-op tautology),
  now `8.0.0 → 8.99.99`.
- The CSS no longer overrides theme styles for `.product-miniature
  .buttons-sections` — every selector is scoped to `.orp-*` classes.
- Disordered eating of theme CSS specificity that produced a stray cart
  icon on the play button is gone (`::before` mask is now self-contained).

---

## Configuration tips per theme family

| Theme        | Container         | Product cards                                  |
| ------------ | ----------------- | ---------------------------------------------- |
| Classic      | `#content-wrapper`| `.js-product-miniature[data-id-product]`       |
| Hummingbird  | `#wrapper`        | `.product-miniature[data-id-product]`          |
| Warehouse    | `#content`        | `.product-miniature[data-id-product]`          |
| ZOneTheme    | `#content-wrapper`| `.js-product-miniature[data-id-product]` + `.buttons-sections` anchor |
| Generic     | `main`             | `article.product[data-id-product]`             |

Defaults shipped by the module are a comma-separated fallback chain
covering the four most common cases — most shops will work without any
configuration change.

---

## Operating modes

### Standalone (Swup disabled)

The player is rendered as a fixed footer. Audio is paused on every page
reload (browsers block autoplay), but the playlist position is restored
from localStorage so the user can resume from where they left off with
one click.

### SPA (Swup enabled)

On navigation, only the configured container is swapped via fetch. The
player element is detached to `<body>` on first init so it survives the
swap natively without state loss. Forms, payment, login, and any path
listed in the exclusion config trigger a full reload instead.

A safety watchdog forces a full reload if a swap silently fails (URL
changes via pushState but content does not). Two consecutive failures in
a session permanently fall back to standalone mode for that session.

---

## License

Proprietary — © 2026 PixFeed (Marc Gueffie).
