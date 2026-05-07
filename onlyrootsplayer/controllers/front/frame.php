<?php
/**
 * Iframe controller — serves the HTML document that lives inside the
 * persistent `<iframe id="orp-frame">` injected on every front page.
 *
 * The iframe carries the audio engine and player UI. It's same-origin
 * with the parent shop, marked `data-swup-persist` (so Swup doesn't
 * touch it on swaps) and positioned `fixed bottom: 0` to overlay the
 * parent. By living in its own document it survives full reloads of
 * the parent (Contact page, language switch, login, etc.) — audio
 * plays uninterrupted regardless of what happens to the parent DOM.
 *
 * Architecture:
 *   parent page                 iframe (this controller)
 *   ───────────                 ─────────────────────────
 *   bridge.js                   iframe-player.js
 *   mini-buttons on cards       <audio> + UI controls
 *        │                              │
 *        └─── postMessage ──────────────┘
 *
 * Security headers:
 *   X-Frame-Options: SAMEORIGIN  (only embeddable from same domain)
 *   X-Content-Type-Options: nosniff
 *   Referrer-Policy: same-origin
 *   Cache-Control: short cache (HTML can update, JS/CSS have own cache)
 *   X-Robots-Tag: noindex (don't index the iframe URL itself)
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

class OnlyrootsplayerFrameModuleFrontController extends ModuleFrontController
{
    /** @var bool we render the iframe HTML ourselves, no theme wrapper */
    public $display_header = false;
    public $display_footer = false;
    public $ssl = true;

    public function init()
    {
        parent::init();

        // Security headers — emit before any output.
        header('X-Frame-Options: SAMEORIGIN');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('X-Robots-Tag: noindex, nofollow');
        header('Cache-Control: public, max-age=300');
        header('Content-Type: text/html; charset=utf-8');
    }

    public function initContent()
    {
        // Don't call parent::initContent() — we render the iframe HTML
        // ourselves without going through the standard theme layout.

        $module = Module::getInstanceByName('onlyrootsplayer');
        if (!$module instanceof OnlyRootsPlayer) {
            exit;
        }

        $modulePath = _PS_MODULE_DIR_ . 'onlyrootsplayer/';
        $moduleUri  = __PS_BASE_URI__ . 'modules/onlyrootsplayer/';

        // Build the L10n payload (matches what player.js expected in 2.5.x).
        $l10n = [
            'play'         => $module->trans('Lecture / Pause', [], 'Modules.Onlyrootsplayer.Shop'),
            'playOrPause'  => $module->trans('Lecture ou pause', [], 'Modules.Onlyrootsplayer.Shop'),
            'previous'     => $module->trans('Piste précédente', [], 'Modules.Onlyrootsplayer.Shop'),
            'next'         => $module->trans('Piste suivante', [], 'Modules.Onlyrootsplayer.Shop'),
            'progress'     => $module->trans('Progression', [], 'Modules.Onlyrootsplayer.Shop'),
            'volume'       => $module->trans('Volume', [], 'Modules.Onlyrootsplayer.Shop'),
            'muteToggle'   => $module->trans('Couper ou rétablir le son', [], 'Modules.Onlyrootsplayer.Shop'),
            'close'        => $module->trans('Fermer', [], 'Modules.Onlyrootsplayer.Shop'),
            'closePlayer'  => $module->trans('Fermer le lecteur', [], 'Modules.Onlyrootsplayer.Shop'),
            'audioPlayer'  => $module->trans('Lecteur audio', [], 'Modules.Onlyrootsplayer.Shop'),
        ];

        $cssVersion = file_exists($modulePath . 'views/css/player.css')
            ? (string) @filemtime($modulePath . 'views/css/player.css')
            : '0';
        $jsVersion  = file_exists($modulePath . 'views/js/iframe-player.js')
            ? (string) @filemtime($modulePath . 'views/js/iframe-player.js')
            : '0';

        $debug    = (int) Configuration::get('ORP_DEBUG_ENABLED') === 1 ? 'true' : 'false';
        $apiBase  = Context::getContext()->link->getModuleLink('onlyrootsplayer', 'playlist', [], true);

        $this->context->smarty->assign([
            'orp_l10n'       => $l10n,
            'orp_css_url'    => $moduleUri . 'views/css/player.css?v=' . $cssVersion,
            'orp_js_url'     => $moduleUri . 'views/js/iframe-player.js?v=' . $jsVersion,
            'orp_api_base'   => $apiBase,
            'orp_debug'      => $debug,
            'orp_parent_origin' => Tools::getHttpHost(true), // 'https://shop.com'
        ]);

        $tpl = $module->getLocalPath() . 'views/templates/front/frame.tpl';
        echo $this->context->smarty->fetch($tpl);
        exit;
    }
}
