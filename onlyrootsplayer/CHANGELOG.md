# Changelog

All notable changes to OnlyRoots Persistent Audio Player are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.20] — 2026-05-02

Two corrections following the v2.5.19 production test:

### Fixed — AS4 facet search broken when extension active (revert of v2.5.19 Patch 3)

The v2.5.19 `patchAs4GetParamValue` defensive wrapper was too
aggressive. It returned `''` whenever `as4Plugin.params[idSearch]`
was undefined, which we assumed only happened during a 50–300ms
race window after Swup `content:replace`. Operator confirmed in
production that `as4Plugin.params[idSearch]` actually stays
undefined **persistently** on certain pages — meaning the wrapper
returned `''` for every `getParamValue` call, AS4 received no
filter data, AJAX fired without filters, the product list never
updated. Symptom: facet checkboxes tick visually but the listing
doesn't change.

**Action.** Removed the wrapper entirely (`patchAs4GetParamValue`
function and its 2 call sites in `rebindAdvancedSearch4`). The
underlying race-condition JS error from v2.5.19's monitor capture
(`Cannot read properties of undefined (reading
'as4_productFilterListData')`) returns, but it's a one-off console
warning, not a user-facing bug. Trade-off: rare console warning
acceptable, broken search is not.

**Root cause unfixed for now.** Why `rehydrateAs4Params()` doesn't
persistently populate `params[idSearch]` on certain pages is a
separate investigation (probably timing or scope: `params` is
re-created after each swap but evaluated in a different JS
context than where `getParamValue` reads it). Tracked for a
future release if it surfaces again.

### Fixed — `ORP_INCLUDE_CONTACT` migration on upgrade

The v2.5.19 install-default change from 0 to 1 only affected
**fresh installs**. Operators upgrading from v2.5.18 or earlier
kept their stored value of 0 in the Configuration table, so
"audio on Contact" was never automatically enabled.

**Action.** Added `upgrade/upgrade-2.5.20.php` which calls
`Configuration::updateValue('ORP_INCLUDE_CONTACT', 1)` once when
upgrading to 2.5.20 or later. PrestaShop runs upgrade scripts
exactly once per version transition.

Operators who actively prefer the previous behaviour (Contact
excluded from Swup, audio interrupted on contact navigation) can
still flip the toggle back to 0 in the BO config form after the
upgrade. The migration sets the value, it doesn't lock it.

### Out of scope for this release

Two known issues confirmed in the v2.5.19 production test but not
addressed here because they're outside the module's responsibility:

- **Home rendered with degraded HTML on Swup nav from AS4-filtered
  category** — `dom:diff` showed `imagesLoaded: 6/7` instead of the
  normal ~253/322. The server returns a different (cache-polluted)
  rendering of the home depending on AS4 search context in session.
  This is a PrestaShop / Smarty / pm_advancedsearch4 server-side
  issue, not in our control.
- **`/en` (no trailing slash) duplicate Swup visits** — ZOneTheme's
  logo links to `/en` instead of `/en/`, triggering a redundant
  Swup nav. Cosmetic only (no audio loss, no broken DOM); fix would
  belong in a theme override of `header.tpl`.

### Note on Contact audio cuts (still possible after this release)

Even with `ORP_INCLUDE_CONTACT=1`, the audio MAY still cut on
Contact in some setups — not because of Swup behaviour but because
**reCAPTCHA** and **Brevo Chat** modules touch `<html>.classList`
and the DOM at the moment Contact loads, which can interfere with
the audio element's playback context post-swap. This is a
pre-existing issue from before v2.5.19 (intermittent on
v2.5.18). If operator confirms persistent audio cuts on Contact:

1. First check — toggle should be ON in BO config.
2. If still cuts — workaround: re-add `/contact-us` and
   `/fr/nous-contacter` to `ORP_EXTRA_EXCLUDES` in the BO, AND
   disable the `displayHeader` hook of the recaptchapro module on
   the Contact page.

The "real" fix would require module-level guards against
reCAPTCHA's DOM manipulation, which is out of scope here.

## [2.5.19] — 2026-05-02

Three targeted patches stacked into one release. Audio continuity on
the Contact page is the headline feature.

### Patch 1 — Audio continuous on Contact page (`ORP_INCLUDE_CONTACT` default ON)

The original v2.4.5 catastrophic-swap on `/fr/nous-contacter` was
caused by listener-stacking from third-party inline scripts on the
Contact page (contactform native validators, Brevo Chat boot,
captcha widgets) that wiped the `swup-enabled` class on `<html>` after
a few navigations. We worked around it in v2.4.6 by adding `'contact'`
to the Swup exclusion list — i.e. Contact navigation triggered a full
reload, audio stopped.

Since v2.5.10/2.5.11 the `IGNORE_SCRIPT_PATTERNS` regex marks every
listener-binding inline script with `data-swup-ignore-script` so
ScriptsPlugin skips it on every swap. The root cause of the
catastrophic-swap is therefore neutralised on the parent page.

We're now flipping the operator opt-in: `CFG_INCLUDE_CONTACT` defaults
to `1` instead of `0`. Contact participates in Swup nav and audio
keeps playing across the transition.

