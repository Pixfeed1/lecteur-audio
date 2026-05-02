# OnlyRoots Persistent Audio Player — v3.0

Cross-page persistent audio player for PrestaShop 8, with the audio
engine isolated in a same-origin iframe. Theme-agnostic. Optional
Turbo SPA layer for seamless navigation.

## Why v3.0 is a rewrite

v2.5.x ran the audio engine inside the parent page. Every theme JS bug,
every third-party AJAX module re-init, every popstate handler in the
wild, every `window.onerror` from a sibling module — all of those could
(and did) trip the audio. The fix history was a chain of 18+ patches:
Swup exclusions for the contact page, popstate killers for ZOneTheme,
syncSidebarColumns guards, AS4 race condition workarounds, etc.

v3.0 ends the fight by construction:

1. **The audio engine lives inside an iframe.** Same origin, but its own
   `window`, its own listeners, its own timers, its own globals. Nothing
   in the parent page can interfere with it; it cannot interfere with
   anything in the parent page.

2. **The parent page only has a small bridge.js.** It discovers product
   cards, injects play buttons, and forwards clicks to the iframe via
   `postMessage`. ~10KB and zero coupling with theme JS.

3. **Turbo (optional) keeps the iframe alive across navigations.** With
   `data-turbo-permanent` on the iframe element, internal navigations
   reuse the same iframe — its document, audio element, and JS state
   all survive intact. Audio truly never cuts on internal links.

## Architecture diagram

```
   ┌──────────────────────────────────┐
   │  PARENT PAGE (PS theme)          │
   │  ┌────────────────────────────┐  │
   │  │  bridge.js (~10KB)         │  │
   │  │  • discover product cards  │  │
   │  │  • inject .orp-card-play   │  │
   │  │  • postMessage to iframe   │  │
   │  └────────────┬───────────────┘  │
   │               │ postMessage      │
   │  ┌────────────▼───────────────┐  │
   │  │  <iframe id="orp-frame"    │  │
   │  │     data-turbo-permanent>  │  │
   │  │  ┌──────────────────────┐  │  │
   │  │  │ player.js (iframe)   │  │  │
   │  │  │ • <audio> element    │  │  │
   │  │  │ • UI rendering       │  │  │
   │  │  │ • localStorage       │  │  │
   │  │  │ • MediaSession API   │  │  │
   │  │  └──────────────────────┘  │  │
   │  └────────────────────────────┘  │
   └──────────────────────────────────┘
```

## File tree

```
onlyrootsplayer/
├── onlyrootsplayer.php                  Main module class (~600 lines)
├── config.xml                           PrestaShop manifest (v3.0.0)
├── README.md                            This file
├── CHANGELOG.md                         History of changes
├── logo.png
│
├── controllers/front/
│   ├── frame.php                        Serves the iframe HTML page
│   ├── playlist.php                     JSON API: tracks per product, batch
│   └── monitor.php                      Optional telemetry endpoint
│
└── views/
    ├── css/
    │   ├── bridge.css                   Parent-side: iframe + .orp-card-play
    │   ├── player.css                   Iframe-side: full player UI (kept from v2.5.18)
    │   ├── product-playlist-skin-orp.css
    │   └── product-playlist-skin-papp.css
    │
    ├── js/
    │   ├── bridge.js                    Parent-side messenger (~10KB)
    │   ├── player.js                    Iframe-side audio engine (~25KB)
    │   ├── monitor.js                   Optional telemetry collector
    │   └── lib/
    │       └── turbo.min.js             Hotwire Turbo 8.0.23 (~98KB)
    │
    └── templates/
        ├── front/frame.tpl              Standalone HTML loaded by iframe
        └── hook/
            ├── frame-injector.tpl       <iframe> injected via displayBeforeBodyClosingTag
            └── product-playlist.tpl     Replaces Papp's MediaElement.js (kept from v2.5.18)
```

## Installation

1. Upload the module folder to `/modules/onlyrootsplayer/` (or install
   the zip via BO → Modules).
2. The dependency `productaudioplaylistplugin` (Papp) MUST be installed
   first — installation is blocked otherwise.
