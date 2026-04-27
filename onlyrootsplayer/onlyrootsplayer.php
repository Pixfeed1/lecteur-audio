<?php
/**
 * OnlyRoots Persistent Audio Player
 *
 * Persistent cross-page audio player for PrestaShop 8, with optional
 * SPA-style navigation (Swup). Theme-agnostic: every theme-dependent value
 * is exposed in the back-office configuration page.
 *
 * Requires the third-party "productaudioplaylistplugin" module which provides
 * the audio data source (table `papp_audio_playlist`).
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 * @license   Proprietary
 * @version   2.2.0
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

    /* Configuration keys */
    const CFG_SWUP_ENABLED      = 'ORP_SWUP_ENABLED';
    const CFG_SWUP_CONTAINER    = 'ORP_SWUP_CONTAINER';
    const CFG_SWUP_PRELOAD      = 'ORP_SWUP_PRELOAD';
    const CFG_SWUP_IP_WHITELIST = 'ORP_SWUP_IP_WHITELIST';
    const CFG_DEBUG_ENABLED     = 'ORP_DEBUG_ENABLED';
    const CFG_PRODUCT_SELECTORS = 'ORP_PRODUCT_SELECTORS';
    const CFG_BUTTON_ANCHOR     = 'ORP_BUTTON_ANCHOR';
    const CFG_EXTRA_EXCLUDES    = 'ORP_EXTRA_EXCLUDES';
    const CFG_WATCHDOG_MS       = 'ORP_WATCHDOG_MS';
    const CFG_POST_SWAP_JS      = 'ORP_POST_SWAP_JS';

    /* Defaults — written on install, restorable from BO */
    const DEFAULT_CONTAINER         = '#content-wrapper, #content, main, #main';
    const DEFAULT_PRODUCT_SELECTORS = '.js-product-miniature[data-id-product], .product-miniature[data-id-product], article.product[data-id-product]';
    const DEFAULT_BUTTON_ANCHOR     = '.buttons-sections, .product-list-actions, .product-add-to-cart, .product-buttons';
    const DEFAULT_WATCHDOG_MS       = 1500;
    const WATCHDOG_MIN_MS           = 500;
    const WATCHDOG_MAX_MS           = 5000;

    public function __construct()
    {
        $this->name             = 'onlyrootsplayer';
        $this->tab              = 'front_office_features';
        $this->version          = '2.2.0';
        $this->author           = 'PixFeed';
        $this->need_instance    = 0;
        $this->bootstrap        = true;
        $this->is_configurable  = 1;

        parent::__construct();

        $this->displayName      = $this->trans(
            'OnlyRoots — Persistent audio player',
            [],
            'Modules.Onlyrootsplayer.Admin'
        );
        $this->description      = $this->trans(
            'Persistent cross-page audio player with optional SPA navigation. Theme-agnostic for PrestaShop 8 via configurable selectors.',
            [],
            'Modules.Onlyrootsplayer.Admin'
        );
        $this->confirmUninstall = $this->trans(
            'Uninstall OnlyRoots Player and remove all of its configuration?',
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
                    'This module requires the "%s" module to be installed and active.',
                    [self::AUDIO_SOURCE_MODULE],
                    'Modules.Onlyrootsplayer.Admin'
                ),
                self::AUDIO_SOURCE_MODULE
            );
            return false;
        }

        $defaults = [
            self::CFG_SWUP_ENABLED      => 1,
            self::CFG_SWUP_CONTAINER    => self::DEFAULT_CONTAINER,
            self::CFG_SWUP_PRELOAD      => 0,
            self::CFG_SWUP_IP_WHITELIST => '',
            self::CFG_DEBUG_ENABLED     => 0,
            self::CFG_PRODUCT_SELECTORS => self::DEFAULT_PRODUCT_SELECTORS,
            self::CFG_BUTTON_ANCHOR     => self::DEFAULT_BUTTON_ANCHOR,
            self::CFG_EXTRA_EXCLUDES    => '',
            self::CFG_WATCHDOG_MS       => self::DEFAULT_WATCHDOG_MS,
            self::CFG_POST_SWAP_JS      => '',
        ];
        // updateValue is an upsert — existing 2.0.0 installs keep their values,
        // only the new keys (e.g. WATCHDOG_MS) get the default written.
        foreach ($defaults as $key => $val) {
            if (Configuration::get($key) === false) {
                Configuration::updateValue($key, $val);
            }
        }

        return parent::install()
            && $this->registerHook('displayFooter')
            && $this->registerHook('displayHeader')
            && $this->registerHook('actionFrontControllerSetMedia')
            && $this->registerHook('actionObjectPappAudioPlaylistAddAfter')
            && $this->registerHook('actionObjectPappAudioPlaylistUpdateAfter')
            && $this->registerHook('actionObjectPappAudioPlaylistDeleteAfter')
            && $this->registerHook('actionAdminControllerInitAfter');
    }

    public function uninstall()
    {
        $keys = [
            self::CFG_SWUP_ENABLED,
            self::CFG_SWUP_CONTAINER,
            self::CFG_SWUP_PRELOAD,
            self::CFG_SWUP_IP_WHITELIST,
            self::CFG_DEBUG_ENABLED,
            self::CFG_PRODUCT_SELECTORS,
            self::CFG_BUTTON_ANCHOR,
            self::CFG_EXTRA_EXCLUDES,
            self::CFG_WATCHDOG_MS,
            self::CFG_POST_SWAP_JS,
        ];
        foreach ($keys as $k) {
            Configuration::deleteByName($k);
        }
        return parent::uninstall();
    }

    /**
     * Checks whether the audio source module table exists. Result is cached
     * statically for the lifetime of the request — the underlying SHOW TABLES
     * was being issued on every front controller for nothing.
     */
    public static function audioSourceAvailable()
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached;
        }
        $table = _DB_PREFIX_ . self::AUDIO_TABLE;
        $result = Db::getInstance()->executeS(
            'SHOW TABLES LIKE \'' . pSQL($table) . '\'',
            true,
            false
        );
        $cached = !empty($result);
        return $cached;
    }

    /* ============================================================ */
    /*  BACK-OFFICE CONFIGURATION                                   */
    /* ============================================================ */

    public function getContent()
    {
        $output = '';

        if (Tools::isSubmit('submitOrpConfig')) {
            $output .= $this->postProcess();
        }

        if (!self::audioSourceAvailable()) {
            $output .= $this->displayWarning(
                $this->trans(
                    'The audio source module "%s" is not installed or its database table is missing. The player will not display anywhere until that module is active.',
                    [self::AUDIO_SOURCE_MODULE],
                    'Modules.Onlyrootsplayer.Admin'
                )
            );
        }

        return $output . $this->renderForm();
    }

    protected function postProcess()
    {
        $watchdog = (int) Tools::getValue(self::CFG_WATCHDOG_MS);
        if ($watchdog < self::WATCHDOG_MIN_MS || $watchdog > self::WATCHDOG_MAX_MS) {
            $watchdog = self::DEFAULT_WATCHDOG_MS;
        }

        $values = [
            self::CFG_SWUP_ENABLED      => (int) Tools::getValue(self::CFG_SWUP_ENABLED),
            self::CFG_SWUP_CONTAINER    => trim((string) Tools::getValue(self::CFG_SWUP_CONTAINER)),
            self::CFG_SWUP_PRELOAD      => (int) Tools::getValue(self::CFG_SWUP_PRELOAD),
            self::CFG_SWUP_IP_WHITELIST => trim((string) Tools::getValue(self::CFG_SWUP_IP_WHITELIST)),
            self::CFG_DEBUG_ENABLED     => (int) Tools::getValue(self::CFG_DEBUG_ENABLED),
            self::CFG_PRODUCT_SELECTORS => trim((string) Tools::getValue(self::CFG_PRODUCT_SELECTORS)),
            self::CFG_BUTTON_ANCHOR     => trim((string) Tools::getValue(self::CFG_BUTTON_ANCHOR)),
            self::CFG_EXTRA_EXCLUDES    => trim((string) Tools::getValue(self::CFG_EXTRA_EXCLUDES)),
            self::CFG_WATCHDOG_MS       => $watchdog,
            // No trim — preserve indentation/blank lines so the operator's JS
            // remains formatted as authored. Tools::getValue strips slashes
            // already so we only cast to string here.
            self::CFG_POST_SWAP_JS      => (string) Tools::getValue(self::CFG_POST_SWAP_JS),
        ];

        // Restore defaults on empty fields rather than letting the front break
        if ($values[self::CFG_SWUP_CONTAINER] === '') {
            $values[self::CFG_SWUP_CONTAINER] = self::DEFAULT_CONTAINER;
        }
        if ($values[self::CFG_PRODUCT_SELECTORS] === '') {
            $values[self::CFG_PRODUCT_SELECTORS] = self::DEFAULT_PRODUCT_SELECTORS;
        }
        if ($values[self::CFG_BUTTON_ANCHOR] === '') {
            $values[self::CFG_BUTTON_ANCHOR] = self::DEFAULT_BUTTON_ANCHOR;
        }

        foreach ($values as $key => $val) {
            Configuration::updateValue($key, $val);
        }

        return $this->displayConfirmation(
            $this->trans('Settings saved.', [], 'Modules.Onlyrootsplayer.Admin')
        );
    }

    /**
     * Shorthand for the admin translation domain — keeps renderForm() readable.
     */
    private function tAdmin($key, array $params = [])
    {
        return $this->trans($key, $params, 'Modules.Onlyrootsplayer.Admin');
    }

    protected function renderForm()
    {
        $fields = [
            'form' => [
                'legend' => [
                    'title' => $this->tAdmin('OnlyRoots Player — Configuration'),
                    'icon'  => 'icon-cogs',
                ],
                'description' => $this->tAdmin(
                    'All theme-dependent selectors are configurable below. Start with the defaults; only change them if your theme uses different DOM markup.'
                ),
                'input' => [
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Enable SPA navigation (Swup)'),
                        'name'    => self::CFG_SWUP_ENABLED,
                        'desc'    => $this->tAdmin('When enabled, page transitions happen via fetch + DOM replacement, keeping audio playing across navigations. If your theme is incompatible, disable this option — the player still works in standalone mode via localStorage.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'swup_on',  'value' => 1, 'label' => $this->tAdmin('Enabled')],
                            ['id' => 'swup_off', 'value' => 0, 'label' => $this->tAdmin('Disabled')],
                        ],
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Swup container selector(s)'),
                        'name'  => self::CFG_SWUP_CONTAINER,
                        'desc'  => $this->tAdmin(
                            'CSS selector(s) for the main content area to swap during navigation. Multiple comma-separated selectors act as fallbacks (first one that matches and contains a product card wins). Default: %selectors%',
                            ['%selectors%' => self::DEFAULT_CONTAINER]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Product card selector(s)'),
                        'name'  => self::CFG_PRODUCT_SELECTORS,
                        'desc'  => $this->tAdmin(
                            'CSS selector(s) used to find product cards on listings, where the play buttons are injected. The element must carry a [data-id-product] attribute. Default: %selectors%',
                            ['%selectors%' => self::DEFAULT_PRODUCT_SELECTORS]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Play button anchor selector(s)'),
                        'name'  => self::CFG_BUTTON_ANCHOR,
                        'desc'  => $this->tAdmin(
                            'Inside each product card, where to insert the inline play button (next to the cart button). Multiple comma-separated selectors are tried in order; the first match wins per card. If no anchor matches, the module falls back to an overlay button on the product image. Default: %selectors%',
                            ['%selectors%' => self::DEFAULT_BUTTON_ANCHOR]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Preload links on hover (Swup)'),
                        'name'    => self::CFG_SWUP_PRELOAD,
                        'desc'    => $this->tAdmin('Speeds up perceived navigation by preloading pages when the user hovers a link. Slightly increases server load.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'preload_on',  'value' => 1, 'label' => $this->tAdmin('Enabled')],
                            ['id' => 'preload_off', 'value' => 0, 'label' => $this->tAdmin('Disabled')],
                        ],
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Swap watchdog timeout (ms)'),
                        'name'  => self::CFG_WATCHDOG_MS,
                        'desc'  => $this->tAdmin(
                            'After this timeout (in milliseconds), if a Swup swap has updated the URL but not the content, the module forces a full reload. The runtime adapts this value upwards (capped at %max% ms) for slow shops based on the first successful swap. Default: %default% ms.',
                            ['%default%' => (string) self::DEFAULT_WATCHDOG_MS, '%max%' => (string) self::WATCHDOG_MAX_MS]
                        ),
                        'class' => 'fixed-width-md',
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('IP whitelist (preview mode)'),
                        'name'  => self::CFG_SWUP_IP_WHITELIST,
                        'desc'  => $this->tAdmin('If filled, Swup is enabled only for these IPs (IPv4 CIDR supported, comma- or newline-separated). Useful to test SPA navigation in production for staff only. Leave empty to enable Swup for everyone.'),
                        'cols'  => 60,
                        'rows'  => 3,
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('Additional URL exclusion patterns'),
                        'name'  => self::CFG_EXTRA_EXCLUDES,
                        'desc'  => $this->tAdmin('One pattern per line. URLs containing any of these patterns bypass Swup and trigger a full page reload. Standard PrestaShop pages (cart, order, login, my account, etc.) are already excluded automatically — list only additional paths here.'),
                        'cols'  => 60,
                        'rows'  => 4,
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Debug mode'),
                        'name'    => self::CFG_DEBUG_ENABLED,
                        'desc'    => $this->tAdmin('Logs detailed events to the browser console (no server-side logging). Disable in production.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'debug_on',  'value' => 1, 'label' => $this->tAdmin('Enabled')],
                            ['id' => 'debug_off', 'value' => 0, 'label' => $this->tAdmin('Disabled')],
                        ],
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('Custom JS after Swup swap'),
                        'name'  => self::CFG_POST_SWAP_JS,
                        'desc'  => $this->tAdmin('JS executed after each successful Swup swap. Use this to re-initialize theme-specific modules (megamenu, sticky header, swipers, etc.). Runs in the global scope.'),
                        'cols'  => 80,
                        'rows'  => 8,
                    ],
                ],
                'submit' => [
                    'title' => $this->tAdmin('Save'),
                    'name'  => 'submitOrpConfig',
                    'class' => 'btn btn-default pull-right',
                ],
            ],
        ];

        $helper = new HelperForm();
        $helper->show_toolbar       = false;
        $helper->table              = $this->table;
        $helper->module             = $this;
        $helper->default_form_language    = (int) $this->context->language->id;
        $helper->allow_employee_form_lang = (int) Configuration::get('PS_BO_ALLOW_EMPLOYEE_FORM_LANG');
        $helper->identifier         = $this->identifier;
        $helper->submit_action      = 'submitOrpConfig';
        $helper->currentIndex       = $this->context->link->getAdminLink('AdminModules', false)
            . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name;
        $helper->token              = Tools::getAdminTokenLite('AdminModules');
        $helper->tpl_vars           = [
            'fields_value' => $this->getConfigFormValues(),
            'languages'    => $this->context->controller->getLanguages(),
            'id_language'  => $this->context->language->id,
        ];

        return $helper->generateForm([$fields]);
    }

    protected function getConfigFormValues()
    {
        return [
            self::CFG_SWUP_ENABLED      => Configuration::get(self::CFG_SWUP_ENABLED),
            self::CFG_SWUP_CONTAINER    => Configuration::get(self::CFG_SWUP_CONTAINER),
            self::CFG_SWUP_PRELOAD      => Configuration::get(self::CFG_SWUP_PRELOAD),
            self::CFG_SWUP_IP_WHITELIST => Configuration::get(self::CFG_SWUP_IP_WHITELIST),
            self::CFG_DEBUG_ENABLED     => Configuration::get(self::CFG_DEBUG_ENABLED),
            self::CFG_PRODUCT_SELECTORS => Configuration::get(self::CFG_PRODUCT_SELECTORS),
            self::CFG_BUTTON_ANCHOR     => Configuration::get(self::CFG_BUTTON_ANCHOR),
            self::CFG_EXTRA_EXCLUDES    => Configuration::get(self::CFG_EXTRA_EXCLUDES),
            self::CFG_WATCHDOG_MS       => $this->getWatchdogMs(),
            self::CFG_POST_SWAP_JS      => (string) Configuration::get(self::CFG_POST_SWAP_JS),
        ];
    }

    /**
     * Returns the configured watchdog timeout, clamped to [MIN, MAX] and
     * defaulting to DEFAULT_WATCHDOG_MS when unset (compat for 2.0.0 installs
     * that didn't have this key in the database).
     */
    private function getWatchdogMs()
    {
        $stored = Configuration::get(self::CFG_WATCHDOG_MS);
        if ($stored === false || $stored === null || $stored === '') {
            return self::DEFAULT_WATCHDOG_MS;
        }
        $val = (int) $stored;
        if ($val < self::WATCHDOG_MIN_MS || $val > self::WATCHDOG_MAX_MS) {
            return self::DEFAULT_WATCHDOG_MS;
        }
        return $val;
    }

    /* ============================================================ */
    /*  HOOKS                                                       */
    /* ============================================================ */

    public function hookActionFrontControllerSetMedia($params)
    {
        $modulePath = _PS_MODULE_DIR_ . $this->name . '/';

        // CSS — versioned via filemtime to bypass browser cache after edits
        $cssFile = 'modules/' . $this->name . '/views/css/player.css';
        $cssVer  = $this->fileVersion($modulePath . 'views/css/player.css');
        $this->context->controller->registerStylesheet(
            'onlyrootsplayer-css',
            $cssFile,
            ['media' => 'all', 'priority' => 200, 'version' => $cssVer]
        );

        // Swup libs (only if Swup is enabled for this request)
        if ($this->isSwupEnabledForCurrentRequest()) {
            $base = 'modules/' . $this->name . '/views/js/lib/';
            $libs = [
                'onlyroots-swup'           => 'swup.min.js',
                'onlyroots-swup-head'      => 'swup-head-plugin.min.js',
                'onlyroots-swup-scripts'   => 'swup-scripts-plugin.min.js',
                'onlyroots-swup-bodyclass' => 'swup-body-class-plugin.min.js',
                'onlyroots-swup-preload'   => 'swup-preload-plugin.min.js',
            ];
            $priority = 180;
            foreach ($libs as $id => $file) {
                $libVer = $this->fileVersion($modulePath . 'views/js/lib/' . $file);
                $this->context->controller->registerJavascript(
                    $id,
                    $base . $file,
                    ['position' => 'bottom', 'priority' => $priority++, 'version' => $libVer]
                );
            }
        }

        // Player JS
        $jsVer = $this->fileVersion($modulePath . 'views/js/player.js');
        $this->context->controller->registerJavascript(
            'onlyrootsplayer-js',
            'modules/' . $this->name . '/views/js/player.js',
            ['position' => 'bottom', 'priority' => 200, 'version' => $jsVer]
        );
    }

    public function hookDisplayHeader($params)
    {
        $swupEnabled   = $this->isSwupEnabledForCurrentRequest();
        $swupContainer = Configuration::get(self::CFG_SWUP_CONTAINER) ?: self::DEFAULT_CONTAINER;
        $swupPreload   = (int) Configuration::get(self::CFG_SWUP_PRELOAD) === 1;
        $debug         = (int) Configuration::get(self::CFG_DEBUG_ENABLED) === 1;
        $productSel    = Configuration::get(self::CFG_PRODUCT_SELECTORS) ?: self::DEFAULT_PRODUCT_SELECTORS;
        $buttonAnchor  = Configuration::get(self::CFG_BUTTON_ANCHOR) ?: self::DEFAULT_BUTTON_ANCHOR;

        Media::addJsDef([
            'onlyrootsPlayerConfig' => [
                'uploadBaseUrl'    => $this->getUploadBaseUrl(),
                'apiUrl'           => $this->context->link->getModuleLink($this->name, 'playlist'),
                'storageKey'       => 'orp_state_v1',
                'available'        => self::audioSourceAvailable(),
                'swupEnabled'      => $swupEnabled,
                'swupContainer'    => $swupContainer,
                'swupPreload'      => $swupPreload,
                'swupExcludePaths' => $this->getSwupExcludePaths(),
                'productSelectors' => $productSel,
                'buttonAnchor'     => $buttonAnchor,
                'watchdogMs'       => $this->getWatchdogMs(),
                'watchdogMaxMs'    => self::WATCHDOG_MAX_MS,
                'postSwapJs'       => (string) Configuration::get(self::CFG_POST_SWAP_JS),
                'debug'            => $debug,
            ],
            'onlyrootsPlayerL10n' => [
                'listenSample'  => $this->trans('Listen to a sample', [], 'Modules.Onlyrootsplayer.Shop'),
                'listen'        => $this->trans('Listen', [], 'Modules.Onlyrootsplayer.Shop'),
                'pause'         => $this->trans('Pause', [], 'Modules.Onlyrootsplayer.Shop'),
                'openInPlayer'  => $this->trans('Open in player', [], 'Modules.Onlyrootsplayer.Shop'),
                'openPlaylist'  => $this->trans('Open this playlist in the persistent player', [], 'Modules.Onlyrootsplayer.Shop'),
            ],
        ]);
    }

    public function hookDisplayFooter($params)
    {
        if (!self::audioSourceAvailable()) {
            return '';
        }
        return $this->fetch('module:' . $this->name . '/views/templates/hook/player-footer.tpl');
    }

    /* ============================================================ */
    /*  CACHE INVALIDATION                                          */
    /* ============================================================ */

    /**
     * Object lifecycle hooks fired by Papp's ObjectModel-based audio entries.
     * Names follow the actionObject{ClassName}{Add,Update,Delete}After convention.
     * If Papp doesn't expose these (older versions), the AdminController hook
     * below acts as a safety net.
     */
    public function hookActionObjectPappAudioPlaylistAddAfter($params)
    {
        $this->flushAudioCache();
    }

    public function hookActionObjectPappAudioPlaylistUpdateAfter($params)
    {
        $this->flushAudioCache();
    }

    public function hookActionObjectPappAudioPlaylistDeleteAfter($params)
    {
        $this->flushAudioCache();
    }

    /**
     * Fallback: when an admin loads any controller that belongs to the Papp
     * module, invalidate our cache. This catches cases where Papp performs
     * raw SQL operations and never fires actionObjectPappAudioPlaylist*.
     */
    public function hookActionAdminControllerInitAfter($params)
    {
        if (empty($params['controller'])) {
            return;
        }
        $controller = $params['controller'];
        $module = null;
        if (is_object($controller) && property_exists($controller, 'module') && $controller->module) {
            $module = $controller->module;
            if (is_object($module) && isset($module->name)) {
                $module = $module->name;
            }
        }
        if ($module !== self::AUDIO_SOURCE_MODULE) {
            // Also catch by controller class name for non-AdminModuleController flows
            $class = is_object($controller) ? get_class($controller) : '';
            if (stripos($class, 'productaudioplaylistplugin') === false) {
                return;
            }
        }
        $this->flushAudioCache();
    }

    /**
     * Drops every cached `getProductsWithAudio` entry. Cache::clean() accepts
     * shell-style globs in PrestaShop's CacheCore implementation.
     */
    private function flushAudioCache()
    {
        try {
            Cache::clean('orp_with_audio_*');
        } catch (Exception $e) {
            // never let a cache flush failure break an admin save
        }
    }

    /* ============================================================ */
    /*  HELPERS                                                     */
    /* ============================================================ */

    public function getUploadBaseUrl()
    {
        return $this->context->link->getBaseLink() . 'modules/' . self::AUDIO_SOURCE_MODULE . '/upload/';
    }

    /**
     * Returns the list of URL substrings that bypass Swup and trigger a full
     * reload. Built dynamically from PrestaShop's localised page links so the
     * module works on shops in any language without hardcoded French URLs.
     *
     * @return array<string>
     */
    private function getSwupExcludePaths()
    {
        $excludes = [];

        // Built-in PrestaShop pages we never want SPA-loaded (forms, payment,
        // session-sensitive flows). Pulled from Link::getPageLink() so they
        // match whatever URL rewrite + language the shop uses.
        $pageNames = [
            'cart', 'order', 'order-confirmation', 'authentication',
            'identity', 'address', 'addresses', 'history', 'order-follow',
            'order-slip', 'guest-tracking', 'password', 'my-account',
            'discount', 'order-detail', 'module-payment',
        ];
        foreach ($pageNames as $page) {
            try {
                $url = (string) $this->context->link->getPageLink($page, true);
                if ($url === '') continue;
                $path = (string) parse_url($url, PHP_URL_PATH);
                if ($path !== '' && $path !== '/') {
                    $excludes[] = $path;
                }
            } catch (Exception $e) {
                // some virtual pages may throw on certain shop configurations — skip
            }
        }

        // Controller-based exclusions (work regardless of friendly URL settings)
        $excludes[] = 'controller=order';
        $excludes[] = 'controller=cart';
        $excludes[] = 'controller=authentication';
        $excludes[] = 'controller=password';
        $excludes[] = 'controller=my-account';
        $excludes[] = 'controller=identity';
        $excludes[] = 'controller=address';
        $excludes[] = 'controller=history';
        $excludes[] = 'ajax=1';
        $excludes[] = 'ajax=true';
        $excludes[] = 'mylogout=';
        $excludes[] = '/admin';

        // Operator-defined extras from BO config
        $extra = (string) Configuration::get(self::CFG_EXTRA_EXCLUDES);
        if ($extra !== '') {
            $lines = preg_split('/[\r\n]+/', $extra, -1, PREG_SPLIT_NO_EMPTY);
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line !== '') {
                    $excludes[] = $line;
                }
            }
        }

        return array_values(array_unique($excludes));
    }

    /**
     * Whether Swup should be active for the current request, applying both
     * the global toggle and the optional IP whitelist (preview mode).
     */
    private function isSwupEnabledForCurrentRequest()
    {
        if ((int) Configuration::get(self::CFG_SWUP_ENABLED) !== 1) {
            return false;
        }

        $whitelist = trim((string) Configuration::get(self::CFG_SWUP_IP_WHITELIST));
        if ($whitelist === '') {
            return true;
        }

        $clientIp = $this->getClientIp();
        if ($clientIp === '') {
            return false;
        }

        $allowed = preg_split('/[\s,]+/', $whitelist, -1, PREG_SPLIT_NO_EMPTY);
        foreach ($allowed as $ip) {
            if ($this->ipMatches($clientIp, $ip)) {
                return true;
            }
        }
        return false;
    }

    private function getClientIp()
    {
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            return trim($_SERVER['HTTP_CF_CONNECTING_IP']);
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
            return trim($parts[0]);
        }
        if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            return trim($_SERVER['HTTP_X_REAL_IP']);
        }
        return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    }

    private function ipMatches($ip, $pattern)
    {
        if ($ip === $pattern) {
            return true;
        }
        if (strpos($pattern, '/') !== false) {
            list($subnet, $bits) = explode('/', $pattern, 2);
            $bits = (int) $bits;
            if ($bits < 0 || $bits > 32) return false;

            $ipLong     = ip2long($ip);
            $subnetLong = ip2long($subnet);
            if ($ipLong === false || $subnetLong === false) return false;

            $mask = -1 << (32 - $bits);
            return ($ipLong & $mask) === ($subnetLong & $mask);
        }
        return false;
    }

    /**
     * Returns a cache-busting version string for an asset, based on its
     * mtime. Falls back to the module version if the file is missing.
     */
    private function fileVersion($absolutePath)
    {
        return file_exists($absolutePath)
            ? (string) filemtime($absolutePath)
            : (string) $this->version;
    }

    /* ============================================================ */
    /*  DATA API                                                    */
    /* ============================================================ */

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