**Safety net unchanged.** If the catastrophic-swap re-occurs on a
specific install (third-party module we haven't seen), the watchdog
detects the URL/content mismatch within 1.5s, forces a full reload,
and we end up in the previous state (audio stops on Contact). Worst
case = identical to v2.5.18 behaviour.

Operators who actively prefer the previous behaviour can flip the
toggle back to off in the BO config form.

### Patch 2 — `data-swup-persist` on the player wrapper

Defence-in-depth. `<div id="orp-player">` now carries `data-swup-persist="orp-player"`
(Swup's native opt-out attribute). The player already survives Swup
swaps because it lives outside `#content-wrapper`, but this attribute
makes the immunity explicit and survives:

- Future ZOneTheme structure changes that might accidentally place the
  player inside the swap container
- Operator changes to `ORP_SWUP_CONTAINER` that broaden the swap area
- Third-party module DOM mutations that move the wrapper

Zero risk, purely additive.

### Patch 3 — Defensive wrapper for `as4Plugin.getParamValue`

Production monitor log on 2026-05-02 14:58:04 captured:

```
js:error message=Uncaught TypeError: Cannot read properties of
undefined (reading 'as4_productFilterListData')
filename=/themes/ZOneTheme/assets/cache/bottom-083c78459.js lineno=950
```

Source identified in `pm_advancedsearch4/views/js/as4_plugin.js`:
`as4Plugin.getParamValue(idSearch, 'as4_productFilterListData')` is
called from 8 sites (lines 98, 120, 565, 602, 681, 764, plus the
`-17.js` variant). The function accesses
`as4Plugin.params[idSearch]['as4_productFilterListData']`. If
`as4Plugin.params[idSearch]` is `undefined` (which happens during the
50–300ms race window between Swup `content:replace` and our
`rehydrateAs4Params()` async fetch), the property access throws.

The PHP source (`pm_advancedsearch.tpl` line 79) renders the inline
init via `<script>as4Plugin.params[N] = {...};</script>`. This block
sits in the body, but `swup-head-plugin` doesn't re-evaluate body
scripts and our `IGNORE_SCRIPT_PATTERNS` filter catches it for
listener-stacking reasons. So during the race window after a swap,
`params[idSearch]` is whatever the previous page left there — or
empty if it's a first visit.

**Fix.** Wrap `as4Plugin.getParamValue` with a defensive guard that
returns `''` when `params[idSearch]` is missing instead of throwing.
Returning `''` is safe: the PHP template already outputs the literal
string `''` when `$as4_productFilterListData` is empty, so existing
callers in `as4_plugin.js` already handle that case in their
JSON.parse logic without crashing.

The wrapper is idempotent (`__orpPatched` flag on the wrapped
function) and is applied:
- BEFORE `rehydrateAs4Params()` starts (closes the race window)
- AGAIN after rehydration completes (defensive, in case
  pm_advancedsearch4 redefined the function during its inline script
  re-eval)

Both calls are inside `rebindAdvancedSearch4()`, which runs once per
swap from the preset entry point.

### Credits

Diagnosis of patch 3 root cause provided by a parallel review session
that grep'd the live `pm_advancedsearch4` module source (8 call sites
for `getParamValue`, the Smarty template at line 79, the timing of the
inline script vs Swup's swap pipeline).

## [2.5.18] — 2026-05-01

Hotfix for v2.5.17: stale `updateProductList` events no longer wipe
the page on cross-page navigation.

### Symptom

On OnlyRoots Reggae, a navigation flow like:

1. Visit a category page (e.g. `/fr/17-albums-lp-33t`)
2. Click a facet checkbox (Condition / Format / Year / Brand)
3. Before the AS4 AJAX response settles, click the home logo
   (Swup nav to `/fr/`)

would result in the home rendering with header and footer but a
totally empty `<div id="content-wrapper">` (only an empty
`<div class="center-wrapper">` whitespace remained). Pressing F5
restored the page in full → confirms the server HTML is fine,
the corruption is client-side.

### Root cause

The v2.5.17 `updateProductList` listener does
`$('#js-product-list').replaceWith(data.rendered_products)`.
When the user navigates away mid-AJAX, the AS4 response arrives
AFTER Swup has already swapped `#content-wrapper` to a different
page's content. The handler then runs against the freshly-swapped
DOM and:

- If the new page has a `#js-product-list` (e.g. category → category) →
  it gets replaced with content from the previous page's search.
- If the new page does NOT have one (e.g. category → home) →
  jQuery returns an empty set → the handler does no destructive
  op via the `.length` check… but **the underlying issue is that
  AS4 also fires content updates that don't pass through our
  guard**, and other downstream handlers in pm_advancedsearch4
  (slider re-init, callback chains) operate on stale DOM
  references and end up clearing `#content-wrapper`.

### Fix

Two guards added to the `updateProductList` handler:

**Guard 1 — URL relevance check.** AS4 response payloads include
a `current_url` field (the canonical URL the search results
correspond to). Before applying any DOM mutation, compare it
against `window.location.href`. If they don't match (after
normalizing trailing slashes and stripping query/hash), drop the
event silently — the user navigated away.

**Guard 2 — DOM structure sanity check.** Even if `current_url`
agrees, verify the live DOM actually has `#js-product-list`
before any `replaceWith`. If not, the event is for a structure
we don't recognize and we shouldn't touch the DOM.

These two guards together close the race condition window between
"AS4 AJAX in flight" and "Swup nav already started", which was the
specific failure mode reproduced in production.

### Why we didn't catch this in v2.5.17

The v2.5.17 fix was tested with a single facet click then waiting
for the response to settle before navigating. The race scenario
requires the user to click navigation BEFORE the AJAX completes —
common in real usage but easy to miss in scripted testing. Future
test plan should include cancellation-during-transition cases.

## [2.5.17] — 2026-05-01

Bundles fixes from v2.5.15, v2.5.16 and adds full `pm_advancedsearch4`
re-init support.

### v2.5.17 - pm_advancedsearch4 (faceted search) compatibility

OnlyRoots Reggae uses the third-party `pm_advancedsearch4` module
(by PrestaModule) which fully replaces the native `ps_facetedsearch`
with its own faceted-search engine. Three structural issues prevent
it from working under Swup:

**A. `as4Plugin.params` not re-evaluated after swap.**

The module injects a `<script>` inline in the document `<head>`
that assigns `as4Plugin.params[N] = { ... }` with the current
search context (id_search, criterions, hookName, etc.).
swup-head-plugin only re-executes scripts whose content changed;
this assignment is detected as identical between pages (same key,
same shape) and gets skipped, so after the swap `as4Plugin.params`
is stale or empty.

**B. Click handlers on facet checkboxes are direct, not delegated.**

`as4Plugin.initSearchBlock(N, 'search', 'init')` is called once
at `$(window).on('load')` to bind change/click handlers directly
on `.PM_ASBlockOutput input` elements. The new checkboxes that
arrive in the swapped `#content-wrapper` have no handlers at all.
Clicking a facet does nothing.

**C. The native `updateProductList` listener uses `.html()` against
a HTML string that already includes the wrapper `<div id="js-product-list">`.**

The server response from `/module/pm_advancedsearch4/advancedsearch4?...`
contains `data.rendered_products` whose first tag is
`<div id="js-product-list">...</div>`. The native handler does
`$('#js-product-list').html(data.rendered_products)`, producing a
nested duplicate-ID structure. Browsers render this as the OLD
content. The user sees the AJAX fire and the loader, but the
product list visually does not update.

### Fix

Three new functions added to `views/js/themes/zonetheme.js`:

1. `rehydrateAs4Params()` — fetches the current URL via XHR,
   extracts each `<script>...as4Plugin.params[N] = ...</script>`
   block (using a non-greedy regex with negative lookahead for the
   closing tag to avoid matching unrelated `application/ld+json`
   blocks), and evaluates each via `new Function(code)()`. This
   re-populates `as4Plugin.params` for the new page.

2. `reinitAs4SearchBlocks()` — iterates every
   `.PM_ASBlockOutput[data-id-search]` in the live DOM and calls
   `as4Plugin.initSearchBlock(idSearch, 'search', 'init')`. This
   re-binds the change/click handlers on the new facet inputs.

3. `installAs4UpdateProductListHandler()` — once-only replacement
   of the broken `updateProductList` listener. Uses
   `$('#js-product-list').replaceWith(data.rendered_products)`
   instead of `.html(...)`. Also handles `rendered_products_top`,
   `rendered_products_bottom`, `rendered_active_filters`, and
   `rendered_facets` to keep the side filters in sync with the
   filtered counts.

Top-level orchestration in `rebindAdvancedSearch4()` is called from
the preset entry point on every Swup swap (after `cleanupListeners`).
The function is async because of the URL re-fetch; the promise is
fire-and-forget — the preset doesn't block on it.

The replacement listener is bound exactly once via
`__orpAs4ListenerInstalled` to avoid handler stacking.

### v2.5.16 - ZOneTheme popstate-killer (folded in)

Production source audit of `themes/ZOneTheme/_dev/js/listing.js`
line 388 (and confirmed in the compiled `assets/js/theme.js`):

```js
window.addEventListener('popstate', function(e) {
  if (e.state && e.state.current_url) {
    window.location.href = e.state.current_url;
  }
});
```

Browser back/forward after a Swup nav would trigger
`window.location.href = ...` → full reload → audio cut.

Fix: capture-phase `popstate` listener that calls
`stopImmediatePropagation()` whenever the event state contains a
string `current_url`, blocking the bubbling handler.

### v2.5.15 - syncSidebarColumns disabled (folded in)

`syncSidebarColumns` in the Swup `before:content:replace` hook
corrupted `#content-wrapper` during contact→home navigation (home
returned with empty central content; F5 fixed it). The single call
has been commented out.

### Telemetry

Two new fields in the `orp:preset:invoked` monitor payload:

- `popstateKilled`: 1 on the first preset call, 0 on subsequent.
- `as4Detected`: number of `.PM_ASBlockOutput[data-id-search]`
  found in the live DOM at preset-invocation time. 0 means
  pm_advancedsearch4 isn't on this page; >0 means we triggered the
  rebind path.

## [2.5.14] — 2026-05-01

Fix Contact page falling out of Swup navigation despite
`ORP_INCLUDE_CONTACT=1`.

### Root cause

Production diagnosis (F12 console + monitor.log + DB inspection):
- `ORP_INCLUDE_CONTACT=1` → confirmed in `ps_configuration`
- `swupExcludePaths` exported to JS → Contact path NOT in the list ✓
- Contact links in HTML → no `data-no-swup`, no `data-link-action`,
  no `data-iso-code`, no other attribute that would exclude them
  from the Swup `linkSelector` ✓
- Origin check in `ignoreVisit` → matches (both `https://www.onlyroots-reggae.com`) ✓
- Yet the monitor log showed ZERO `swup:visit:start` for Contact
  navigations — the link click bypassed Swup entirely → full reload
  → audio cut

Browser network tab and console showed the smoking gun: a `Fetch a
fini de se charger : GET "/fr/nous-contacter"` triggered by
`performPreload` from `swup-preload-plugin` BEFORE any user click.

### What was happening

The preload plugin was instantiated unconditionally even when
preloading was disabled in config:

```js
if (typeof window.SwupPreloadPlugin === 'function') {
    plugins.push(new window.SwupPreloadPlugin({
        preloadHoveredLinks: !!CONFIG.swupPreload,  // false from BO
        preloadVisibleLinks: false,
    }));
}
```

Setting `preloadHoveredLinks: false` only disabled hover-triggered
preloads. The plugin itself was still registered on Swup, which:
1. Installed its own hooks in the visit pipeline
2. Exposed `swup.preload(url)` publicly — allowing any theme or
   third-party code to trigger preloads we didn't ask for
3. Cached preload results, including failures: when a preload of a
   page returned a document where the plugin's heuristic couldn't
   confidently match the swap container (which apparently happens
   with `/fr/nous-contacter` — the contact template uses
   `displayContactContent` hook with a layout that differs subtly
   from the standard pages), the plugin marked the link as
   non-navigable, and Swup skipped it on subsequent clicks.

### Fix

Don't register the preload plugin at all when `CONFIG.swupPreload`
is false. The plugin is now strictly opt-in:

```js
if (CONFIG.swupPreload && typeof window.SwupPreloadPlugin === 'function') {
    plugins.push(new window.SwupPreloadPlugin({
        preloadHoveredLinks: true,
        preloadVisibleLinks: false,
    }));
}
```

Effect for OnlyRoots Reggae specifically: with the BO toggle
"Preload pages on hover" left at its default (off), the plugin is
no longer in the Swup pipeline, no preload fires for Contact, the
link is treated like any other → Swup intercepts → swap → audio
continues.

### Operators who DO want preloading

Toggle "Preload pages on hover" stays available in the BO. When
enabled, the plugin is registered with `preloadHoveredLinks: true`
exactly as before, so the feature works the same way it always did
for shops that use it.

## [2.5.13] — 2026-05-01

Actually fix the language selector toggle — v2.5.12 was a no-op for
ZOneTheme.

### Why v2.5.12 didn't work

Confirmed via F12 console on production:

```
typeof window.bootstrap         → 'undefined'
typeof window.bootstrap?.Dropdown → 'undefined'
```

ZOneTheme's compiled `theme.js` keeps Bootstrap in webpack-local
scope. The v2.5.12 fix tried to call `bootstrap.Dropdown.getInstance
(el).dispose()` and `new bootstrap.Dropdown(el)` — both throw
because `window.bootstrap` doesn't exist. The function fell through
to the jQuery `.dropdown()` fallback, which also doesn't exist in
BS5 jQuery-style — net result: zero action, toggle stays broken.

### Fix

Switched from "fix Bootstrap's instance state" to "replace Bootstrap's
dropdown handler entirely with our own delegated handler."

A single click delegate is bound on `document` ONCE, on the first
preset invocation. Because `document` is never replaced by Swup,
the delegate survives every navigation. No Bootstrap API needed.

The delegate:

1. Click on `[data-bs-toggle="dropdown"]` (or any descendant up to
   4 hops): close any other open dropdowns, toggle `.show` on the
   parent `.dropdown` and on the sibling `.dropdown-menu`, mirror
   the state into `aria-expanded`.
2. Click outside any open menu: close all dropdowns.
3. Escape key: close all dropdowns.

The CSS classes (`.show` on `.dropdown-menu`) are exactly what
Bootstrap 5 itself uses, so the existing theme styles render
correctly without modification — the visual toggle is CSS-driven,
JS just flips classes.

### Bonus fix

After every swap, the preset resets `aria-expanded="false"` on every
toggle in the new DOM and removes any stale `.show` classes. Without
this, a toggle that was open before navigation could come back as
"phantom-open" (aria says open, no menu visible).

### Side effects

Bootstrap's own dropdown handler still runs in parallel — we don't
disable it. But the bundled handler is broken across swaps anyway,
and our delegate's `event.stopPropagation()` prevents the Bootstrap
handler from receiving the click on the toggle, so they don't fight.

Theme-internal dropdown lifecycle handlers (`show.bs.dropdown` /
`hide.bs.dropdown` from ZOneTheme `_dev/js/components/drop-down.js`)
won't fire from our delegate (we don't dispatch the Bootstrap
custom events). If a theme component depends on those events for
something visible (rare), file an issue and we'll dispatch them
manually.

