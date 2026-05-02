{*
 * OnlyRoots Persistent Audio Player — iframe document
 *
 * This is the standalone HTML page loaded as the <iframe src=>. It runs
 * in its own window/document, fully isolated from the parent page's
 * theme JS, third-party modules, and PrestaShop core.
 *
 * Visual identity is preserved from v2.5.18 — the markup below is a
 * straight copy of views/templates/hook/player-footer.tpl, just wrapped
 * in a minimal <html>/<head>/<body> shell. Same orp-* classes, same
 * SVG icons, same layout, same player.css.
 *
 * @author PixFeed - Marc Gueffie
 *}
<!DOCTYPE html>
<html lang="{$orp_lang_iso|default:'fr'|escape:'html':'UTF-8'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>OnlyRoots Audio Player</title>
<link rel="stylesheet" href="{$orp_css_url|escape:'html':'UTF-8'}">
<style>
/* Iframe-specific rules: transparent body, no scroll, content fills the
   80px slot exposed by the parent iframe. The player.css ships with a
   slide-in animation (translateY(100%) → translateY(0) when
   data-visible="true") that's incompatible with the iframe context —
   inside the iframe the player is the ONLY content, so we want it
   permanently visible. */
html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    height: 100%;
    width: 100%;
    -webkit-tap-highlight-color: transparent;
}
/* Override player.css positioning AND the slide-in transform — fill
   the iframe (80px) fully and stay visible from the moment the iframe
   loads. The !important is necessary because player.css declares the
   same properties at the same specificity level and was loaded first. */
#orp-player.orp-player,
.orp-player {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    transform: none !important;
    transition: none !important;
    box-sizing: border-box;
}
</style>
</head>
<body>

<div id="orp-player" class="orp-player" data-playing="false" role="region" aria-label="{l s='Lecteur audio' d='Modules.Onlyrootsplayer.Shop'}">
    <div class="orp-player-inner">

        <div class="orp-cover" id="orp-cover">
            <div class="orp-cover-placeholder" id="orp-cover-placeholder">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="10" r="9" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" fill="none"/>
                    <circle cx="10" cy="10" r="3" fill="rgba(255,255,255,0.3)"/>
                </svg>
            </div>
            <img id="orp-cover-img" src="" alt="" style="display:none;" />
        </div>

        <div class="orp-controls">
            <button class="orp-btn orp-btn-prev" id="orp-prev" type="button"
                    title="{l s='Piste précédente' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Piste précédente' d='Modules.Onlyrootsplayer.Shop'}">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="2" width="2" height="10" fill="currentColor"/><polygon points="13,2 13,12 5,7" fill="currentColor"/></svg>
            </button>
            <button class="orp-btn orp-btn-play" id="orp-play" type="button"
                    title="{l s='Lecture / Pause' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Lecture ou pause' d='Modules.Onlyrootsplayer.Shop'}">
                <svg class="orp-icon-play" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><polygon points="4,2 4,14 13,8" fill="currentColor"/></svg>
                <svg class="orp-icon-pause" width="16" height="16" viewBox="0 0 16 16" style="display:none;" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>
            </button>
            <button class="orp-btn orp-btn-next" id="orp-next" type="button"
                    title="{l s='Piste suivante' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Piste suivante' d='Modules.Onlyrootsplayer.Shop'}">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><polygon points="1,2 1,12 9,7" fill="currentColor"/><rect x="11" y="2" width="2" height="10" fill="currentColor"/></svg>
            </button>
        </div>

        <div class="orp-info">
            <div class="orp-info-text">
                <a href="#" id="orp-product-link" class="orp-track-name" title="" target="_top">
                    <span id="orp-track-title">-</span>
                </a>
                <span class="orp-track-meta">
                    <span id="orp-product-name">-</span>
                    <span class="orp-track-sep">&middot;</span>
                    <span id="orp-track-counter">0/0</span>
                </span>
            </div>
            <div class="orp-progress-wrap" id="orp-progress-wrap">
                <div class="orp-progress-bar" role="slider" aria-label="{l s='Progression' d='Modules.Onlyrootsplayer.Shop'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
                    <div class="orp-progress-fill" id="orp-progress-fill"></div>
                    <div class="orp-progress-handle" id="orp-progress-handle"></div>
                </div>
                <div class="orp-time">
                    <span id="orp-time-current">0:00</span>
                    <span id="orp-time-total">0:00</span>
                </div>
            </div>
        </div>

        <div class="orp-volume-wrap">
            <button class="orp-btn orp-btn-vol" id="orp-vol-btn" type="button"
                    title="{l s='Volume' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Couper ou rétablir le son' d='Modules.Onlyrootsplayer.Shop'}">
                <svg class="orp-icon-vol-on" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <polygon points="1,5 1,11 4,11 8,14 8,2 4,5" fill="currentColor"/>
                    <path d="M10,5 Q13,8 10,11" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <svg class="orp-icon-vol-off" width="16" height="16" viewBox="0 0 16 16" style="display:none;" aria-hidden="true">
                    <polygon points="1,5 1,11 4,11 8,14 8,2 4,5" fill="currentColor"/>
                    <line x1="10" y1="5" x2="15" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="15" y1="5" x2="10" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
            <div class="orp-volume-bar-wrap" id="orp-volume-wrap">
                <div class="orp-volume-bar" role="slider" aria-label="{l s='Volume' d='Modules.Onlyrootsplayer.Shop'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80" tabindex="0">
                    <div class="orp-volume-fill" id="orp-volume-fill" style="width:80%;"></div>
                </div>
            </div>
        </div>

        <button class="orp-btn orp-btn-close" id="orp-close" type="button"
                title="{l s='Fermer' d='Modules.Onlyrootsplayer.Shop'}"
                aria-label="{l s='Fermer le lecteur' d='Modules.Onlyrootsplayer.Shop'}">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </button>

    </div>

    <audio id="orp-audio" preload="auto"></audio>
</div>

<script>
window.orpFrameConfig = {$orp_config_json nofilter};
</script>
<script src="{$orp_js_url|escape:'html':'UTF-8'}"></script>

</body>
</html>
