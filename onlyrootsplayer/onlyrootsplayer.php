<?php
/**
 * OnlyRoots Persistent Audio Player — v3.0
 *
 * Audio engine isolated in a same-origin iframe. The iframe lives in its
 * own JS context (own window, own listeners, own timers) so it cannot
 * interfere with the theme, third-party modules or PrestaShop core JS,
 * and they cannot interfere with it. Audio plays from inside the iframe
 * and is unaffected by anything happening in the parent document.
 *
 * Two operating modes (BO toggle, default = Turbo ON):
 *   - Turbo ON  : Hotwire Turbo handles navigation; the iframe carries
 *                 `data-turbo-permanent` and survives every nav → audio
 *                 never cuts on internal links.
 *   - Turbo OFF : standard full page reloads; iframe re-loads on every
 *                 nav but state (currentTime, queue, volume) is restored
 *                 from localStorage in ~200-500ms.
 *
 * Architecture summary (see README.md for the full picture):
 *
 *   parent page                          same-origin iframe
 *   ───────────────                      ───────────────────────
 *   bridge.js (small)         ◄─postMsg─► player.js (audio engine)
 *   product-page playlists                player UI (footer markup)
 *   inline play buttons                   <audio> element
 *   Turbo nav (optional)                  MediaSession API
 *   localStorage              ◄─shared──► localStorage
 *
 * Requires the third-party `productaudioplaylistplugin` module which
 * provides the audio data source (table `papp_audio_playlist`).
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @license   Proprietary
 * @version   3.0.11
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class OnlyRootsPlayer extends Module
{
    /* Source module that provides audio files (third-party dependency) */
    const AUDIO_SOURCE_MODULE = 'productaudioplaylistplugin';
    const AUDIO_TABLE         = 'papp_audio_playlist';
    const BATCH_MAX_IDS       = 300;

    /* Configuration keys — kept short, stored in ps_configuration */
    const CFG_TURBO_ENABLED        = 'ORP_TURBO_ENABLED';
    const CFG_PRODUCT_SELECTORS    = 'ORP_PRODUCT_SELECTORS';
    const CFG_BUTTON_ANCHOR        = 'ORP_BUTTON_ANCHOR';
    const CFG_HOVER_PRELOAD        = 'ORP_HOVER_PRELOAD';
    const CFG_DEBUG_ENABLED        = 'ORP_DEBUG_ENABLED';
    const CFG_MONITOR_ENABLED      = 'ORP_MONITOR_ENABLED';
    const CFG_REPLACE_PAPP_PLAYER  = 'ORP_REPLACE_PAPP_PLAYER';
    const CFG_PRODUCT_PLAYER_SKIN  = 'ORP_PRODUCT_PLAYER_SKIN';
    const CFG_PAPP_HOOK_REMOVED    = 'ORP_PAPP_HOOK_REMOVED';
    const CFG_PAPP_HOOK_POSITION   = 'ORP_PAPP_HOOK_POSITION';

    const SKIN_ORP                 = 'orp';
    const SKIN_PAPP                = 'papp';
    const VALID_SKINS              = [self::SKIN_ORP, self::SKIN_PAPP];

    /** Hook the third-party Papp module renders on (case-insensitive in PS). */
    const PAPP_DISPLAY_HOOK        = 'displayProductPlaylistPlugin';

    /* Defaults — written on install, restorable from BO */
    const DEFAULT_PRODUCT_SELECTORS = '.js-product-miniature[data-id-product], .product-miniature[data-id-product], article.product[data-id-product]';
    const DEFAULT_BUTTON_ANCHOR     = '.buttons-sections, .product-list-actions, .product-add-to-cart, .product-buttons';

    public function __construct()
    {
        $this->name             = 'onlyrootsplayer';
        $this->tab              = 'front_office_features';
        $this->version          = '3.0.11';
        $this->author           = 'PixFeed';
        $this->need_instance    = 0;
        $this->bootstrap        = true;
        $this->is_configurable  = 1;

        parent::__construct();

        $this->displayName      = $this->trans(
            'OnlyRoots — Lecteur audio persistant',
            [],
            'Modules.Onlyrootsplayer.Admin'
        );
        $this->description      = $this->trans(
            'Lecteur audio persistant isolé dans une iframe. Compatible n\'importe quel thème PrestaShop 8, sans patch par module tiers. Navigation SPA optionnelle via Turbo.',
            [],
            'Modules.Onlyrootsplayer.Admin'
        );
        $this->confirmUninstall = $this->trans(
            'Désinstaller OnlyRoots Player et supprimer toute sa configuration ?',
            [],
            'Modules.Onlyrootsplayer.Admin'
        );

        $this->ps_versions_compliancy = ['min' => '8.0.0', 'max' => '8.99.99'];
    }

    /* ============================================================ */
    /*  INSTALL / UNINSTALL                                         */
    /* ============================================================ */

    public function install()
    {
        if (!self::audioSourceAvailable()) {
            $this->_errors[] = sprintf(
                $this->trans(
                    'Le module dépendant "%s" est introuvable. Installez-le avant OnlyRoots Player.',
                    [],
                    'Modules.Onlyrootsplayer.Admin'
                ),
                self::AUDIO_SOURCE_MODULE
            );
            return false;
        }

        // Defaults
        Configuration::updateValue(self::CFG_TURBO_ENABLED, 1);
        Configuration::updateValue(self::CFG_PRODUCT_SELECTORS, self::DEFAULT_PRODUCT_SELECTORS);
        Configuration::updateValue(self::CFG_BUTTON_ANCHOR, self::DEFAULT_BUTTON_ANCHOR);
        Configuration::updateValue(self::CFG_HOVER_PRELOAD, 1);
        Configuration::updateValue(self::CFG_DEBUG_ENABLED, 0);
        Configuration::updateValue(self::CFG_MONITOR_ENABLED, 0);
        Configuration::updateValue(self::CFG_REPLACE_PAPP_PLAYER, 0);
        Configuration::updateValue(self::CFG_PRODUCT_PLAYER_SKIN, self::SKIN_ORP);
        Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 0);

        return parent::install()
            // displayBeforeBodyClosingTag injects the iframe at the very
            // bottom of every page — outside the theme footer markup, so
            // theme rules can't disturb it.
            && $this->registerHook('displayBeforeBodyClosingTag')
            && $this->registerHook('displayHeader')
            && $this->registerHook('actionFrontControllerSetMedia')
            // Pre-register on Papp's display hook; we only actually
            // intercept it when CFG_REPLACE_PAPP_PLAYER is enabled.
            && $this->registerHook(self::PAPP_DISPLAY_HOOK);
    }

    public function uninstall()
    {
        // Restore Papp's hook position if we previously hijacked it
        $this->restorePappHookIfHijacked();

        $keys = [
            self::CFG_TURBO_ENABLED,
            self::CFG_PRODUCT_SELECTORS,
            self::CFG_BUTTON_ANCHOR,
            self::CFG_HOVER_PRELOAD,
            self::CFG_DEBUG_ENABLED,
            self::CFG_MONITOR_ENABLED,
            self::CFG_REPLACE_PAPP_PLAYER,
            self::CFG_PRODUCT_PLAYER_SKIN,
            self::CFG_PAPP_HOOK_REMOVED,
            self::CFG_PAPP_HOOK_POSITION,
        ];
        foreach ($keys as $k) {
            Configuration::deleteByName($k);
        }

        return parent::uninstall();
    }

    /* ============================================================ */
    /*  CONFIGURATION (BO)                                          */
    /* ============================================================ */

    public function getContent()
    {
        $output = '';

        if (Tools::isSubmit('submitOnlyRootsPlayer')) {
            Configuration::updateValue(self::CFG_TURBO_ENABLED, (int) Tools::getValue(self::CFG_TURBO_ENABLED));
            Configuration::updateValue(self::CFG_PRODUCT_SELECTORS, trim((string) Tools::getValue(self::CFG_PRODUCT_SELECTORS)));
            Configuration::updateValue(self::CFG_BUTTON_ANCHOR, trim((string) Tools::getValue(self::CFG_BUTTON_ANCHOR)));
            Configuration::updateValue(self::CFG_HOVER_PRELOAD, (int) Tools::getValue(self::CFG_HOVER_PRELOAD));
            Configuration::updateValue(self::CFG_DEBUG_ENABLED, (int) Tools::getValue(self::CFG_DEBUG_ENABLED));
            Configuration::updateValue(self::CFG_MONITOR_ENABLED, (int) Tools::getValue(self::CFG_MONITOR_ENABLED));

            $newReplace = (int) Tools::getValue(self::CFG_REPLACE_PAPP_PLAYER);
            $oldReplace = (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER);
            Configuration::updateValue(self::CFG_REPLACE_PAPP_PLAYER, $newReplace);

            $skin = (string) Tools::getValue(self::CFG_PRODUCT_PLAYER_SKIN);
            if (!in_array($skin, self::VALID_SKINS, true)) {
                $skin = self::SKIN_ORP;
            }
            Configuration::updateValue(self::CFG_PRODUCT_PLAYER_SKIN, $skin);

            // Papp hijack toggling
            if ($newReplace === 1 && $oldReplace !== 1) {
                $this->hijackPappHook();
            } elseif ($newReplace === 0 && $oldReplace === 1) {
                $this->restorePappHookIfHijacked();
            }

            $output .= $this->displayConfirmation($this->trans('Configuration enregistrée.', [], 'Modules.Onlyrootsplayer.Admin'));
        }

        return $output . $this->renderConfigForm();
    }

    private function renderConfigForm()
    {
        $form = [
            'form' => [
                'legend' => [
                    'title' => $this->trans('Configuration', [], 'Modules.Onlyrootsplayer.Admin'),
                    'icon'  => 'icon-cogs',
                ],
                'input' => [
                    [
                        'type'   => 'switch',
                        'label'  => $this->trans('Navigation Turbo (SPA)', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'   => self::CFG_TURBO_ENABLED,
                        'desc'   => $this->trans('Si activé : navigation interne sans rechargement, audio jamais coupé. Si désactivé : full reload + reprise via localStorage (gap ~200-500ms).', [], 'Modules.Onlyrootsplayer.Admin'),
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'turbo_on',  'value' => 1, 'label' => $this->trans('Activé', [], 'Modules.Onlyrootsplayer.Admin')],
                            ['id' => 'turbo_off', 'value' => 0, 'label' => $this->trans('Désactivé', [], 'Modules.Onlyrootsplayer.Admin')],
                        ],
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->trans('Sélecteurs des cartes produit', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'  => self::CFG_PRODUCT_SELECTORS,
                        'desc'  => $this->trans('CSS, séparés par virgules. Le premier qui matche gagne.', [], 'Modules.Onlyrootsplayer.Admin'),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->trans('Ancre du bouton play (dans la carte)', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'  => self::CFG_BUTTON_ANCHOR,
                        'desc'  => $this->trans('CSS, séparés par virgules. Le bouton play est inséré à l\'intérieur du premier match.', [], 'Modules.Onlyrootsplayer.Admin'),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'   => 'switch',
                        'label'  => $this->trans('Préchargement au survol', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'   => self::CFG_HOVER_PRELOAD,
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'hover_on',  'value' => 1, 'label' => $this->trans('Activé', [], 'Modules.Onlyrootsplayer.Admin')],
                            ['id' => 'hover_off', 'value' => 0, 'label' => $this->trans('Désactivé', [], 'Modules.Onlyrootsplayer.Admin')],
                        ],
                    ],
                    [
                        'type'   => 'switch',
                        'label'  => $this->trans('Remplacer le lecteur produit Papp', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'   => self::CFG_REPLACE_PAPP_PLAYER,
                        'desc'   => $this->trans('Si activé : sur les pages produit, le lecteur intégré de Papp est remplacé par la playlist OnlyRoots qui pousse les pistes dans le lecteur persistant.', [], 'Modules.Onlyrootsplayer.Admin'),
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'replace_on',  'value' => 1, 'label' => $this->trans('Activé', [], 'Modules.Onlyrootsplayer.Admin')],
                            ['id' => 'replace_off', 'value' => 0, 'label' => $this->trans('Désactivé', [], 'Modules.Onlyrootsplayer.Admin')],
                        ],
                    ],
                    [
                        'type'    => 'select',
                        'label'   => $this->trans('Skin de la playlist produit', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'    => self::CFG_PRODUCT_PLAYER_SKIN,
                        'options' => [
                            'query' => [
                                ['id' => self::SKIN_ORP,  'name' => 'OnlyRoots (sombre, compact)'],
                                ['id' => self::SKIN_PAPP, 'name' => 'Papp-like (clair, large)'],
                            ],
                            'id'   => 'id',
                            'name' => 'name',
                        ],
                    ],
                    [
                        'type'   => 'switch',
                        'label'  => $this->trans('Télémétrie (monitor.log)', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'   => self::CFG_MONITOR_ENABLED,
                        'desc'   => $this->trans('Logs serveur dans var/monitor.log pour diagnostic. À désactiver en production.', [], 'Modules.Onlyrootsplayer.Admin'),
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'mon_on',  'value' => 1, 'label' => $this->trans('Activé', [], 'Modules.Onlyrootsplayer.Admin')],
                            ['id' => 'mon_off', 'value' => 0, 'label' => $this->trans('Désactivé', [], 'Modules.Onlyrootsplayer.Admin')],
                        ],
                    ],
                    [
                        'type'   => 'switch',
                        'label'  => $this->trans('Mode debug (console JS)', [], 'Modules.Onlyrootsplayer.Admin'),
                        'name'   => self::CFG_DEBUG_ENABLED,
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'dbg_on',  'value' => 1, 'label' => $this->trans('Activé', [], 'Modules.Onlyrootsplayer.Admin')],
                            ['id' => 'dbg_off', 'value' => 0, 'label' => $this->trans('Désactivé', [], 'Modules.Onlyrootsplayer.Admin')],
                        ],
                    ],
                ],
                'submit' => [
                    'title' => $this->trans('Enregistrer', [], 'Modules.Onlyrootsplayer.Admin'),
                ],
            ],
        ];

        $helper = new HelperForm();
        $helper->module                  = $this;
        $helper->name_controller         = $this->name;
        $helper->token                   = Tools::getAdminTokenLite('AdminModules');
        $helper->currentIndex            = AdminController::$currentIndex . '&configure=' . $this->name;
        $helper->submit_action           = 'submitOnlyRootsPlayer';
        $helper->default_form_language   = (int) Configuration::get('PS_LANG_DEFAULT');
        $helper->allow_employee_form_lang = (int) Configuration::get('PS_BO_ALLOW_EMPLOYEE_FORM_LANG');
        $helper->title                   = $this->displayName;
        $helper->show_toolbar            = false;
        $helper->toolbar_scroll          = false;
        $helper->fields_value = [
            self::CFG_TURBO_ENABLED       => (int) Configuration::get(self::CFG_TURBO_ENABLED),
            self::CFG_PRODUCT_SELECTORS   => Configuration::get(self::CFG_PRODUCT_SELECTORS) ?: self::DEFAULT_PRODUCT_SELECTORS,
            self::CFG_BUTTON_ANCHOR       => Configuration::get(self::CFG_BUTTON_ANCHOR) ?: self::DEFAULT_BUTTON_ANCHOR,
            self::CFG_HOVER_PRELOAD       => (int) Configuration::get(self::CFG_HOVER_PRELOAD),
            self::CFG_REPLACE_PAPP_PLAYER => (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER),
            self::CFG_PRODUCT_PLAYER_SKIN => $this->getProductPlayerSkin(),
            self::CFG_MONITOR_ENABLED     => (int) Configuration::get(self::CFG_MONITOR_ENABLED),
            self::CFG_DEBUG_ENABLED       => (int) Configuration::get(self::CFG_DEBUG_ENABLED),
        ];

        return $helper->generateForm([['form' => $form['form']]]);
    }

    /* ============================================================ */
    /*  HOOKS                                                       */
    /* ============================================================ */

    /**
     * Inject parent-side assets:
     *   - bridge.js (parent-side messenger, replaces v2.5.18 zonetheme.js)
     *   - turbo.min.js if Turbo enabled
     *   - product-playlist skin CSS if Papp replacement is on
     *
     * NOTE: the player CSS/JS is NOT registered here. They live inside
     * the iframe (frame.tpl) and are loaded by the iframe's own document.
     */
    public function hookActionFrontControllerSetMedia($params)
    {
        $modulePath = _PS_MODULE_DIR_ . $this->name . '/';

        // Bridge CSS — parent-side styling (iframe states, .orp-card-play btn)
        $this->context->controller->registerStylesheet(
            'onlyrootsplayer-bridge-css',
            'modules/' . $this->name . '/views/css/bridge.css',
            ['media' => 'all', 'priority' => 200, 'version' => $this->fileVersion($modulePath . 'views/css/bridge.css')]
        );

        // Bridge.js — small (~10KB) parent-side messenger
        $this->context->controller->registerJavascript(
            'onlyrootsplayer-bridge',
            'modules/' . $this->name . '/views/js/bridge.js',
            ['position' => 'bottom', 'priority' => 200, 'version' => $this->fileVersion($modulePath . 'views/js/bridge.js')]
        );

        // Swup SPA navigation layer — the iframe needs Swup so internal
        // navigations don't full-reload the page (which would destroy
        // the iframe and cut audio). Loaded in priority order: core,
        // plugins, then init script last.
        $swupAssets = [
            ['onlyrootsplayer-swup',                'views/js/lib/swup.min.js',                190],
            ['onlyrootsplayer-swup-head',           'views/js/lib/swup-head-plugin.min.js',    191],
            ['onlyrootsplayer-swup-body-class',     'views/js/lib/swup-body-class-plugin.min.js', 192],
            ['onlyrootsplayer-swup-scripts',        'views/js/lib/swup-scripts-plugin.min.js', 193],
            ['onlyrootsplayer-swup-preload',        'views/js/lib/swup-preload-plugin.min.js', 194],
        ];
        foreach ($swupAssets as $asset) {
            $this->context->controller->registerJavascript(
                $asset[0],
                'modules/' . $this->name . '/' . $asset[1],
                ['position' => 'bottom', 'priority' => $asset[2], 'version' => $this->fileVersion($modulePath . $asset[1])]
            );
        }
        // Swup init script — runs LAST so the libraries are all loaded.
        $this->context->controller->registerJavascript(
            'onlyrootsplayer-swup-init',
            'modules/' . $this->name . '/views/js/swup-init.js',
            ['position' => 'bottom', 'priority' => 198, 'version' => $this->fileVersion($modulePath . 'views/js/swup-init.js')]
        );

        // Note: Turbo (Hotwire) was an optional layer in 3.0.10 but is
        // dropped in 3.0.10 — Swup (the theme's existing SPA layer)
        // already handles SPA-style navigation, and the iframe survives
        // every Swup swap by virtue of living outside #content-wrapper.

        // Product-playlist skin CSS (parent-side, only when Papp replacement enabled)
        if ((int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) === 1) {
            $skin     = $this->getProductPlayerSkin();
            $skinFile = 'views/css/product-playlist-skin-' . $skin . '.css';
            $skinPath = $modulePath . $skinFile;
            if (file_exists($skinPath)) {
                $this->context->controller->registerStylesheet(
                    'onlyrootsplayer-product-playlist-' . $skin,
                    'modules/' . $this->name . '/' . $skinFile,
                    ['media' => 'all', 'priority' => 205, 'version' => $this->fileVersion($skinPath)]
                );
            }
        }

        // Telemetry monitor (opt-in, off by default in 3.0)
        if ((int) Configuration::get(self::CFG_MONITOR_ENABLED) === 1) {
            $monitorPath = $modulePath . 'views/js/monitor.js';
            if (file_exists($monitorPath)) {
                $this->context->controller->registerJavascript(
                    'onlyrootsplayer-monitor',
                    'modules/' . $this->name . '/views/js/monitor.js',
                    ['position' => 'bottom', 'priority' => 190, 'version' => $this->fileVersion($monitorPath)]
                );
            }
        }
    }

    /**
     * Expose configuration to the parent-side bridge.js via Media::addJsDef.
     * Smaller than v2.5.18: no Swup config, no theme presets, no
     * exclusion list (every page renders the iframe; the iframe decides
     * whether to display the player).
     */
    public function hookDisplayHeader($params)
    {
        Media::addJsDef([
            'onlyrootsPlayerConfig' => [
                'available'        => self::audioSourceAvailable(),
                'frameUrl'         => $this->context->link->getModuleLink($this->name, 'frame'),
                'apiUrl'           => $this->context->link->getModuleLink($this->name, 'playlist'),
                'storageKey'       => 'orp_state_v3',
                'productSelectors' => Configuration::get(self::CFG_PRODUCT_SELECTORS) ?: self::DEFAULT_PRODUCT_SELECTORS,
                'buttonAnchor'     => Configuration::get(self::CFG_BUTTON_ANCHOR) ?: self::DEFAULT_BUTTON_ANCHOR,
                'hoverPreload'     => (int) Configuration::get(self::CFG_HOVER_PRELOAD) === 1,
                'productPlaylistEnabled' => (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) === 1,
                'productPlaylistSkin'    => $this->getProductPlayerSkin(),
                'monitorEnabled'   => (int) Configuration::get(self::CFG_MONITOR_ENABLED) === 1,
                'monitorEndpoint'  => $this->context->link->getModuleLink($this->name, 'monitor'),
                'debug'            => (int) Configuration::get(self::CFG_DEBUG_ENABLED) === 1,
            ],
            'onlyrootsPlayerL10n' => [
                'listenSample'  => $this->trans('Écouter un extrait', [], 'Modules.Onlyrootsplayer.Shop'),
                'listen'        => $this->trans('Écouter', [], 'Modules.Onlyrootsplayer.Shop'),
                'pause'         => $this->trans('Pause', [], 'Modules.Onlyrootsplayer.Shop'),
                'openInPlayer'  => $this->trans('Ouvrir dans le lecteur', [], 'Modules.Onlyrootsplayer.Shop'),
                'openPlaylist'  => $this->trans('Ouvrir cette playlist dans le lecteur persistant', [], 'Modules.Onlyrootsplayer.Shop'),
            ],
        ]);
    }

    /**
     * Inject the iframe at the very bottom of every page.
     *
     * Critical attributes:
     *   - data-turbo-permanent : when Turbo is enabled, this attribute
     *     tells Turbo to preserve the element across navigations
     *     (the iframe's Window/document/audio survive intact, audio
     *     never cuts on internal navigation).
     *   - id="orp-frame"      : referenced by bridge.js + Turbo permanent matching
     *   - allow="autoplay"    : permission policy required for iframes
     *     to autoplay audio after a parent gesture
     *   - aria-hidden until visible
     */
    public function hookDisplayBeforeBodyClosingTag($params)
    {
        if (!self::audioSourceAvailable()) {
            return '';
        }
        $this->context->smarty->assign([
            'orp_frame_url' => $this->context->link->getModuleLink($this->name, 'frame'),
        ]);
        return $this->fetch('module:' . $this->name . '/views/templates/hook/frame-injector.tpl');
    }

    /* ============================================================ */
    /*  PRODUCT PAGE PLAYLIST (replaces Papp's player when enabled) */
    /* ============================================================ */

    public function hookDisplayProductPlaylistPlugin($params)
    {
        if ((int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) !== 1) {
            return '';
        }
        if (!self::audioSourceAvailable()) {
            return '';
        }

        $idProduct = 0;
        if (isset($params['product']) && is_object($params['product'])) {
            $idProduct = (int) $params['product']->id;
        } elseif (isset($params['id_product'])) {
            $idProduct = (int) $params['id_product'];
        } else {
            $idProduct = (int) Tools::getValue('id_product');
        }
        if ($idProduct <= 0) {
            return '';
        }

        $tracks = self::getProductTracks($idProduct);
        if (empty($tracks)) {
            return '';
        }

        $skin = $this->getProductPlayerSkin();
        $this->context->smarty->assign([
            'orp_product_id'           => $idProduct,
            'orp_product_tracks'       => $tracks,
            'orp_playlist_skin'        => $skin,
            'orp_playlist_track_count' => count($tracks),
        ]);

        return $this->fetch('module:' . $this->name . '/views/templates/hook/product-playlist.tpl');
    }

    /**
     * Hijack the Papp display hook so only our renderer fires.
     * Idempotent and safely reversible via restorePappHookIfHijacked().
     */
    private function hijackPappHook()
    {
        $hookId = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
        if ($hookId <= 0) {
            return;
        }
        $idShop = (int) $this->context->shop->id;

        $pappModule = Module::getInstanceByName(self::AUDIO_SOURCE_MODULE);
        if ($pappModule && (int) $pappModule->id > 0) {
            $idPappModule = (int) $pappModule->id;

            // Save Papp's current position so we can restore on uninstall/disable
            $row = Db::getInstance()->getRow(
                'SELECT position FROM ' . _DB_PREFIX_ . 'hook_module
                 WHERE id_hook=' . $hookId . ' AND id_module=' . $idPappModule . ' AND id_shop=' . $idShop
            );
            if ($row && isset($row['position'])) {
                Configuration::updateValue(self::CFG_PAPP_HOOK_POSITION, (int) $row['position']);
            }

            // Unhook Papp from this hook only on this shop
            Db::getInstance()->execute(
                'DELETE FROM ' . _DB_PREFIX_ . 'hook_module
                 WHERE id_hook=' . $hookId . ' AND id_module=' . $idPappModule . ' AND id_shop=' . $idShop
            );
            Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 1);
        }

        // Make sure WE are registered on this hook
        $this->registerHook(self::PAPP_DISPLAY_HOOK);
    }

    private function restorePappHookIfHijacked()
    {
        if ((int) Configuration::get(self::CFG_PAPP_HOOK_REMOVED) !== 1) {
            return;
        }
        $pappModule = Module::getInstanceByName(self::AUDIO_SOURCE_MODULE);
        if (!$pappModule || (int) $pappModule->id <= 0) {
            Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 0);
            return;
        }
        $pappModule->registerHook(self::PAPP_DISPLAY_HOOK);

        $savedPosition = (int) Configuration::get(self::CFG_PAPP_HOOK_POSITION);
        if ($savedPosition > 0) {
            $hookId = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
            $idShop = (int) $this->context->shop->id;
            Db::getInstance()->execute(
                'UPDATE ' . _DB_PREFIX_ . 'hook_module SET position=' . $savedPosition . '
                 WHERE id_hook=' . $hookId . ' AND id_module=' . (int) $pappModule->id . ' AND id_shop=' . $idShop
            );
        }
        Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 0);
    }

    /* ============================================================ */
    /*  HELPERS / DATA LAYER                                        */
    /* ============================================================ */

    public static function audioSourceAvailable()
    {
        return Module::isInstalled(self::AUDIO_SOURCE_MODULE)
            && Module::isEnabled(self::AUDIO_SOURCE_MODULE);
    }

    public function getUploadBaseUrl()
    {
        return Context::getContext()->link->getBaseLink()
            . 'modules/' . self::AUDIO_SOURCE_MODULE . '/upload/';
    }

    public function getProductPlayerSkin()
    {
        $skin = (string) Configuration::get(self::CFG_PRODUCT_PLAYER_SKIN);
        return in_array($skin, self::VALID_SKINS, true) ? $skin : self::SKIN_ORP;
    }

    /**
     * Append filemtime() to asset URLs so the browser hard-refreshes them
     * after edits without needing a full cache wipe. Returns short hex
     * to keep query strings tidy.
     */
    private function fileVersion($path)
    {
        if (!file_exists($path)) {
            return $this->version;
        }
        return $this->version . '.' . dechex((int) filemtime($path));
    }

    public static function getProductTracks($idProduct)
    {
        $idProduct = (int) $idProduct;
        if ($idProduct <= 0 || !self::audioSourceAvailable()) {
            return [];
        }

        $query = new DbQuery();
        $query->select('`papp_audio_filename`, `papp_audio_display_filename`');
        $query->from(self::AUDIO_TABLE);
        $query->where('`product_id` = ' . $idProduct);
        $query->orderBy('`id_papp` ASC');

        $rows = Db::getInstance()->executeS($query);
        if (!$rows) {
            return [];
        }

        $baseUrl = Context::getContext()->link->getBaseLink()
            . 'modules/' . self::AUDIO_SOURCE_MODULE . '/upload/';

        $tracks = [];
        foreach ($rows as $row) {
            $filename = (string) $row['papp_audio_filename'];
            $tracks[] = [
                'filename' => $filename,
                'title'    => (string) $row['papp_audio_display_filename'],
                'url'      => $baseUrl . $idProduct . '/' . rawurlencode($filename),
            ];
        }

        return $tracks;
    }

    public static function getProductsWithAudio(array $productIds)
    {
        if (empty($productIds) || !self::audioSourceAvailable()) {
            return [];
        }

        $ids = array_values(array_unique(array_map('intval', $productIds)));
        $ids = array_filter($ids, function ($v) { return $v > 0; });
        if (count($ids) > self::BATCH_MAX_IDS) {
            $ids = array_slice($ids, 0, self::BATCH_MAX_IDS);
        }
        if (empty($ids)) {
            return [];
        }

        sort($ids);
        $cacheKey = 'orp_with_audio_' . md5(implode(',', $ids));

        if (Cache::isStored($cacheKey)) {
            return (array) Cache::retrieve($cacheKey);
        }

        $query = new DbQuery();
        $query->select('DISTINCT `product_id`');
        $query->from(self::AUDIO_TABLE);
        $query->where('`product_id` IN (' . implode(',', $ids) . ')');

        $rows = Db::getInstance()->executeS($query);

        $result = [];
        if ($rows) {
            foreach ($rows as $row) {
                $result[] = (int) $row['product_id'];
            }
        }

        Cache::store($cacheKey, $result);
        return $result;
    }
}