## [2.5.12] — 2026-05-01

Fix the language selector toggle (and every other Bootstrap dropdown
in the header: currency, account menu) breaking after the first Swup
navigation.

### Why the v2.5.11 regex didn't fix this

Confirmed via SSH on the OnlyRoots production server:
- `themes/ZOneTheme/assets/js/theme.js` contains the `js-dropdown` /
  `show.bs.dropdown` bindings (1 match each via grep). Compiled
  webpack bundle, served as `<script src="...theme.js">`.
- The home page emits 8 inline scripts (3 schema.org JSON-LD, 1
  PrestaShop `var prestashop = {...}` data block, GA4, Boxtal,
  Brevo, password-strength dictionary). NONE of them touch
  dropdowns.

Conclusion: the v2.5.11 regex (covering inline scripts only) cannot
reach the dropdown binding because it lives in a `<script src>`,
which `swup-scripts-plugin` deliberately skips. The regex is still
useful for the megamenu / slider / cart-counter inline patterns it
was designed for — but the dropdown bug needed a different fix.

### What actually breaks

After Swup swaps the DOM, dropdown toggles enter one of two failure
modes (both produce the same symptom for the user):

1. **Host element replaced.** Bootstrap had attached its `Dropdown`
   instance to the OLD element via its internal `data-bs-instance`
   map. The new element exists but has no instance → click fires no
   handler → toggle does nothing.
