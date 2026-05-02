<?php
/**
 * Frame controller — serves the iframe content as a standalone HTML page.
 *
 * This is the document loaded as the <iframe src> on every parent page.
 * It contains the audio engine, the player UI, and lives in its own
 * JS context (own window, own listeners, own timers) so it cannot
 * interfere with the theme or third-party modules, and they cannot
 * interfere with it.
 *
 * Why a custom controller and not a static .html file:
 *   - we need translations (Smarty {l s='...'} tags)
 *   - we need the dynamic audio source base URL (configurable per shop)
 *   - we need the JS config (apiUrl, debug flag, etc.)
 *   - we want HTTP caching headers tuned for the iframe document
 *
 * Security headers:
 *   - X-Frame-Options: SAMEORIGIN  (only embeddable on the same origin)
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: same-origin
 *   - Cache-Control: short-lived (the parent shouldn't have to refetch
 *     this on every nav since data-turbo-permanent keeps the iframe alive,
 *     and on full reloads the browser HTTP cache handles it)
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

class OnlyrootsplayerFrameModuleFrontController extends ModuleFrontController
{
    /** Don't render the theme around our content. */
    public $display_header = false;
    public $display_footer = false;
    public $display_column_left = false;
    public $display_column_right = false;
    public $ssl = true;

    public function init()
    {
        // Skip the parent FrontController init that would normally:
        //  - require an active SSL session
        //  - apply geolocation rerouting
        //  - require theme resolution
        // We only need bare-minimum context (lang, shop, link).
        parent::init();
    }

    public function initContent()
    {
        // We render the iframe HTML ourselves — bypass the standard
        // theme rendering pipeline entirely.
        $this->sendIframeHeaders();
        echo $this->renderFrameHtml();
        exit;
    }

    public function display()
    {
        $this->sendIframeHeaders();
        echo $this->renderFrameHtml();
        exit;
    }

    private function sendIframeHeaders()
    {
        http_response_code(200);
        header('Content-Type: text/html; charset=utf-8');
        // Same-origin only — prevents external sites from embedding our player
        header('X-Frame-Options: SAMEORIGIN');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        // Short browser cache. The iframe document rarely changes; it's
        // mostly the player.js + player.css that get versioned in their
        // own URLs and cache-busted by the file mtime suffix.
        header('Cache-Control: public, max-age=300, must-revalidate');
        // Tell crawlers not to index the iframe URL
        header('X-Robots-Tag: noindex, nofollow');
    }

    private function renderFrameHtml()
    {
        $module = Module::getInstanceByName('onlyrootsplayer');
        if (!$module) {
            return '<!DOCTYPE html><html><body></body></html>';
        }

        $modulePath  = _PS_MODULE_DIR_ . 'onlyrootsplayer/';
        $cssVersion  = $this->shortVersion($modulePath . 'views/css/player.css');
        $jsVersion   = $this->shortVersion($modulePath . 'views/js/player.js');

        $cssUrl = $this->context->link->getBaseLink() . 'modules/onlyrootsplayer/views/css/player.css?v=' . $cssVersion;
        $jsUrl  = $this->context->link->getBaseLink() . 'modules/onlyrootsplayer/views/js/player.js?v=' . $jsVersion;

        $config = [
            'parentOrigin' => $this->getParentOrigin(),
            'apiUrl'       => $this->context->link->getModuleLink('onlyrootsplayer', 'playlist'),
            'storageKey'   => 'orp_state_v3',
            'debug'        => (int) Configuration::get('ORP_DEBUG_ENABLED') === 1,
        ];

        $this->context->smarty->assign([
            'orp_css_url'     => $cssUrl,
            'orp_js_url'      => $jsUrl,
            'orp_config_json' => json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'orp_lang_iso'    => (string) $this->context->language->iso_code,
        ]);

        // Render the standalone iframe HTML page
        return $module->fetch('module:onlyrootsplayer/views/templates/front/frame.tpl');
    }

    /**
     * Returns the origin string (scheme://host[:port]) the parent page
     * is served from. Same-origin iframe → parent and iframe share an
     * origin, so we use the request origin.
     */
    private function getParentOrigin()
    {
        $base = $this->context->link->getBaseLink();
        // getBaseLink() returns "https://example.com/" — strip path
        $parts = parse_url($base);
        if (!$parts || empty($parts['host'])) {
            return '';
        }
        $scheme = isset($parts['scheme']) ? $parts['scheme'] : 'https';
        $host   = $parts['host'];
        $port   = isset($parts['port']) ? ':' . $parts['port'] : '';
        return $scheme . '://' . $host . $port;
    }

    private function shortVersion($path)
    {
        if (!file_exists($path)) {
            return '300';
        }
        return dechex((int) filemtime($path));
    }
}