3. After install, go to **Modules → OnlyRoots Player → Configure** and
   review the defaults:
   - **Navigation Turbo (SPA)** — default ON. Disable if you want to
     observe the module in plain reload mode first (audio gap
     ~200-500ms between pages instead of zero).
   - **Sélecteurs des cartes produit** — default matches PS standard.
     Adjust if your theme uses non-standard product card markup.
   - **Ancre du bouton play** — where the play button is inserted
     inside each card. Adjust if the visual placement is wrong.
   - **Remplacer le lecteur produit Papp** — default OFF. Enable if
     you want product pages to use the OnlyRoots playlist that pushes
     tracks into the persistent player instead of Papp's own
     MediaElement.js.

## Compatibility

- PrestaShop **8.0 to 8.99**.
- Required dependency: `productaudioplaylistplugin` (Papp) — provides
  the `papp_audio_playlist` table.
- Theme: theme-agnostic. Tested with ZOneTheme. The defensive
  ZOneTheme popstate guard in bridge.js is harmless on other themes.
- HTTPS required (iframe + postMessage need a stable origin).

## CSP / Cloudflare considerations

If you have a Content-Security-Policy, allow same-origin iframes:

```
frame-src 'self';
child-src 'self';
```

Cloudflare Bot Fight Mode and "Email Address Obfuscation" should be
fine. If you have **Browser Integrity Check** with strict rules, the
`/module/onlyrootsplayer/frame` URL may be flagged — whitelist it.

## Migration from v2.5.x

After upgrading:

1. **Old config keys are dropped** (Swup options, theme presets,
   exclusion list, watchdog ms). Only the new keys remain. They are
   reset to defaults on upgrade — re-configure from the BO if you had
   custom values for `productSelectors`, `buttonAnchor`, or the Papp
   replacement skin.
2. **Clear the PrestaShop cache** (BO → Advanced parameters →
   Performance → Clear cache) so the new asset URLs are picked up.
3. **Hard-refresh the front-office** (Ctrl+Shift+R) to evict the old
   `player.js` from the browser HTTP cache.
4. The Papp hook hijack flag is preserved across upgrade — if you had
   the Papp replacement enabled, it stays enabled.

## Known limitations

- **Audio still cuts on**: login, logout, language switch, currency
  switch, payment-page navigation, hard reload (F5). These trigger a
  full document replacement that no SPA layer can prevent.
- **Without Turbo**: every navigation reloads the iframe. State is
  restored from localStorage in 200-500ms — perceptible but short.
- **Hash-only links** (`#section`) do not reload the iframe.

## Troubleshooting

**Player doesn't show up at all**
- Check that `productaudioplaylistplugin` is installed and enabled.
- Open devtools console — look for `[orp-bridge]` log lines (enable
  debug mode in BO config first).

**Play buttons don't appear in product cards**
- Inspect a product card — does it have a `data-id-product` attribute?
  If not, your theme uses non-standard markup. Adjust **Sélecteurs des
  cartes produit** in BO config.
- Check the network tab for the `/module/onlyrootsplayer/playlist?action=batch`
  request. If it returns `{"products":[]}`, none of the products on
  this page have audio rows in `papp_audio_playlist`.

**Audio cuts on every link click despite Turbo enabled**
- Turbo may be intercepted by another module. Check the console for
  `Turbo.session.drive = false` or similar — some modules disable
  Turbo aggressively.
- Verify `data-turbo-permanent` is still on the `#orp-frame` element
  after a navigation (right-click → Inspect on the iframe).

**iOS: audio doesn't start the first time**
- Mobile Safari requires a user gesture to unlock audio. The bridge
  forwards the first parent-page click as an `unlock` message — but
  some user agents need TWO clicks. Click the play button again.

## Authoring note

This module was rewritten on the explicit understanding that
**isolation, not just persistence, is the real win**. The 18+ patch
chain in v2.5.x was the cost of running shared-realm JS in an
ecosystem hostile to it (theme + AS4 + DiscogsSync + Papp + ZOneTheme
+ etc.). The iframe ends the cohabitation. Future bugs will be in
*one* of those two layers, not in the surface where they meet.

— PixFeed / Marc Gueffie