2. **Host element NOT replaced** (header sits outside the swap zone)
   **but `theme.js` was re-evaluated** by `swup-head-plugin` because
   the cache-busted URL changed. Bootstrap binds a SECOND instance
   on top of the existing one → click fires both → first opens, the
   second immediately closes ("dropdown opens then closes itself").

### Fix

Added `reinitBootstrapDropdowns($)` to the ZOneTheme preset
(`views/js/themes/zonetheme.js`). Called from the preset entry
point on every successful Swup `content:replace`. For each
`[data-bs-toggle="dropdown"]` in the live DOM:

1. `bootstrap.Dropdown.getInstance(el)` → if non-null, `dispose()`.
2. `new bootstrap.Dropdown(el)` → fresh instance, exactly one.

Idempotent. Heals failure mode 1 (no instance → instance) and
failure mode 2 (two instances → one). Bootstrap 4 fallback path
included via `$.fn.dropdown()` (no current ZOneTheme uses BS4 but
a child theme override could).

### Scope

The fix is scoped to the ZOneTheme preset, not `player.js`.
`player.js` stays theme-agnostic. Other themes can register their
own preset on `window.orpThemePresets[<name>]` and decide whether
they need the same dispose+recreate dance — most modern themes
that fully support Swup already handle it.

### Telemetry

`bootstrapDropdowns` count added to the `orp:preset:invoked`
monitor payload. After upgrade, F12 console with debug enabled on
the BO will show the number of dropdowns re-initialised after each
swap (typically 3-5: language, currency, account, plus any
account-area sub-toggles).

## [2.5.11] — 2026-04-30

Tighter listener-stacking ignore-script regex.

### Why

A parallel review session pointed out three patterns the v2.5.10
regex didn't catch — including the one that actually causes the
dropdown bug we're trying to fix:

1. `$(window).on('load', ...)` — v2.5.10 required `$(document)`
   literally. ZOneTheme `_aonemegamenu.js` (line 213) calls
   `mobileToggleEvent()` + `enableHoverMenuOnTablet()` from a
   `$(window).on('load', ...)` block without `.off()`. If that ends
   up inlined anywhere, every swap stacks one more.
2. `$('.js-dropdown').on('show.bs.dropdown', ...)` — v2.5.10's
   `.on(['"]click['"]` only matched click events. ZOneTheme
   `drop-down.js` lines 27-44 binds Bootstrap dropdown lifecycle
   events on `.js-dropdown`, which has been the literal source
   of the "dropdown opens then closes itself" symptom.
3. `window.addEventListener(...)` / `el.addEventListener(...)` —
   v2.5.10 required `document.` prefix. Plenty of theme scripts
   bind on `window` (scroll listeners) or arbitrary elements.

### Fix

Broadened the regex from:

```
/var\s+prestashop\s*=|prestashop\.(on|emit)\(|
 \$\(\s*document\s*\)\.on\(|document\.addEventListener\(|
 \.on\(['"]click['"]/
```

to:

```
/var\s+prestashop\s*=|prestashop\.(on|emit)\(|
 \$\(\s*[^)]+\s*\)\.on\(|addEventListener\(/
```

Changes:
- `\$\(\s*document\s*\)\.on\(` → `\$\(\s*[^)]+\s*\)\.on\(` —
  matches any jQuery selector argument, not just `document`
- `document\.addEventListener\(` → `addEventListener\(` — matches
  any `.addEventListener` on any host
- Dropped the now-redundant `.on(['"]click['"]` clause; the new
  `\$\(\s*[^)]+\s*\)\.on\(` covers any event name including click

### Trade-off

The wider net catches more legitimate inits that "happen to also
bind a listener". We accept that, same reasoning as v2.5.10:
listener stacking is a chronic user-visible bug, a missed init is
at worst a widget that doesn't refresh. `data-swup-reload-script`
remains the operator escape hatch for the rare cases.

## [2.5.10] — 2026-04-30

Structural fix for the recurring listener-stacking bug pattern.

### Root cause finally identified

After 8 patches on what looked like distinct symptoms (Bootstrap
dropdown intermittently broken, language flag dropdown unresponsive
on product pages, occasional double-firing of slider re-init,
add-to-cart counted twice on rare nav sequences) we identified the
shared cause: **listener stacking via SwupScriptsPlugin re-execution**.

`SwupScriptsPlugin({head: true, body: true})` (line ~1370) re-runs
EVERY inline `<script>` after each swap so themes that bootstrap
inline scripts (PrestaShop core, ZOneTheme, most modules) keep
working. The downside: any inline script that registers a listener
via `$(document).on(...)`, `document.addEventListener(...)`,
`prestashop.on(...)` etc. ALSO re-runs, stacking a NEW listener on
top of the existing one without removing it. After 3-4 nav hops:
3-4 handlers fire for one click. Symptoms:

- Bootstrap dropdown opens then closes itself
- Language flag dropdown unresponsive (handler chain interferes)
- Slider re-init fires multiple times per swap
- Click counts off (carts, etc.)

The v2.0.0 mitigation only matched `var prestashop = {...}`
declarations (to avoid clobbering the live emitter). It did NOT
catch listener-binding patterns, so those scripts were left to
re-execute and stack listeners freely.

### Fix

Extended the inline-script ignore heuristic to catch all common
listener-binding patterns. The new regex:

```
/var\s+prestashop\s*=|prestashop\.(on|emit)\(|
 \$\(\s*document\s*\)\.on\(|document\.addEventListener\(|
 \.on\(['"]click['"]/
```

covers:
- `var prestashop = {...}` (original case, kept)
- `prestashop.on(`, `prestashop.emit(` (PS event emitter binds)
- `$(document).on(...)` (jQuery delegation, classic stack-trigger)
- `document.addEventListener(...)` (vanilla equivalent)
- `.on('click'...)` / `.on("click"...)` (generic jQuery click bind,
  catches Bootstrap data-toggle delegation patterns)

Scripts matching ANY of these get `data-swup-ignore-script` added
before swap, so SwupScriptsPlugin skips them. The original execution
at first page load remains in place, so the listeners DO get bound
once — they just don't get re-bound on every subsequent nav.

### Operator escape hatch

Authors who legitimately need an inline script to ALWAYS re-execute
on every nav (e.g., page-specific config injection that ALSO happens
to call `$(document).on(...)`) can add `data-swup-reload-script`
to their `<script>` tag, which takes priority over our heuristic
and skips the auto-ignore.

### Trade-off accepted

A small number of inline init scripts that combine "page-specific
data setup" + "listener binding" in the same block will be skipped,
losing their data-setup side effect. We accept this — listener
stacking is a far worse failure mode (manifests as random user-facing
bugs) than a one-off init that doesn't run on a page where the data
typically doesn't change between navs anyway.

### Credit

Diagnosis credit to a parallel Claude session that audited the SPA
plumbing line by line and identified the stack pattern. We confirmed
each claim against the actual code before shipping.

## [2.5.9] — 2026-04-30

Restore audio continuity on home navigation — the v2.5.6 sledgehammer
that force-reloaded the home was based on a wrong hypothesis.

