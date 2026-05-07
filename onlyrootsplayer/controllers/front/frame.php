<?php
/**
 * Iframe controller — serves the HTML document loaded inside the
 * persistent `<iframe id="orp-frame">` injected by bridge.js on
 * every front page.
 *
 * Same-origin to the parent shop. Returns plain HTML with the
 * player UI markup + iframe-player.js. By living in its own document
 * the audio survives anything the parent page goes through.
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
    /** @var bool we render the iframe HTML ourselves, no theme wrapper. */
    public $display_header  = false;
    public $display_footer  = false;
    public $display_column_left  = false;
    public $display_column_right = false;
    public $ssl  = true;
    public $auth = false;

    public function initContent()
    {
        // Don't call parent::initContent() — we render our own HTML
        // without the theme layout.

        // Emit security + cache headers before any output.
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

        // Resolve the module instance for translations. Don't throw if
        // not found — just fall back to raw strings.
        $module = Module::getInstanceByName($moduleName);

        $tFn = function ($source) use ($module) {
            if ($module && method_exists($module, 'trans')) {
                try {
                    return $module->trans($source, [], 'Modules.Onlyrootsplayer.Shop');
                } catch (Exception $e) {
                    // fallthrough
                }
            }
            return $source;
        };

        $l10n = [
            'play'         => $tFn('Lecture / Pause'),
            'playOrPause'  => $tFn('Lecture ou pause'),
            'previous'     => $tFn('Piste précédente'),
            'next'         => $tFn('Piste suivante'),
            'progress'     => $tFn('Progression'),
            'volume'       => $tFn('Volume'),
            'muteToggle'   => $tFn('Couper ou rétablir le son'),
            'close'        => $tFn('Fermer'),
            'closePlayer'  => $tFn('Fermer le lecteur'),
            'audioPlayer'  => $tFn('Lecteur audio'),
        ];

        // Versioned URLs for cache-busting after deploys.
        $cssMtime = @filemtime($moduleDir . 'views/css/player.css') ?: time();
        $jsMtime  = @filemtime($moduleDir . 'views/js/iframe-player.js') ?: time();

        $cssUrl = $moduleUri . 'views/css/player.css?v=' . $cssMtime;
        $jsUrl  = $moduleUri . 'views/js/iframe-player.js?v=' . $jsMtime;

        $debug = (Configuration::get('ORP_DEBUG_ENABLED') == 1) ? 'true' : 'false';

        // Parent origin (for postMessage targetOrigin filtering).
        $parentOrigin = (Configuration::get('PS_SSL_ENABLED') ? 'https://' : 'http://')
            . Tools::getHttpHost(false);

        // Hand off to Smarty for the template render.
        $this->context->smarty->assign([
            'orp_l10n'          => $l10n,
            'orp_css_url'       => $cssUrl,
            'orp_js_url'        => $jsUrl,
            'orp_debug'         => $debug,
            'orp_parent_origin' => $parentOrigin,
        ]);

        $tplFsPath = $moduleDir . 'views/templates/front/frame.tpl';
        if (!file_exists($tplFsPath)) {
            // Defensive fallback — shouldn't happen on a normal install.
            echo '<!doctype html><html><body><!-- orp frame template missing --></body></html>';
            exit;
        }

        // Use the `module:` prefix so PrestaShop's Smarty wrapper
        // resolves the template through its standard module template
        // pipeline (handles theme overrides, security, etc.). Passing
        // an absolute filesystem path directly to fetch() can fail on
        // hardened Smarty configurations.
        $tplLogical = 'module:' . $moduleName . '/views/templates/front/frame.tpl';

        try {
            echo $this->context->smarty->fetch($tplLogical);
        } catch (Exception $e) {
            // Last-resort fallback: try the absolute path directly.
            try { echo $this->context->smarty->fetch($tplFsPath); }
            catch (Exception $e2) {
                error_log('[orp/frame] template render failed: ' . $e->getMessage() . ' / ' . $e2->getMessage());
                echo '<!doctype html><html><body><!-- orp frame render error --></body></html>';
            }
        }
        exit;
    }
}
