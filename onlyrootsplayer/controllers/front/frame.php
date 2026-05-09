<?php
/**
 * Iframe controller — serves the HTML document loaded inside the
 * persistent `<iframe id="orp-frame">` injected by bridge.js on
 * every front page.
 *
 * v3.0.0-alpha4 design: no Smarty, no template file. The HTML is
 * built directly in PHP via heredoc + variable interpolation.
 * Reasons:
 *   - One fewer fragile dependency (Smarty configuration, theme
 *     overrides, "module:" path resolution, escaping modifiers, etc.)
 *   - Easier to debug: if this controller emits anything, we see
 *     exactly what came out
 *   - No "Smarty fetch failed" 500s
 *
 * Security headers:
 *   - X-Frame-Options: SAMEORIGIN  (only embeddable from same domain)
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: same-origin
 *   - X-Robots-Tag: noindex (don't index this URL)
 *   - Cache-Control: short cache (HTML evolves with deploys)
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

class OnlyrootsplayerFrameModuleFrontController extends ModuleFrontController
{
    public $display_header = false;
    public $display_footer = false;
    public $display_column_left  = false;
    public $display_column_right = false;
    public $ssl  = true;
    public $auth = false;

    public function initContent()
    {
        // Don't call parent::initContent() — we render our own HTML.

        if (!headers_sent()) {
            header('X-Frame-Options: SAMEORIGIN');
            header('X-Content-Type-Options: nosniff');
            header('Referrer-Policy: same-origin');
            header('X-Robots-Tag: noindex, nofollow');
            header('Cache-Control: public, max-age=300');
            header('Content-Type: text/html; charset=utf-8');
        }

        $moduleName = 'onlyrootsplayer';
        $moduleDir  = _PS_MODULE_DIR_ . $moduleName . '/';
        $moduleUri  = __PS_BASE_URI__ . 'modules/' . $moduleName . '/';

        // Versioned URLs for cache-busting after deploys.
        $cssMtime = @filemtime($moduleDir . 'views/css/player.css') ?: time();
        $jsMtime  = @filemtime($moduleDir . 'views/js/iframe-player.js') ?: time();
        $cssUrl   = htmlspecialchars($moduleUri . 'views/css/player.css?v=' . $cssMtime, ENT_QUOTES, 'UTF-8');
        $jsUrl    = htmlspecialchars($moduleUri . 'views/js/iframe-player.js?v=' . $jsMtime, ENT_QUOTES, 'UTF-8');

        $debug = (Configuration::get('ORP_DEBUG_ENABLED') == 1) ? 'true' : 'false';

        // Parent origin for postMessage targetOrigin filtering.
        $parentScheme = Configuration::get('PS_SSL_ENABLED') ? 'https://' : 'http://';
        $parentOrigin = $parentScheme . Tools::getHttpHost(false);
        $parentOriginJs = json_encode($parentOrigin);

        // L10n strings — translate via the module if possible, otherwise
        // fall back to the source string. Either way we json_encode for
        // safe embedding in the inline <script>.
        $module = Module::getInstanceByName($moduleName);
        $tr = function ($source) use ($module) {
            if ($module && method_exists($module, 'trans')) {
                try {
                    return $module->trans($source, [], 'Modules.Onlyrootsplayer.Shop');
                } catch (Exception $e) { /* fallthrough */ }
            }
            return $source;
        };

        $l10n = [
            'play'         => $tr('Lecture / Pause'),
            'playOrPause'  => $tr('Lecture ou pause'),
            'previous'     => $tr('Piste précédente'),
            'next'         => $tr('Piste suivante'),
            'progress'     => $tr('Progression'),
            'volume'       => $tr('Volume'),
            'muteToggle'   => $tr('Couper ou rétablir le son'),
            'close'        => $tr('Fermer'),
            'closePlayer'  => $tr('Fermer le lecteur'),
            'audioPlayer'  => $tr('Lecteur audio'),
        ];
        $l10nJs = json_encode($l10n, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        // HTML-escaped translations for the markup.
        $h = function ($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); };
        $audioPlayer = $h($l10n['audioPlayer']);
        $play        = $h($l10n['play']);
        $playOrPause = $h($l10n['playOrPause']);
        $previous    = $h($l10n['previous']);
        $next        = $h($l10n['next']);
        $progress    = $h($l10n['progress']);
        $volume      = $h($l10n['volume']);
        $muteToggle  = $h($l10n['muteToggle']);
        $close       = $h($l10n['close']);
        $closePlayer = $h($l10n['closePlayer']);

        // Single-line HTML output via heredoc. Indentation kept for
        // readability — browsers don't mind. The structure is identical
        // to v2.5.24's player-footer.tpl: same orp-* classes, same
        // SVG icons, same control layout.
        echo <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <meta name="robots" content="noindex, nofollow">
    <title>OnlyRoots Player</title>
    <link rel="stylesheet" href="{$cssUrl}">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; pointer-events: none; }
        body > * { pointer-events: auto; }
        .orp-player { position: absolute !important; bottom: 0 !important; left: 0 !important; right: 0 !important; }
    </style>
    <script>
        window.onlyrootsPlayerL10n   = {$l10nJs};
        window.onlyrootsPlayerConfig = { parentOrigin: {$parentOriginJs}, debug: {$debug} };
    </script>
</head>
<body>
    <div id="orp-player" class="orp-player" style="display:none;" data-playing="false" role="region" aria-label="{$audioPlayer}">
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
                <button class="orp-btn orp-btn-prev" id="orp-prev" type="button" title="{$previous}" aria-label="{$previous}">
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="2" width="2" height="10" fill="currentColor"/><polygon points="13,2 13,12 5,7" fill="currentColor"/></svg>
                </button>
                <button class="orp-btn orp-btn-play" id="orp-play" type="button" title="{$play}" aria-label="{$playOrPause}">
                    <svg class="orp-icon-play" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><polygon points="4,2 4,14 13,8" fill="currentColor"/></svg>
                    <svg class="orp-icon-pause" width="16" height="16" viewBox="0 0 16 16" style="display:none;" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>
                </button>
                <button class="orp-btn orp-btn-next" id="orp-next" type="button" title="{$next}" aria-label="{$next}">
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
                    <div class="orp-progress-bar" role="slider" aria-label="{$progress}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
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
                <button class="orp-btn orp-btn-vol" id="orp-vol-btn" type="button" title="{$volume}" aria-label="{$muteToggle}">
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
                    <div class="orp-volume-bar" role="slider" aria-label="{$volume}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80" tabindex="0">
                        <div class="orp-volume-fill" id="orp-volume-fill" style="width:80%;"></div>
                    </div>
                </div>
            </div>
            <button class="orp-btn orp-btn-close" id="orp-close" type="button" title="{$close}" aria-label="{$closePlayer}">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
        <audio id="orp-audio" preload="none"></audio>
    </div>
    <script src="{$jsUrl}"></script>
</body>
</html>
HTML;
        exit;
    }
}