### Removed — URL-pattern force-reload for ZOneTheme home

Operator confirmed via F12 console on production:

```
typeof window.jQuery.fn.slick      → "function"
typeof window.jQuery.fn.nivoSlider → "function"
typeof window.jQuery.fn.sticky     → "function"
```

All three slider plugins ARE registered on the global `window.jQuery`.
Investigating ZOneTheme's compiled `assets/js/theme.js` confirms why:
the bundle's webpack module 311 is literally `t.exports = jQuery` —
it imports the global jQuery, then registers Slick and NivoSlider on
it via `t.fn.slick = ...` and `t.fn.nivoSlider = ...`. The plugins
have always been globally accessible.

The v2.5.6 force-reload was diagnosing the wrong root cause. The
preset was reporting `homeBlockSliders=0` not because the plugin was
missing but because the Swup-fetched home document either contained
no slider DOM (server returned a degraded variant) or the swap
selector found no matching elements. Either way, force-reloading
the home interrupts audio playback — which is the exact opposite of
what the module is supposed to do (operator quote: "il faut que l'audio
continue dans tous les cas").

The DOM-detection fallback below is kept for theme variants that
genuinely don't expose the plugins globally — those cases will still
get the force-reload and a clean slider re-init via reload.

### Trade-off

Audio now continues across nav-to-home transitions. If the swapped
home renders with degraded content (the dom:diff log captured
`imagesLoaded: 13/13 -> 9/9` with `bodyClasses: ... -> layout-left-
column no-customer-address page-i...` instead of the full home), the
user sees a less complete home until they refresh. That secondary
issue is server-side (PrestaShop cache key / cookies / Smarty
context for Swup-fetched URLs) and outside the scope of this module.
Operator must report visually if it materializes, then we investigate
the server-side rendering separately.

## [2.5.8] — 2026-04-30

Translation fix — module strings (front + BO) now actually load when
the shop is in English.

### Fixed — XLF naming convention

Symfony Translator (the engine PrestaShop 1.7+/8.x uses for module
catalogs) wants the locale baked into the **file name**, not just the
parent folder. Our v2.5.2 file was at:

```
translations/en-US/ModulesOnlyrootsplayerShop.xlf
```

Symfony silently never loaded it, so every `{l s='Écouter' d='Modules
.Onlyrootsplayer.Shop'}` in templates and every `$this->trans()` /
`tAdmin()` call in PHP fell back to the source string (French) on a
shop running in English. Renamed to:

```
translations/en-US/ModulesOnlyrootsplayerShop.en-US.xlf
```

Confirmation: the existing file's own header already said
`original="ModulesOnlyrootsplayerShop.fr-FR.xlf"` — the locale-in-name
pattern was the intent from the start, the actual file just got the
wrong name when it was added.

### Added — Admin domain XLF

The module also uses `Modules.Onlyrootsplayer.Admin` for every BO
string (54 unique strings: form labels, descriptions, monitor panel,
displayName, error messages...). v2.5.2 had no Admin XLF at all, so
the entire BO config form stayed in French regardless of shop locale.
Generated `ModulesOnlyrootsplayerAdmin.en-US.xlf` from a sweep of all
`tAdmin()` and `$this->trans(..., 'Modules.Onlyrootsplayer.Admin')`
call sites.

### Added — `en-GB` locale folder

PrestaShop ships with both `en-US` and `en-GB` packs and operators
can install either. We were only providing `en-US`, so a shop set to
en-GB never got the English strings. Added a parallel
`translations/en-GB/` folder with both
`ModulesOnlyrootsplayerShop.en-GB.xlf` and
`ModulesOnlyrootsplayerAdmin.en-GB.xlf` — same English text as en-US
(no spelling divergences in our limited UI vocabulary). Each folder
ships an anti-listing `index.php` matching the convention of the rest
of the module.

### Operator action required after upgrade

PrestaShop caches Symfony catalogs under `var/cache/`. After
deploying 2.5.8, vide le cache (BO → Paramètres avancés →
Performance → Vider le cache) for the new files to be picked up.

## [2.5.7] — 2026-04-30

Hot fix after the v2.5.6 production test. Operator confirmed: dropdown
toggle works (good — v2.5.6 fixed that), but clicking EN in the open
menu still doesn't switch language. The capture-phase blocker even in
its tightened v2.5.6 form was killing whatever theme JS handler the
language link depends on (cookie set + redirect, etc.) before it
could run.

### Removed — capture-phase language click blocker

`bindLanguageCaptureBlocker` is now a no-op. The function is kept as
a stub (still called from `init()` so existing call sites don't error)
but does nothing. The three-layer defence WITHOUT the blocker:

1. linkSelector excludes `[data-iso-code]` and `[data-no-swup]`
   (Swup-level filter)
2. tagLanguageLinks() flags `[data-iso-code]` and `[href*="id_lang="]`
   with `data-no-swup` after init and after every Swup swap
3. ignoreVisit() catches any remaining language URL via either
   the 2-letter-prefix heuristic OR the explicit `id_lang=`
   query-string check (added below)

### Added — explicit `id_lang=` detection in ignoreVisit

`ignoreVisit()` now returns `true` when the target URL has an
`id_lang` query parameter. This catches PrestaShop's `url
entity='language'` helper output when friendly URLs are disabled or
when the path itself doesn't change between source and target — a
case the 2-letter-prefix heuristic was blind to.

## [2.5.6] — 2026-04-30

Hot fix after the v2.5.5 production test. Two corrections:

### Fixed — Bug 1 sledgehammer for ZOneTheme home

The v2.5.5 detection-based force-reload didn't trigger in production
(monitor capture 09:14:16Z: `swup:visit:start product → /en/`,
`content:replace`, `visit:end` — no reload, all preset slider counts
stayed at 0). The DOM-based check `targetRequiresPluginsWeDontHave`
returned false, probably because either:

- the parsed target document didn't contain the expected slider DOM at
  the moment we checked (the home blocks may render conditionally on
  current language / cache state), OR
- `window.jQuery.fn.slick` actually evaluates to truthy on a tunnel
  vision check while the working slick instance lives on a webpack-
  scoped jQuery — both can coexist in a ZOneTheme install.

**Fix.** Added an unconditional URL-pattern shortcut at the top of the
helper: when the target URL matches the home pattern (`/`, `/fr`,
`/fr/`, `/en/`, etc. — language-prefix-only path) AND the active
preset is `zonetheme`, force a full reload regardless of DOM
inspection. This is the only page in ZOneTheme that bundles
slider-heavy content, so the URL-based shortcut is reliable. Also
emits an `orp:force-reload` monitor event with the reason so the next
log capture confirms the path taken.

### Fixed — language switcher dropdown / nav broken on swapped pages

Operator reported after v2.5.5 deploy: clicking the FR→EN flag does
nothing on product pages, and the dropdown toggle itself stops
working. Root cause is the v2.5.3 defensive plumbing was too broad:

- `tagLanguageLinks()` selectors included `.language-selector a[href]`
  which catches the dropdown TOGGLE link (rendered by ZOneTheme as a
  `<a class="dropdown-toggle">` inside `.language-selector`). Tagging
  the toggle with `data-no-swup` made Swup's linkSelector ignore it
  (good) but also made the browser try to follow its empty `href` /
  not let Bootstrap's dropdown handler run cleanly (bad).
- `bindLanguageCaptureBlocker()` used the same broad heuristic
  (`closest('.language-selector')`) and called `stopImmediatePropagation`
  on every click in the wrapper, including the toggle click → killed
  Bootstrap's dropdown handler in capture phase before it could open
  the menu.

**Fix.** Tightened both helpers to the strong language signals only:
anchors with `data-iso-code` attribute (PrestaShop ps_languageselector
standard) or with `id_lang=` in their href (the `url entity='language'`
helper output). Wrapper-class selectors (`.language-selector`,
`#_desktop_language_selector`, etc.) are removed from both helpers —
they were over-broad and matched the toggle.

Also added telemetry: every capture-blocker firing emits
`orp:lang-blocker-fired` with a truncated href, so the next monitor
log confirms which clicks the blocker actually intercepts.

## [2.5.5] — 2026-04-30

Two fixes for client-confirmed bugs (after the v2.5.2 deploy + the
v2.5.4 module-disable A/B test that proved the bugs were ours).

### Fixed — Bug 3: left/right column disappears on category navigation

**Root cause.** ZOneTheme renders the sidebar columns and the main
content as **siblings** under `.row` (cf. extracted v2.7.3 source
`templates/layouts/layout-both-columns.tpl`):

```html
<div class="row">
  <div id="left-column">...</div>          ← sibling
  <div id="content-wrapper">...</div>      ← Swup container
  <div id="right-column">...</div>         ← sibling
</div>
```

Swup only swaps `#content-wrapper`. When navigating from a layout
WITHOUT a sidebar (home, full-width pages) to one WITH a sidebar
(category, contact, search), the new HTML brings a `#left-column`
that never reaches the live DOM — only `#content-wrapper`'s contents
do. Result: category page shown without its faceted-search filters.

The reverse case is the same problem inverted: category → home
keeps the stale category filters in `#left-column` because we never
removed it on the swap.

**Fix.** New `syncSidebarColumns(visit)` helper called from the
`before:content:replace` hook. For each of `#left-column` and
`#right-column`:

- target has it, live doesn't  → insert (cloned) at the right sibling
  position (before `#content-wrapper` for left, after for right)
- target lacks it, live has it → remove from live DOM
- both have it                 → replace `innerHTML` so the
                                  faceted-search filters refresh
                                  between categories

Runs before the main `#content-wrapper` swap so the columns are in
place when the new products land — any layout-dependent JS sees the
correct structure on first paint.

### Fixed — Bug 1: home top block doesn't display after navigation back

**Root cause.** ZOneTheme bundles Slick and NivoSlider via webpack
into `aone-module.js`. The plugin registration
`$.fn.slick = ... ; $.fn.nivoSlider = ...` happens on the
**webpack-scoped** jQuery instance, not on `window.jQuery`. Our
ZOneTheme preset (`views/js/themes/zonetheme.js`) reads `$.fn.slick`
from the global jQuery and silently bails out when it's undefined
(cf. `reinitHomeBlockSliders`, `reinitBrandLogoSliders`,
`reinitFeaturedCategoriesSliders`, `reinitAoneSlider`). The
`aone-module.js` bundled IIFE only runs at first page load, so after
a Swup nav-back-to-home it never re-executes and the slider DOM
stays empty.

**Fix.** New `targetRequiresPluginsWeDontHave(visit)` helper called
from `before:content:replace`. It inspects the freshly-fetched
target document for slider DOM (`#aoneSlider`,
`.js-home-block-slider`, `.js-brand-logo-slider`,
`.js-featured-categories-slider`, `.js-category-slider`). When it
finds slider DOM AND the corresponding plugin (`$.fn.slick` or
`$.fn.nivoSlider`) is missing on the global jQuery, it flags the
visit with `__orpForceReload`. The post-swap `content:replace`
handler reads that flag and short-circuits with
`window.location.replace(visit.to.url)` — a clean full reload that
re-runs the webpack boot script and re-initializes the sliders
properly.

Trade-off: the user sees a brief flash of the new home (already
swapped in by Swup) before the reload kicks in. This is the cost
of avoiding having to ship our own copies of Slick + NivoSlider as
global libs (which would solve the issue more elegantly but bloat
the module by ~150KB and create a maintenance burden for plugin
updates). Only triggers when navigating TO a page with sliders — all
other navigation (product, category, CMS) stays a clean Swup swap.

### Why we picked these fixes (v2.5.4 module-disable test)

The client uninstalled the module on production after v2.5.2 and
confirmed that disabling the module makes Bug 1, Bug 3 and Bug 4
all disappear. With the module re-enabled the bugs reappear. This
proved the module is responsible for all three (the v2.5.4 audit of
ZOneTheme source confirmed the layout / plugin-scoping mechanisms
above).

A separate "8→6 columns" issue and a BO error in the "Best Sellers"
home block reported in the same email are NOT related to this
module — they were edits the operator had made directly in theme
files that got overwritten during the PrestaShop migration. Out of
scope for this changelog.

## [2.5.4] — 2026-04-30

Operator opt-in toggle for re-including the Contact page in Swup
navigation, so the audio can keep playing across the contact page
instead of being interrupted by a full reload.

### Added — `ORP_INCLUDE_CONTACT` BO toggle (off by default)

After auditing ZOneTheme v2.7.3 source (`templates/contact.tpl`,
`templates/page.tpl`, all four layouts in `templates/layouts/`), the
contact page is structurally identical to product/category pages:

- `contact.tpl` extends `page.tpl` which extends `$layout`
- Every layout shipped with ZOneTheme exposes the same container chain
  `<main id="page"> > <section id="wrapper"> > .main-content >
  .container > .row > #content-wrapper > .center-wrapper > #content`

→ Our default Swup container fallback (`#content-wrapper, #content,
main, #main`) finds `#content-wrapper` on Contact like everywhere else.

The catastrophic-swap observed in v2.4.5 most likely came from a
third-party module mounted on the contact page (the contactform's
own JS, a captcha, a chat widget) toggling `<html>.classList` and
losing the `swup-enabled` flag, NOT from a layout divergence. So we
keep the page excluded by default but expose a toggle so the operator
can opt in after staging validation. The watchdog and
catastrophic-swap detector remain active as a safety net — if the
opt-in path breaks, the user gets a forced full reload, never a stuck
empty container.

### Changed — `getSwupExcludePaths()`

When `ORP_INCLUDE_CONTACT === 1`, the helper drops `'contact'` from
the auto-built exclusion list (built from `Link::getPageLink()`).
The controller-based `controller=contact` exclusion was never in the
list, so it doesn't need a parallel guard.

`isCurrentRequestExcludedFromSwup()` (used by `hookDisplayFooter` to
suppress the player on excluded pages, added in v2.5.3) inherits this
change for free since it reads the same exclusion list — when the
toggle is on, the player is also rendered on the contact page.

## [2.5.3] — 2026-04-30

Targeted fixes for two operator-confirmed bugs after the v2.5.2 deploy.

### Fixed — persistent player visible on excluded pages

The player kept rendering at the bottom of pages that are intentionally
excluded from Swup (`Contact`, `Sitemap`, `Stores`). On those pages the
SPA navigation is bypassed (full reload), so audio is interrupted on
arrival anyway, and the empty player UI sat there displaying whatever
title was loaded before — confusing when the previously-played product
had been disabled in the back-office (it appeared the player was "still
playing" a removed product).

`hookDisplayFooter` now short-circuits with an empty string when the
current request URL matches one of the Swup exclusion patterns. The
helper `isCurrentRequestExcludedFromSwup()` reuses the same pattern
list (`getSwupExcludePaths()`) the JS side uses, so adding a path to
`ORP_EXTRA_EXCLUDES` automatically hides the player on it too.

### Fixed — language switcher on product page leaves content empty

Operator screenshot after v2.5.2 showed a blank container after
clicking the FR→EN flag on a product page. Two failure modes
collaborate to defeat the existing `:not([data-iso-code])` exclusion:

1. PrestaShop's `url entity='language'` helper renders `?id_lang=N`
   URLs. The 2-letter-prefix heuristic in `ignoreVisit` doesn't fire
   (path is unchanged, only the query differs).
2. Some themes wrap the language link inside markup that doesn't carry
   `data-iso-code` directly on the `<a>` element (the attribute lives
   on a parent or a sibling, depending on theme version).

v2.5.3 adds a defence-in-depth layer:

- New `tagLanguageLinks()` runs at init and after every successful
  Swup `content:replace`. It flags every detectable language trigger
  (`a[data-iso-code]`, `a[href*="id_lang="]`,
  `.language-selector a`, `.js-language-selector a`,
  `#_desktop_language_selector a`, `#_mobile_language_selector a`)
  with `data-no-swup="true"`. The Swup linkSelector already excludes
  `[data-no-swup]`.
- New capture-phase click listener (`bindLanguageCaptureBlocker`)
  installed once on `document`. Fires BEFORE Swup's bubble-phase
  delegated handler and calls `stopImmediatePropagation()` on any
  click matching the same heuristic. Doesn't `preventDefault()` —
  the browser still navigates, just via a normal full reload instead
  of being intercepted by Swup.

Modifier-key clicks (`ctrl/meta/shift/alt` or non-primary buttons) are
ignored in the capture-phase blocker so users can still open the
language link in a new tab.

## [2.5.2] — 2026-04-30

Polish release based on direct client feedback after deploying 2.5.1.

### Changed

- **Removed the playlist header (button "Tout écouter" + "Écouter"
  title) from `views/templates/hook/product-playlist.tpl`.** The HHV-
  style "Listen" button injected at the start of the short description
  in 2.5.1 already gives the user a one-click "play the album" entry
  point, so the header on the playlist itself was visually redundant.
  The track list now starts straight at track 1.
- **Centred the play and pause icons inside the per-track buttons.**
  The triangle was previously rendered with vertices at (3,1)(3,11)(10,6)
  in a 12×12 viewBox, which sat 1 px too far right (apex at x=10 leaves
  only 2 px to the right edge versus 3 px on the left). New polygon
  `3,2 3,10 9,6` is symmetric in the 12×12 box. Pause bars also
  re-centred (`x=2.5` and `x=7.5`, width 2 each) so the two icons share
  the same optical centre.

### Removed

- **Duplicate playlist when the product has a long description.**
  v2.5.1 cloned the `.orp-product-playlist` widget into
  `.product-description` (the long description block ZOneTheme renders
  in its "Description" tab) for a Juno-style placement. The client
  reported the playlist appearing twice when the product also had a
  description. The Juno placement is already covered by the line-107
  hook position in `product.tpl` (it's inside the description column,
  visible without scrolling). Removed `injectPlaylistInLongDescription`
  and its CSS counterpart `.orp-product-playlist--in-description`.

### Added — English translation

`translations/en-US/ModulesOnlyrootsplayerShop.xlf` with FR→EN mappings
for every user-facing Shop string. PrestaShop swaps to it automatically
when the shop is set to English. Notably:

- `Écouter` → `Play`
- `Écouter un extrait` → `Listen to a sample`
- `Tout écouter` → `Play all`
- `Lecteur audio` → `Audio player`
- ... and the rest of the player aria-labels.

### Notes (no code change)

- **Brevo chat button overlapping the persistent player**: the chat
  widget is fixed-positioned at the bottom of the page, same DOM zone
  as our player. Easy fix on the operator's side: in their custom CSS,
  push the Brevo button up by the player height when the player is
  active, e.g.
  `.brevo-conversations-button { bottom: var(--orp-height, 72px) !important; }`
  (replace `.brevo-conversations-button` with the actual selector
  Brevo renders).
- **Audio paused on `/fr/nous-contacter`**: the contact page is in
  the Swup exclusion list since 2.4.3 (its non-standard layout used
  to break the layout on swap-back; cf. v2.4.3 entry). Going there
  is therefore a full reload, which kills audio playback. The persistent
  player restores the playlist from `localStorage` so the previously
  played track stays loaded — but browsers block autoplay without a
  user gesture, so the user has to click play to resume. Working as
  designed; documented for clarity.
- **"Couldn't change pages" intermittent bug**: not reproducible by
  the client. If it surfaces again, the operator can flip the BO
  diagnostic monitor on, capture the log around the failure, and we
  iterate from real telemetry instead of guesses.

## [2.5.1] — 2026-04-29

Two additional client requirements that were previously out-of-scope
brought back into the deliverable: HHV-style play button in the short
description AND Juno-style track list inside the long description.
Both are JS-driven mirrors of the already-rendered playlist (no extra
PHP hook, no theme template edit), so they activate on every product
page automatically when CFG_REPLACE_PAPP_PLAYER is on.

### Added — short description play button (HHV-style)

A small "Écouter" button is injected at the very start of
`.product-description-short` on every product page. Clicking it loads
the product's full playlist into the persistent footer player and
starts at track 0. Shape matches the active skin (rounded grey/dark
in `orp` skin, gradient blue in `papp` skin). Idempotent across Swup
re-runs via `data-orp-bound`.

### Added — long description embedded tracklist (Juno-style)

The `<div class="orp-product-playlist">` rendered by
`hookDisplayProductPlaylistPlugin` is cloned into `.product-description`
(the long description block ZOneTheme renders inside the "Description"
tab in `_partials/product-description.tpl`). The clone wears an extra
class `.orp-product-playlist--in-description` for skin-specific
spacing and is fully wired via the same `wireProductPlaylist()` pass.
State sync (highlighted current row) updates BOTH copies on every
playback state change because `updateProductPlaylistPlayingState()`
walks every `.orp-product-playlist` in the DOM.

### Backwards compatibility

Both injections are gated on `CONFIG.productPlaylistEnabled` (the
config flag passed to JS via `Media::addJsDef` in
`hookDisplayHeader`). Operators who keep `CFG_REPLACE_PAPP_PLAYER` off
see no change — Papp's player remains the only audio source on the
product page.

## [2.5.0] — 2026-04-29

Major release: integrated product-page playlist that **replaces** the
third-party Papp module's MediaElement.js player on product pages.
The integrated playlist transfers playback to our persistent footer
player on click — single audio source, no more overlap, single visual
identity. Off by default for backwards-compat; opt-in via the new BO
toggle.

### Added — integrated product-page playlist

- **New BO toggle `Remplacer le lecteur Papp sur la fiche produit`**
  (config key `ORP_REPLACE_PAPP_PLAYER`, default OFF). When enabled:
  - The third-party `productaudioplaylistplugin` module is unregistered
    from its `displayProductPlaylistPlugin` hook (same hook ZOneTheme
    invokes at `templates/catalog/product.tpl:107`).
  - Our module renders an integrated playlist on that hook with
    per-track play buttons + a "Tout écouter" button.
  - Each play action loads the selected track in the persistent footer
    player and starts playback.
  - The currently-playing row is highlighted in the playlist (synced
    with the persistent player's state on every play/pause/track
    change).
- **New BO radio `Apparence du lecteur intégré`** (config key
  `ORP_PRODUCT_PLAYER_SKIN`):
  - `orp` (default) — modern OnlyRoots style: rounded buttons, accent
    colours from the persistent player palette, subtle hover.
  - `papp` — visual lookalike of the legacy Papp player (gradient grey
    buttons, Arial monospace, alternating row backgrounds). Lets the
    operator transition customers smoothly before flipping to the
    modern look.

### Added — three-layer defence against Papp re-registration

The third-party Papp module can self-re-register on its hook in
several scenarios (cache clear, module reset, manual re-hook in BO →
Module Positions, module update). Three layers prevent it from ever
producing visible HTML while replacement mode is on:

1. **Hook unregister at toggle ON.** `enablePappReplacement()` snapshots
   Papp's current hook position, unregisters it, and registers our
   module on the same hook. The position is stored in
   `ORP_PAPP_HOOK_POSITION` so it can be restored verbatim on toggle
   OFF.
2. **Watcher in `actionAdminControllerInitAfter`.** Every BO admin
   controller init checks whether Papp is back on the hook; if so,
   unhooks it again. Catches all administrative actions (cache clear,
   module update, etc.) on the next admin page load.
3. **File-level override.** A managed file at
   `/override/modules/productaudioplaylistplugin/productaudioplaylistplugin.php`
   short-circuits `ProductAudioPlaylistPlugin::hookDisplayProductPlaylistPlugin`
   to return an empty string while `ORP_REPLACE_PAPP_PLAYER === 1`.
   The file is tagged `@orp-managed` so we never clobber a foreign
   override; `class_index.php` is invalidated on install/uninstall so
   PrestaShop picks up the change without manual cache flush. Belt-and-
   suspenders for the small race window between Papp re-registering
   and the watcher catching it.

Toggle OFF (or module uninstall) reverses every layer: deletes the
override, re-registers Papp on the hook at its original position,
unregisters us, drops the cached Smarty templates.

### New files

- `views/templates/hook/product-playlist.tpl` — integrated playlist
  template (track list + per-track play buttons + "Tout écouter").
- `views/css/product-playlist-skin-orp.css` — modern skin.
- `views/css/product-playlist-skin-papp.css` — legacy Papp lookalike.
- `controllers/front/playlist.php` already exposes the JSON endpoint
  used by the integrated playlist; reused as-is.

### Modified files

- `onlyrootsplayer.php`
  - 4 new config constants + defaults preserved on upgrade
    (`updateValue` only writes when `Configuration::get` returns false).
  - New `hookDisplayProductPlaylistPlugin($params)` handler.
  - Pre-registers our module on `displayProductPlaylistPlugin` at
    install so we're a hook candidate immediately.
  - Conditional registration of skin CSS in
    `hookActionFrontControllerSetMedia`.
  - Extended `actionAdminControllerInitAfter` watcher (layer 2 above).
  - New `Lecteur intégré à la fiche produit` form section in
    `renderForm()` (toggle + skin radio).
  - `postProcess()` calls `enablePappReplacement` /
    `disablePappReplacement` on toggle transition.
  - `uninstall()` always restores Papp's hook.
- `views/js/player.js`
  - New `wireProductPlaylist()` and `loadProductPlaylistAndPlay()` —
    bind click handlers on the integrated playlist, fetch via the
    existing `/module/onlyrootsplayer/playlist` endpoint, hand off to
    the persistent player.
  - `updateProductPlaylistPlayingState()` reflects the persistent
    player's `state.playing / state.productId / state.currentTrack`
    onto the integrated playlist's `.is-playing` row class. Hooked
    into `updateMiniButtons()` so every state change refreshes both.
  - `initProductPage()` now wires the integrated playlist alongside
    its existing "Open in player" button injection. Idempotent across
    Swup re-runs.

### Backwards compatibility

No breaking change. Existing 2.4.x installs upgrade with
`ORP_REPLACE_PAPP_PLAYER = 0` (the install upsert only writes default
values when the key is missing). The integrated playlist, the
override file, and the hook unregister all stay dormant until the
operator flips the toggle in the BO. Operators on a non-Papp shop
see no change.

### Notes

- Out-of-scope client requests (track listing in the product short
  description / per-track play buttons sourced from Discogs metadata)
  are NOT implemented in this release — they're quoted separately.
- The audio-coordination guard added in 2.4.14 (only one `<audio>`
  element audible at any time) remains effective and stacks with the
  hook-replacement approach: even if a non-Papp third-party audio
  source ever appears on a product page, our player still pauses
  itself when that other source starts.

## [2.4.14] — 2026-04-29

Two in-scope bug fixes from operator's client feedback. Other client
requests (play buttons in product description short/long, Discogs
track parsing à la Juno/HHV) are out of the original quote scope and
have been quoted separately.

### Fixed

- **Le son des deux lecteurs sur la page produit se superpose.** On a
  product page, the third-party `productaudioplaylistplugin` module
  renders its own audio UI (`.progression-playlist`) with its own
  `<audio>` elements. Without coordination both could play
  simultaneously and their tracks layered on top of each other.

  Bidirectional `<audio>` pause coordination added in `bindEvents()`:
  - When our player's `<audio>` fires `play`, we walk every other
    `<audio>` element on the page and pause those that are playing.
  - A document-level capture-phase `play` listener pauses our player
    when any non-orp `<audio>` element starts. Capture phase ensures
    we react before any third-party event handlers can fire.

  Net effect: only one audio source is audible at any time, regardless
  of which player triggered playback. Required by the "Intégration
  avec le module audio existant" deliverable in the original quote.

- **Switcher de langue impossible quand un audio joue.** The
  PrestaShop `ps_languageselector` template renders each language link
  with `data-iso-code="..."` and the URLs it generates use the
  query-string form (`/?id_lang=N`) rather than the path-prefix form
  (`/fr/...`) our `ignoreVisit` detects. Swup was therefore trying to
  Swup-swap into them and ended up with a mismatched layout / no
  navigation at all.

  Excluded `[data-iso-code]` from the Swup `linkSelector`. Language
  switcher clicks now produce a normal full reload — the only correct
  behaviour on language change anyway, since the entire shop content
  needs re-rendering in the new locale. Audio stops at the reload (the
  user can press play to resume from localStorage state).

### Out of scope (quoted separately)

The following client requests are not addressed here as they fall
outside the original quote ("Lecteur fixe persistant cross-pages" and
"Bouton play sur accueil et catégories"):

- Track listing in product long description (Juno-style)
- Play button in product short description (HHV-style)
- Per-track play button inside the long description

These would require parsing/persisting Discogs track metadata,
extending the product template, managing per-track audio elements,
and synchronising all of them with the persistent footer player —
roughly equivalent to a second module.

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
