{**
 * OnlyRoots Persistent Audio Player — iframe document
 *
 * Standalone HTML document loaded as the src of the persistent
 * <iframe id="orp-frame"> on every front page. This is where the
 * audio engine + player UI actually live, isolated from the parent
 * page's lifecycle.
 *
 * The visible markup is INTENTIONALLY IDENTICAL to v2.5.24's
 * player-footer.tpl (same orp-* classes, same SVG icons, same
 * structure) so the user sees no visual difference.
 *
 * @author PixFeed - Marc Gueffie
 *}
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <meta name="robots" content="noindex, nofollow">
    <title>OnlyRoots Player</title>

    <link rel="stylesheet" href="{$orp_css_url}">

    <style>
        /* iframe-specific overrides: the iframe itself is the fixed slot,
           so the player uses position:absolute inside its own document
           (not fixed). Parent-side bridge.css positions the iframe. */
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: transparent;
            pointer-events: none;
        }
        body > * { pointer-events: auto; }
        .orp-player {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
        }
    </style>

    <script>
        // L10n payload — read by iframe-player.js
        window.onlyrootsPlayerL10n = {$orp_l10n|json_encode nofilter};

        // API base URL (parent's playlist endpoint)
        window.onlyrootsPlayerConfig = {
            apiBase: {$orp_api_base|json_encode nofilter},
            parentOrigin: {$orp_parent_origin|json_encode nofilter},
            debug: {$orp_debug}
        };
    </script>
</head>
<body>

    {* Audio engine + UI — markup identical to v2.5.24 player-footer.tpl,
       wrapped in same orp-player container *}
    <div id="orp-player" class="orp-player" style="display:none;" data-playing="false" role="region" aria-label="{$orp_l10n.audioPlayer|escape:'html':'UTF-8'}">
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
                        title="{$orp_l10n.previous|escape:'html':'UTF-8'}"
                        aria-label="{$orp_l10n.previous|escape:'html':'UTF-8'}">
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="2" width="2" height="10" fill="currentColor"/><polygon points="13,2 13,12 5,7" fill="currentColor"/></svg>
                </button>
                <button class="orp-btn orp-btn-play" id="orp-play" type="button"
                        title="{$orp_l10n.play|escape:'html':'UTF-8'}"
                        aria-label="{$orp_l10n.playOrPause|escape:'html':'UTF-8'}">
                    <svg class="orp-icon-play" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><polygon points="4,2 4,14 13,8" fill="currentColor"/></svg>
                    <svg class="orp-icon-pause" width="16" height="16" viewBox="0 0 16 16" style="display:none;" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>
                </button>
                <button class="orp-btn orp-btn-next" id="orp-next" type="button"
                        title="{$orp_l10n.next|escape:'html':'UTF-8'}"
                        aria-label="{$orp_l10n.next|escape:'html':'UTF-8'}">
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
                    <div class="orp-progress-bar" role="slider" aria-label="{$orp_l10n.progress|escape:'html':'UTF-8'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
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
                        title="{$orp_l10n.volume|escape:'html':'UTF-8'}"
                        aria-label="{$orp_l10n.muteToggle|escape:'html':'UTF-8'}">
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
                    <div class="orp-volume-bar" role="slider" aria-label="{$orp_l10n.volume|escape:'html':'UTF-8'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80" tabindex="0">
                        <div class="orp-volume-fill" id="orp-volume-fill" style="width:80%;"></div>
                    </div>
                </div>
            </div>

            <button class="orp-btn orp-btn-close" id="orp-close" type="button"
                    title="{$orp_l10n.close|escape:'html':'UTF-8'}"
                    aria-label="{$orp_l10n.closePlayer|escape:'html':'UTF-8'}">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>

        </div>

        <audio id="orp-audio" preload="none"></audio>
    </div>

    <script src="{$orp_js_url}"></script>

</body>
</html>
