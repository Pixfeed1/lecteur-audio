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
 * @version   2.5.22
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
    const CFG_THEME_PRESET      = 'ORP_THEME_PRESET';
    const CFG_MONITOR_ENABLED   = 'ORP_MONITOR_ENABLED';
    /* Opt-in toggle to re-include the Contact page in Swup navigation
       (off by default — see CHANGELOG 2.5.4 for the rationale). */
    const CFG_INCLUDE_CONTACT   = 'ORP_INCLUDE_CONTACT';

    /* Integrated product playlist (replaces Papp's own player on product
       pages — see CHANGELOG 2.5.2 for the full rationale). */
    const CFG_REPLACE_PAPP_PLAYER  = 'ORP_REPLACE_PAPP_PLAYER';   // 0|1, default 0
    const CFG_PRODUCT_PLAYER_SKIN  = 'ORP_PRODUCT_PLAYER_SKIN';   // 'orp' | 'papp'
    const CFG_PAPP_HOOK_REMOVED    = 'ORP_PAPP_HOOK_REMOVED';     // internal flag
    const CFG_PAPP_HOOK_POSITION   = 'ORP_PAPP_HOOK_POSITION';    // saved for restore

    const SKIN_ORP                 = 'orp';
    const SKIN_PAPP                = 'papp';
    const VALID_SKINS              = [self::SKIN_ORP, self::SKIN_PAPP];

    /** Hook the third-party Papp module renders on (case-insensitive in PS). */
    const PAPP_DISPLAY_HOOK        = 'displayProductPlaylistPlugin';

    /* Defaults — written on install, restorable from BO */
    const DEFAULT_CONTAINER         = '#content-wrapper, #content, main, #main';
    const DEFAULT_PRODUCT_SELECTORS = '.js-product-miniature[data-id-product], .product-miniature[data-id-product], article.product[data-id-product]';
    const DEFAULT_BUTTON_ANCHOR     = '.buttons-sections, .product-list-actions, .product-add-to-cart, .product-buttons';
    const DEFAULT_WATCHDOG_MS       = 1500;
    const WATCHDOG_MIN_MS           = 500;
    const WATCHDOG_MAX_MS           = 5000;

    /* Theme reinit presets shipped with the module. Each preset name maps to
       views/js/themes/{name}.js which must define
       window.orpThemePresets[name] = function () { ... }. */
    const THEME_PRESET_NONE       = 'none';
    const THEME_PRESET_ZONETHEME  = 'zonetheme';
    const VALID_THEME_PRESETS     = [self::THEME_PRESET_NONE, self::THEME_PRESET_ZONETHEME];

    /* Diagnostic monitor (off by default — opt-in feature for debugging). */
    const MONITOR_LOG_RELPATH       = 'var/monitor.log';
    const MONITOR_LOG_MAX_BYTES     = 1048576; // 1 MiB rotation threshold
    const MONITOR_RATE_LIMIT_WINDOW = 60;       // seconds
    const MONITOR_RATE_LIMIT_MAX    = 30;       // events per window per session
    const MONITOR_EVENT_MAX_LEN     = 4096;     // bytes per single event line

    public function __construct()
    {
        $this->name             = 'onlyrootsplayer';
        $this->tab              = 'front_office_features';
        $this->version          = '2.5.22';
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
            'Lecteur audio persistant cross-pages avec navigation SPA optionnelle. Compatible avec n\'importe quel thème PrestaShop 8 via sélecteurs configurables.',
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
                    'Ce module nécessite que le module « %s » soit installé et actif.',
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
            // SAFE DEFAULT: 'none' until we have a confirmed root cause and
            // staging-validated fix for the v2.5.2 production breakage. Operators
            // on ZOneTheme must opt in via BO after testing in staging with the
            // F12 console open to capture any reinit-related errors.
            self::CFG_THEME_PRESET      => self::THEME_PRESET_NONE,
            self::CFG_MONITOR_ENABLED   => 0,
            // Contact is now INCLUDED in Swup nav by default (changed in
            // v2.5.19). The original v2.4.5 catastrophic-swap on Contact
            // was caused by listener-stacking from contactform / Brevo
            // Chat / captcha inline scripts wiping the `swup-enabled`
            // class on `<html>`. The v2.5.10/2.5.11 IGNORE_SCRIPT_PATTERNS
            // regex now skips those scripts on every swap, so the root
            // cause is neutralised. Audio can finally continue across
            // Contact navigation.
            //
            // If the catastrophic swap somehow re-occurs on a different
            // setup, the watchdog (still armed) catches it and forces a
            // full reload — same behaviour as before this change. So the
            // worst case is identical to the previous default; the best
            // case is "audio continuous on Contact" which is what the
            // operator has been asking for since v2.4.5.
            self::CFG_INCLUDE_CONTACT   => 1,
            // Off by default on upgrades — the operator opts in via BO so
            // we never silently swap out Papp's player on existing installs.
            self::CFG_REPLACE_PAPP_PLAYER => 0,
            self::CFG_PRODUCT_PLAYER_SKIN => self::SKIN_ORP,
            self::CFG_PAPP_HOOK_REMOVED   => 0,
            self::CFG_PAPP_HOOK_POSITION  => 0,
        ];
        // updateValue is an upsert — existing 2.0.0 installs keep their values,
        // only the new keys (e.g. WATCHDOG_MS) get the default written.
        foreach ($defaults as $key => $val) {
            if (Configuration::get($key) === false) {
                Configuration::updateValue($key, $val);
            }
        }

        // Diagnostic monitor needs a writable subdirectory inside the module.
        // Create it on install with an anti-listing index.php so it's safe
        // even if the operator never enables the feature.
        $this->ensureMonitorDirectory();

        return parent::install()
            && $this->registerHook('displayFooter')
            && $this->registerHook('displayHeader')
            && $this->registerHook('actionFrontControllerSetMedia')
            && $this->registerHook('actionObjectPappAudioPlaylistAddAfter')
            && $this->registerHook('actionObjectPappAudioPlaylistUpdateAfter')
            && $this->registerHook('actionObjectPappAudioPlaylistDeleteAfter')
            && $this->registerHook('actionAdminControllerInitAfter')
            // Pre-register on Papp's display hook so we're ready to be
            // invoked there when the operator enables CFG_REPLACE_PAPP_PLAYER.
            // Idempotent: registering twice is a no-op.
            && $this->registerHook(self::PAPP_DISPLAY_HOOK);
    }

    public function uninstall()
    {
        // CRITICAL: restore Papp's own hook before we vanish, otherwise the
        // shop is left with an unhooked third-party module and no integrated
        // playlist (since we're being removed). Same call we use when the
        // operator toggles CFG_REPLACE_PAPP_PLAYER off in the BO.
        try {
            $this->disablePappReplacement();
        } catch (Exception $e) {
            // Never block the uninstall on a hook restore — log and move on.
        }

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
            self::CFG_THEME_PRESET,
            self::CFG_MONITOR_ENABLED,
            self::CFG_INCLUDE_CONTACT,
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

        // Monitor maintenance actions are processed BEFORE the panel renders
        // so the panel reflects the post-action state on the same page load.
        if (Tools::isSubmit('submitOrpClearMonitorLog')) {
            if ($this->clearMonitorLog()) {
                $output .= $this->displayConfirmation(
                    $this->tAdmin('Log de diagnostic vidé.')
                );
            } else {
                $output .= $this->displayError(
                    $this->tAdmin('Impossible de vider le log (vérifier les permissions sur var/monitor.log).')
                );
            }
        }
        if (Tools::isSubmit('submitOrpDownloadMonitorLog')) {
            $this->downloadMonitorLog();
            // downloadMonitorLog() exits — execution never reaches here.
        }

        if (Tools::isSubmit('submitOrpConfig')) {
            $output .= $this->postProcess();
        }

        if (!self::audioSourceAvailable()) {
            $output .= $this->displayWarning(
                $this->trans(
                    'Le module source audio « %s » n\'est pas installé ou sa table de base de données est manquante. Le lecteur ne s\'affichera nulle part tant que ce module ne sera pas actif.',
                    [self::AUDIO_SOURCE_MODULE],
                    'Modules.Onlyrootsplayer.Admin'
                )
            );
        }

        return $output . $this->renderMonitorPanel() . $this->renderForm();
    }

    /**
     * Renders the diagnostic panel (read-only log view + clear/download
     * buttons). Shown above the configuration form. Always visible — the
     * monitor is opt-in via the form switch, but operators can read past
     * captures or download a log even after disabling the monitor.
     */
    private function renderMonitorPanel()
    {
        $log     = $this->readMonitorLog();
        $logSafe = htmlspecialchars($log, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $size    = strlen($log);
        $sizeKb  = number_format($size / 1024, 1);

        $heading = htmlspecialchars(
            $this->tAdmin('Diagnostic — Moniteur d\'événements'),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $blurb = htmlspecialchars(
            $this->tAdmin(
                'Les événements collectés par le moniteur (erreurs JS, hooks Swup, diffs DOM) sont écrits dans var/monitor.log et affichés ci-dessous (du plus ancien au plus récent). Activez le moniteur dans le formulaire de configuration ci-dessous pour démarrer la collecte.'
            ),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $sizeLabel  = htmlspecialchars(
            sprintf($this->tAdmin('Taille actuelle : %s Ko (plafond : 1024 Ko avant rotation).'), $sizeKb),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $emptyLabel = htmlspecialchars(
            $this->tAdmin('— log vide —'),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $clearLabel = htmlspecialchars(
            $this->tAdmin('Vider le log'),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $downloadLabel = htmlspecialchars(
            $this->tAdmin('Télécharger le log'),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        $confirmClear = htmlspecialchars(
            $this->tAdmin('Vider le log de diagnostic ?'),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );

        // getAdminLink(..., true) appends the admin token. Without it, PrestaShop's
        // CSRF middleware rejects the POST with a "CLÉ DE SÉCURITÉ INVALIDE"
        // page (observed in v2.5.2 production when an operator clicked
        // "Vider le log").
        $action = htmlspecialchars(
            $this->context->link->getAdminLink('AdminModules', true)
                . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name,
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );

        $logHtml = $log === ''
            ? '<em>' . $emptyLabel . '</em>'
            : '<pre style="max-height:340px;overflow:auto;background:#f8f8f8;border:1px solid #ddd;padding:10px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;">'
                . $logSafe . '</pre>';

        return '<div class="panel" style="margin-bottom:16px;">'
            . '<div class="panel-heading"><i class="icon-stethoscope"></i> ' . $heading . '</div>'
            . '<p>' . $blurb . '</p>'
            . '<p style="color:#666;font-size:12px;">' . $sizeLabel . '</p>'
            . $logHtml
            . '<form method="post" action="' . $action . '" style="margin-top:10px;display:inline-block;" onsubmit="return confirm(\'' . $confirmClear . '\');">'
            . '<button type="submit" name="submitOrpClearMonitorLog" class="btn btn-default"><i class="icon-trash"></i> ' . $clearLabel . '</button>'
            . '</form>'
            . ' <form method="post" action="' . $action . '" style="margin-top:10px;display:inline-block;">'
            . '<button type="submit" name="submitOrpDownloadMonitorLog" class="btn btn-default"><i class="icon-download"></i> ' . $downloadLabel . '</button>'
            . '</form>'
            . '</div>';
    }

    /**
     * Streams the monitor log file as an attachment. Exits the request — the
     * caller must not produce any further output.
     */
    private function downloadMonitorLog()
    {
        $log = $this->readMonitorLog();
        $filename = 'orp-monitor-' . date('Ymd-His') . '.log';

        // Discard whatever buffering PrestaShop has set up so the binary
        // payload reaches the browser cleanly.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($log));
        header('Cache-Control: no-store');
        echo $log;
        exit;
    }

    protected function postProcess()
    {
        $watchdog = (int) Tools::getValue(self::CFG_WATCHDOG_MS);
        if ($watchdog < self::WATCHDOG_MIN_MS || $watchdog > self::WATCHDOG_MAX_MS) {
            $watchdog = self::DEFAULT_WATCHDOG_MS;
        }

        $skinIn = (string) Tools::getValue(self::CFG_PRODUCT_PLAYER_SKIN);
        $skin   = in_array($skinIn, self::VALID_SKINS, true) ? $skinIn : self::SKIN_ORP;

        $newReplaceFlag = (int) Tools::getValue(self::CFG_REPLACE_PAPP_PLAYER);
        $oldReplaceFlag = (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER);

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
            self::CFG_THEME_PRESET      => $this->sanitizeThemePreset(Tools::getValue(self::CFG_THEME_PRESET)),
            self::CFG_MONITOR_ENABLED   => (int) Tools::getValue(self::CFG_MONITOR_ENABLED),
            self::CFG_INCLUDE_CONTACT   => (int) Tools::getValue(self::CFG_INCLUDE_CONTACT),
            self::CFG_REPLACE_PAPP_PLAYER => $newReplaceFlag,
            self::CFG_PRODUCT_PLAYER_SKIN => $skin,
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

        // React to a transition of the Papp-replacement toggle. Doing this
        // after the bulk Configuration::updateValue loop means our helpers
        // see the new flag value when they read Configuration::get inside.
        if ($newReplaceFlag !== $oldReplaceFlag) {
            try {
                if ($newReplaceFlag === 1) {
                    $this->enablePappReplacement();
                } else {
                    $this->disablePappReplacement();
                }
            } catch (Exception $e) {
                return $this->displayError(
                    $this->trans(
                        'Paramètres enregistrés, mais une erreur est survenue lors de l\'application du remplacement du lecteur Papp : %error%',
                        ['%error%' => $e->getMessage()],
                        'Modules.Onlyrootsplayer.Admin'
                    )
                );
            }
        }

        return $this->displayConfirmation(
            $this->trans('Paramètres enregistrés.', [], 'Modules.Onlyrootsplayer.Admin')
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
                    'Tous les sélecteurs dépendants du thème sont configurables ci-dessous. Utilisez d\'abord les valeurs par défaut ; ne les modifiez que si votre thème utilise un balisage DOM différent.'
                ),
                'input' => [
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Activer la navigation SPA (Swup)'),
                        'name'    => self::CFG_SWUP_ENABLED,
                        'desc'    => $this->tAdmin('Quand activé, les transitions entre pages se font via fetch + remplacement DOM, en gardant l\'audio en lecture pendant les navigations. Si votre thème est incompatible, désactivez cette option — le lecteur continue de fonctionner en mode autonome via localStorage.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'swup_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'swup_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Sélecteur(s) du conteneur Swup'),
                        'name'  => self::CFG_SWUP_CONTAINER,
                        'desc'  => $this->tAdmin(
                            'Sélecteur(s) CSS de la zone de contenu principale à remplacer pendant la navigation. Plusieurs sélecteurs séparés par des virgules servent de fallback (le premier qui matche ET qui contient une fiche produit gagne). Défaut : %selectors%',
                            ['%selectors%' => self::DEFAULT_CONTAINER]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Sélecteur(s) des fiches produit'),
                        'name'  => self::CFG_PRODUCT_SELECTORS,
                        'desc'  => $this->tAdmin(
                            'Sélecteur(s) CSS utilisés pour trouver les fiches produit sur les listings, où sont injectés les boutons play. L\'élément doit porter un attribut [data-id-product]. Défaut : %selectors%',
                            ['%selectors%' => self::DEFAULT_PRODUCT_SELECTORS]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Sélecteur(s) d\'ancrage du bouton play'),
                        'name'  => self::CFG_BUTTON_ANCHOR,
                        'desc'  => $this->tAdmin(
                            'Dans chaque fiche produit, où placer le bouton play inline (à côté du bouton panier). Plusieurs sélecteurs séparés par des virgules sont testés dans l\'ordre ; le premier qui matche gagne pour chaque fiche. Si aucun ancrage n\'est trouvé, le module retombe en fallback sur un bouton en overlay sur l\'image produit. Défaut : %selectors%',
                            ['%selectors%' => self::DEFAULT_BUTTON_ANCHOR]
                        ),
                        'class' => 'fixed-width-xxl',
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Précharger les liens au survol (Swup)'),
                        'name'    => self::CFG_SWUP_PRELOAD,
                        'desc'    => $this->tAdmin('Accélère la navigation perçue en préchargeant les pages quand l\'utilisateur survole un lien. Augmente légèrement la charge serveur.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'preload_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'preload_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->tAdmin('Délai du watchdog de swap (ms)'),
                        'name'  => self::CFG_WATCHDOG_MS,
                        'desc'  => $this->tAdmin(
                            'Au-delà de ce délai (en millisecondes), si un swap Swup a changé l\'URL mais pas le contenu, le module force un rechargement complet. Le runtime ajuste cette valeur à la hausse (plafonnée à %max% ms) pour les boutiques lentes en fonction du premier swap réussi. Défaut : %default% ms.',
                            ['%default%' => (string) self::DEFAULT_WATCHDOG_MS, '%max%' => (string) self::WATCHDOG_MAX_MS]
                        ),
                        'class' => 'fixed-width-md',
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('Whitelist d\'IPs (mode preview)'),
                        'name'  => self::CFG_SWUP_IP_WHITELIST,
                        'desc'  => $this->tAdmin('Si rempli, Swup n\'est activé que pour ces IPs (CIDR IPv4 supporté, séparées par virgules ou retours à la ligne). Utile pour tester la navigation SPA en production pour le staff uniquement. Laissez vide pour activer Swup pour tout le monde.'),
                        'cols'  => 60,
                        'rows'  => 3,
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('Motifs d\'exclusion d\'URL supplémentaires'),
                        'name'  => self::CFG_EXTRA_EXCLUDES,
                        'desc'  => $this->tAdmin('Un motif par ligne. Les URLs contenant l\'un de ces motifs court-circuitent Swup et déclenchent un rechargement complet de la page. Les pages PrestaShop standard (panier, commande, connexion, mon compte, etc.) sont déjà exclues automatiquement — listez ici uniquement les chemins additionnels.'),
                        'cols'  => 60,
                        'rows'  => 4,
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Inclure la page Contact dans la navigation Swup'),
                        'name'    => self::CFG_INCLUDE_CONTACT,
                        'desc'    => $this->tAdmin('OPT-IN — par défaut désactivé. Quand activé, la page Contact est navigable via Swup et l\'audio continue à jouer pendant la transition (au lieu d\'un rechargement complet qui interrompt la lecture). Le layout du thème ZOneTheme est compatible (mêmes conteneurs #content-wrapper / #content que les autres pages), mais un module tiers monté sur la page Contact (formulaire, captcha, chat) peut casser le swap. Le watchdog et le détecteur de catastrophic swap restent actifs : si un échec est détecté, la page est rechargée intégralement automatiquement. À activer prudemment et à tester en staging.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'include_contact_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'include_contact_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Mode debug'),
                        'name'    => self::CFG_DEBUG_ENABLED,
                        'desc'    => $this->tAdmin('Logge les événements détaillés dans la console du navigateur (aucun log côté serveur). À désactiver en production.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'debug_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'debug_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Moniteur diagnostique'),
                        'name'    => self::CFG_MONITOR_ENABLED,
                        'desc'    => $this->tAdmin('Active la collecte d\'événements de diagnostic côté front (erreurs JS, hooks Swup, anomalies DOM avant/après chaque swap) et leur écriture dans var/monitor.log. Le log est plafonné à 1 Mo et rotaté automatiquement. À activer pour investigation en staging — laisser désactivé en production sauf besoin spécifique. Le contenu du log s\'affiche dans la section « Diagnostic » au-dessus de ce formulaire.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'monitor_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'monitor_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'    => 'select',
                        'label'   => $this->tAdmin('Preset de réinit thème'),
                        'name'    => self::CFG_THEME_PRESET,
                        'desc'    => $this->tAdmin('Code de réinitialisation thème exécuté après chaque swap Swup. « ZOneTheme » charge un script bundlé qui ré-attache les listeners du megamenu, sidebars, sticky header et scroll-to-top. « Aucun » laisse le module purement theme-agnostic. Si vous avez besoin d\'ajouter du code custom en plus du preset, utilisez le champ « JS personnalisé » ci-dessous.'),
                        'options' => [
                            'query' => [
                                ['id' => self::THEME_PRESET_NONE,      'name' => $this->tAdmin('Aucun (theme-agnostic)')],
                                ['id' => self::THEME_PRESET_ZONETHEME, 'name' => $this->tAdmin('ZOneTheme (OnlyRoots Reggae)')],
                            ],
                            'id'   => 'id',
                            'name' => 'name',
                        ],
                    ],
                    [
                        'type'  => 'textarea',
                        'label' => $this->tAdmin('JS personnalisé après swap Swup'),
                        'name'  => self::CFG_POST_SWAP_JS,
                        'desc'  => $this->tAdmin('JS additionnel exécuté APRÈS le preset thème ci-dessus. Utile pour des besoins spécifiques (tracking custom, modules tiers, etc.). Laisser vide si le preset suffit. S\'exécute dans la portée globale.'),
                        'cols'  => 80,
                        'rows'  => 8,
                    ],
                    [
                        'type'    => 'switch',
                        'label'   => $this->tAdmin('Remplacer le lecteur Papp sur la fiche produit'),
                        'name'    => self::CFG_REPLACE_PAPP_PLAYER,
                        'desc'    => $this->tAdmin('Quand activé, le lecteur du module « productaudioplaylistplugin » est désenregistré du hook displayProductPlaylistPlugin et remplacé par notre lecteur intégré (liste de pistes + bouton play par piste, qui transfèrent la lecture dans le lecteur persistant en bas de page). Désactivable à tout moment : Papp est ré-enregistré à sa position d\'origine.'),
                        'is_bool' => true,
                        'values'  => [
                            ['id' => 'replace_papp_on',  'value' => 1, 'label' => $this->tAdmin('Activé')],
                            ['id' => 'replace_papp_off', 'value' => 0, 'label' => $this->tAdmin('Désactivé')],
                        ],
                    ],
                    [
                        'type'    => 'radio',
                        'label'   => $this->tAdmin('Apparence du lecteur intégré'),
                        'name'    => self::CFG_PRODUCT_PLAYER_SKIN,
                        'desc'    => $this->tAdmin('Choisissez le style visuel du lecteur intégré sur la fiche produit. Le mode « Classique » reproduit l\'apparence de l\'ancien lecteur Papp pour une transition invisible côté client.'),
                        'values'  => [
                            ['id' => 'skin_orp',  'value' => self::SKIN_ORP,  'label' => $this->tAdmin('Moderne (style OnlyRoots)')],
                            ['id' => 'skin_papp', 'value' => self::SKIN_PAPP, 'label' => $this->tAdmin('Classique (style ancien lecteur Papp)')],
                        ],
                    ],
                ],
                'submit' => [
                    'title' => $this->tAdmin('Enregistrer'),
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
            self::CFG_THEME_PRESET      => $this->getThemePreset(),
            self::CFG_MONITOR_ENABLED   => (int) Configuration::get(self::CFG_MONITOR_ENABLED),
            self::CFG_INCLUDE_CONTACT   => (int) Configuration::get(self::CFG_INCLUDE_CONTACT),
            self::CFG_REPLACE_PAPP_PLAYER => (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER),
            self::CFG_PRODUCT_PLAYER_SKIN => $this->getProductPlayerSkin(),
        ];
    }

    /**
     * Returns the configured product-page playlist skin, defaulting to
     * SKIN_ORP and clamped to VALID_SKINS.
     */
    private function getProductPlayerSkin()
    {
        $stored = (string) Configuration::get(self::CFG_PRODUCT_PLAYER_SKIN);
        return in_array($stored, self::VALID_SKINS, true) ? $stored : self::SKIN_ORP;
    }

    /* ============================================================ */
    /*  DIAGNOSTIC MONITOR HELPERS                                  */
    /* ============================================================ */

    /**
     * Absolute filesystem path to the monitor log file. Always inside the
     * module directory so backups, file permissions, and module-uninstall
     * cleanups all behave predictably.
     */
    private function getMonitorLogPath()
    {
        return _PS_MODULE_DIR_ . $this->name . '/' . self::MONITOR_LOG_RELPATH;
    }

    /**
     * Creates `var/` inside the module on install, drops an anti-listing
     * index.php and an empty log file. Idempotent — safe to call on
     * subsequent installs.
     */
    private function ensureMonitorDirectory()
    {
        $dir = _PS_MODULE_DIR_ . $this->name . '/var';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $indexPath = $dir . '/index.php';
        if (!is_file($indexPath)) {
            // Same anti-listing pattern as every other module subdirectory.
            $stub = "<?php\nheader('Location: ../');\nexit;\n";
            @file_put_contents($indexPath, $stub);
        }

        $logPath = $this->getMonitorLogPath();
        if (!is_file($logPath)) {
            @file_put_contents($logPath, '');
            @chmod($logPath, 0644);
        }
    }

    /**
     * Reads the monitor log, capped at the last MONITOR_LOG_MAX_BYTES bytes.
     * Returns '' if the file is missing or unreadable.
     */
    public function readMonitorLog()
    {
        $path = $this->getMonitorLogPath();
        if (!is_file($path) || !is_readable($path)) {
            return '';
        }
        $content = @file_get_contents($path);
        return $content === false ? '' : $content;
    }

    /**
     * Truncates the monitor log to zero bytes. Returns true on success.
     */
    public function clearMonitorLog()
    {
        $path = $this->getMonitorLogPath();
        if (!is_file($path)) {
            $this->ensureMonitorDirectory();
            return true;
        }
        return @file_put_contents($path, '') !== false;
    }

    /**
     * Validates a theme preset name against the whitelist. Falls back to
     * 'none' for any unknown value — never trust raw $_POST.
     */
    private function sanitizeThemePreset($value)
    {
        $value = (string) $value;
        return in_array($value, self::VALID_THEME_PRESETS, true)
            ? $value
            : self::THEME_PRESET_NONE;
    }

    /**
     * Returns the currently-configured theme preset, defaulting to 'none'
     * for installs upgrading from versions that didn't have this key.
     */
    private function getThemePreset()
    {
        $stored = Configuration::get(self::CFG_THEME_PRESET);
        if ($stored === false || $stored === null || $stored === '') {
            return self::THEME_PRESET_NONE;
        }
        return $this->sanitizeThemePreset($stored);
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

        // Skin CSS for the integrated product-page playlist — only when the
        // operator has enabled the Papp replacement mode AND we're rendering
        // the playlist. We register on every front page (not just product
        // pages) because Swup's content swap brings the playlist markup
        // into the same DOM that the initial-load <head> sees.
        if ((int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) === 1) {
            $skin       = $this->getProductPlayerSkin();
            $skinFile   = 'views/css/product-playlist-skin-' . $skin . '.css';
            $skinPath   = $modulePath . $skinFile;
            if (file_exists($skinPath)) {
                $this->context->controller->registerStylesheet(
                    'onlyrootsplayer-product-playlist-' . $skin,
                    'modules/' . $this->name . '/' . $skinFile,
                    ['media' => 'all', 'priority' => 205, 'version' => $this->fileVersion($skinPath)]
                );
            }
        }

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

        // Theme reinit preset (registered BEFORE player.js so the preset
        // function is defined on `window.orpThemePresets` by the time the
        // player's content:replace hook runs and wants to call it).
        $preset = $this->getThemePreset();
        if ($preset !== self::THEME_PRESET_NONE) {
            $presetRel  = 'views/js/themes/' . $preset . '.js';
            $presetPath = $modulePath . $presetRel;
            if (file_exists($presetPath)) {
                $this->context->controller->registerJavascript(
                    'onlyrootsplayer-theme-' . $preset,
                    'modules/' . $this->name . '/' . $presetRel,
                    ['position' => 'bottom', 'priority' => 195, 'version' => $this->fileVersion($presetPath)]
                );
            }
        }

        // Diagnostic monitor (opt-in). Loaded BEFORE player.js so the
        // monitor's window.onerror handler is in place before our own code
        // can throw — gives us coverage on player.js init errors too.
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
                'themePreset'      => $this->getThemePreset(),
                'monitorEnabled'   => (int) Configuration::get(self::CFG_MONITOR_ENABLED) === 1,
                'monitorEndpoint'  => $this->context->link->getModuleLink($this->name, 'monitor'),
                'productPlaylistEnabled' => (int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) === 1,
                'productPlaylistSkin'    => $this->getProductPlayerSkin(),
                'debug'            => $debug,
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

    public function hookDisplayFooter($params)
    {
        if (!self::audioSourceAvailable()) {
            return '';
        }
        // Don't render the persistent player on pages we've excluded from
        // Swup (contact, sitemap, stores...). Those pages get a full reload
        // so the audio is interrupted anyway, and showing the player with
        // a stale track from a possibly-disabled product is confusing
        // (operator-confirmed feedback after v2.5.2: the contact page kept
        // displaying the previously-played title even after the product was
        // disabled in the catalogue).
        if ($this->isCurrentRequestExcludedFromSwup()) {
            return '';
        }
        return $this->fetch('module:' . $this->name . '/views/templates/hook/player-footer.tpl');
    }

    /**
     * Returns true when the current front request URL matches one of the
     * Swup exclusion patterns (built from PrestaShop standard pages
     * `contact`, `sitemap`, `stores`, plus any operator-supplied extras
     * via `ORP_EXTRA_EXCLUDES`). Used by `hookDisplayFooter` to suppress
     * the persistent player on those pages.
     */
    private function isCurrentRequestExcludedFromSwup()
    {
        try {
            $currentPath = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
            if ($currentPath === '') {
                return false;
            }
            $currentLower = strtolower($currentPath);
            foreach ($this->getSwupExcludePaths() as $pattern) {
                if ($pattern === '' || $pattern === null) continue;
                if (strpos($currentLower, strtolower((string) $pattern)) !== false) {
                    return true;
                }
            }
        } catch (Exception $e) {}
        return false;
    }

    /**
     * Renders the integrated product-page playlist that REPLACES Papp's
     * `<audio>` element + MediaElement.js player when the operator has
     * enabled CFG_REPLACE_PAPP_PLAYER.
     *
     * Wiring: ZOneTheme's `templates/catalog/product.tpl` line 107 contains
     *   <div class="mt-3 mb-3">{hook h='DisplayProductPlaylistPlugin' product=$product}</div>
     * which invokes this hook on every product page. Both Papp and our
     * module are registered on the hook (Papp at install time, ours at
     * 2.5.2 install via PAPP_DISPLAY_HOOK in install()). When CFG_REPLACE_PAPP_PLAYER=1
     * we have additionally unregistered Papp from the hook so only our
     * output remains.
     *
     * Returns '' when:
     *   - Replacement mode is off (no-op)
     *   - The product has no audio entries in papp_audio_playlist
     *   - The hook is invoked outside a product context (no $product param)
     */
    public function hookDisplayProductPlaylistPlugin($params)
    {
        if ((int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) !== 1) {
            return '';
        }
        if (!self::audioSourceAvailable()) {
            return '';
        }

        $idProduct = 0;
        if (!empty($params['product'])) {
            $product = $params['product'];
            if (is_array($product) && isset($product['id_product'])) {
                $idProduct = (int) $product['id_product'];
            } elseif (is_object($product) && isset($product->id_product)) {
                $idProduct = (int) $product->id_product;
            } elseif (is_object($product) && isset($product->id)) {
                $idProduct = (int) $product->id;
            }
        }
        if ($idProduct <= 0) {
            return '';
        }

        $tracks = self::getProductTracks($idProduct);
        if (empty($tracks)) {
            return '';
        }

        $skin = Configuration::get(self::CFG_PRODUCT_PLAYER_SKIN);
        if (!in_array($skin, self::VALID_SKINS, true)) {
            $skin = self::SKIN_ORP;
        }

        $cacheId = $this->getCacheId(
            'orp_product_playlist_' . $idProduct . '_' . $skin
        );

        $this->context->smarty->assign([
            'orp_product_id'        => $idProduct,
            'orp_product_tracks'    => $tracks,
            'orp_playlist_skin'     => $skin,
            'orp_playlist_track_count' => count($tracks),
        ]);

        return $this->fetch(
            'module:' . $this->name . '/views/templates/hook/product-playlist.tpl',
            $cacheId
        );
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
     * Two-purpose hook on every BO admin controller init:
     *
     *   1. When the admin loads a Papp-related controller, invalidate the
     *      `orp_with_audio_*` cache (catches cases where Papp performs raw
     *      SQL and never fires actionObjectPappAudioPlaylist*).
     *
     *   2. LAYER 2 of the Papp-replacement defence: if the operator has
     *      enabled CFG_REPLACE_PAPP_PLAYER and Papp has somehow been
     *      re-registered on PAPP_DISPLAY_HOOK (cache clear, module reset,
     *      manual re-hook in BO → Module Positions, etc.), unregister it
     *      again. Catches any administrative action that re-attaches
     *      Papp behind our back.
     */
    public function hookActionAdminControllerInitAfter($params)
    {
        // ── Layer 2 watcher (runs on every admin controller init) ──
        try {
            if ((int) Configuration::get(self::CFG_REPLACE_PAPP_PLAYER) === 1
                && $this->getPappCurrentHookPosition() > 0) {
                // Papp is hooked again — undo it.
                $pappModule = Module::getInstanceByName(self::AUDIO_SOURCE_MODULE);
                if ($pappModule) {
                    $idHook = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
                    if ($idHook > 0) {
                        $pappModule->unregisterHook($idHook);
                    }
                }
                // Also re-install the override file in case it was removed
                // (some module-update flows rebuild /override/).
                if (!is_file($this->getPappOverrideFilePath())) {
                    $this->installPappOverride();
                }
            }
        } catch (Exception $e) {
            // never block admin requests on watcher errors
        }

        // ── Cache invalidation when on a Papp-related admin page ──
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
    /*  PAPP REPLACEMENT — 3-LAYER DEFENCE                          */
    /* ============================================================ */
    /*
     *  Layer 1: at toggle ON, we unregister Papp from PAPP_DISPLAY_HOOK
     *           and our module takes over (we registered on the same hook
     *           at install time so we're already a candidate).
     *  Layer 2: on every BO admin controller init we re-check that Papp
     *           is still unhooked from PAPP_DISPLAY_HOOK; if Papp self-
     *           re-registered (cache clear, module reset, etc.) we undo
     *           it again.
     *  Layer 3: a file-level override at /override/modules/.../X.php
     *           short-circuits Papp::hookDisplayProductPlaylistPlugin to
     *           return '' even if Papp manages to be hooked. Belt-and-
     *           suspenders for the small race window where layer 2 hasn't
     *           fired yet.
     */

    /**
     * Reads the hook position stored in `ps_hook_module` for the third-party
     * Papp module on the PAPP_DISPLAY_HOOK hook. Returns 0 when Papp is not
     * registered there (which is the post-takeover steady state).
     */
    private function getPappCurrentHookPosition()
    {
        $idHook = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
        $idMod  = (int) Module::getModuleIdByName(self::AUDIO_SOURCE_MODULE);
        if ($idHook <= 0 || $idMod <= 0) {
            return 0;
        }
        $row = Db::getInstance()->getValue(
            'SELECT position FROM ' . _DB_PREFIX_ . 'hook_module
             WHERE id_hook = ' . $idHook . ' AND id_module = ' . $idMod
        );
        return (int) $row;
    }

    /**
     * Installs the layered defence:
     *   1. Snapshot Papp's current hook position so we can restore it later.
     *   2. Unregister Papp from PAPP_DISPLAY_HOOK.
     *   3. Make sure our module is registered on PAPP_DISPLAY_HOOK.
     *   4. Drop the override file at /override/modules/.../X.php.
     *   5. Bump the class_index cache so PS picks up the override.
     *   6. Flush Smarty cache so Papp's now-empty render is reflected.
     *
     * Idempotent: calling twice is safe.
     */
    private function enablePappReplacement()
    {
        $pappModule = Module::getInstanceByName(self::AUDIO_SOURCE_MODULE);
        if (!$pappModule) {
            // Papp not installed at all — nothing to take over from. Still
            // register ourselves on the hook in case Papp gets installed
            // later: registering again is a no-op.
            $this->registerHook(self::PAPP_DISPLAY_HOOK);
            Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 1);
            return;
        }

        // 1. Snapshot the current Papp position (only if non-zero — a zero
        //    means Papp is already unhooked, no useful snapshot to take).
        $currentPos = $this->getPappCurrentHookPosition();
        if ($currentPos > 0) {
            Configuration::updateValue(self::CFG_PAPP_HOOK_POSITION, $currentPos);
        }

        // 2. Unregister Papp from the hook.
        try {
            $idHook = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
            if ($idHook > 0) {
                $pappModule->unregisterHook($idHook);
            }
        } catch (Exception $e) {
            // proceed even if the unregister fails — layers 2 + 3 still apply
        }

        // 3. Make sure WE are registered on the hook so our hookDisplayXxx
        //    method gets invoked.
        $this->registerHook(self::PAPP_DISPLAY_HOOK);

        Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 1);

        // 4 + 5. Drop the override and refresh class_index.
        $this->installPappOverride();

        // 6. Smarty cache.
        try {
            Tools::clearSmartyCache();
        } catch (Exception $e) {}
    }

    /**
     * Reverses enablePappReplacement(): deletes the override, re-registers
     * Papp on the hook at its original position (best effort), and drops
     * the cached Smarty templates.
     */
    private function disablePappReplacement()
    {
        $this->removePappOverride();

        $pappModule = Module::getInstanceByName(self::AUDIO_SOURCE_MODULE);
        if ($pappModule) {
            try {
                $pappModule->registerHook(self::PAPP_DISPLAY_HOOK);
                $savedPos = (int) Configuration::get(self::CFG_PAPP_HOOK_POSITION);
                if ($savedPos > 0) {
                    // updatePosition expects (id_hook, way, position). way=0
                    // means "move to the absolute target position".
                    $idHook = (int) Hook::getIdByName(self::PAPP_DISPLAY_HOOK);
                    if ($idHook > 0) {
                        $pappModule->updatePosition($idHook, 0, $savedPos);
                    }
                }
            } catch (Exception $e) {}
        }

        Configuration::updateValue(self::CFG_PAPP_HOOK_REMOVED, 0);

        try {
            Tools::clearSmartyCache();
        } catch (Exception $e) {}
    }

    /**
     * Filesystem path to the Papp module override we install.
     */
    private function getPappOverrideFilePath()
    {
        return _PS_OVERRIDE_DIR_ . 'modules/' . self::AUDIO_SOURCE_MODULE . '/'
            . self::AUDIO_SOURCE_MODULE . '.php';
    }

    /**
     * Writes the override file that short-circuits Papp's hook return value.
     * Even if Papp re-registers itself on the hook between our watcher's
     * tick and a customer's pageview, the override forces an empty return,
     * so the hook never produces visible HTML.
     *
     * Standard PrestaShop module-override pattern: a class with the same
     * name as the original module, in /override/modules/{module}/{module}.php.
     * PS's autoloader replaces the original class with our extended version.
     */
    private function installPappOverride()
    {
        $path = $this->getPappOverrideFilePath();
        $dir  = dirname($path);

        // Conflict check: another module may have already installed an
        // override here (rare, but possible). Don't clobber — log and
        // fall back to layers 1 + 2 only.
        if (is_file($path)) {
            $existing = (string) @file_get_contents($path);
            if (strpos($existing, '@orp-managed') === false) {
                // Foreign override present — leave it alone.
                return false;
            }
        }

        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        if (!is_dir($dir)) {
            return false;
        }

        $code = <<<'PHP'
<?php
/**
 * @orp-managed — DO NOT EDIT, written by the OnlyRoots Player module
 * (onlyrootsplayer) when its "Lecteur intégré à la fiche produit" toggle is
 * enabled. Removed automatically when the toggle is turned off or when the
 * OnlyRoots Player module is uninstalled.
 *
 * Forces ProductAudioPlaylistPlugin::hookDisplayProductPlaylistPlugin to
 * return an empty string while OnlyRoots Player is rendering the
 * integrated playlist on product pages — preventing both players from
 * showing simultaneously even if Papp manages to be hooked back on
 * PAPP_DISPLAY_HOOK between our admin-controller watcher's ticks.
 */
class ProductAudioPlaylistPluginOverride extends ProductAudioPlaylistPlugin
{
    public function hookDisplayProductPlaylistPlugin($params)
    {
        if ((int) Configuration::get('ORP_REPLACE_PAPP_PLAYER') === 1) {
            return '';
        }
        return parent::hookDisplayProductPlaylistPlugin($params);
    }
}
PHP;

        $written = @file_put_contents($path, $code);
        if ($written === false) {
            return false;
        }
        @chmod($path, 0644);

        // Drop class_index so PS regenerates it on next request and picks up
        // our override class. This is the standard pattern for modules that
        // ship overrides; cf. PrestaShop's PrestaShopAutoload.
        $classIndex = _PS_CACHE_DIR_ . 'class_index.php';
        if (is_file($classIndex)) {
            @unlink($classIndex);
        }
        return true;
    }

    /**
     * Removes our override file (if it's the one we wrote — never touch a
     * foreign override). Clears class_index so PS forgets about it.
     */
    private function removePappOverride()
    {
        $path = $this->getPappOverrideFilePath();
        if (!is_file($path)) {
            return true;
        }
        $content = (string) @file_get_contents($path);
        if (strpos($content, '@orp-managed') === false) {
            // Foreign override — leave it alone.
            return false;
        }
        @unlink($path);
        $classIndex = _PS_CACHE_DIR_ . 'class_index.php';
        if (is_file($classIndex)) {
            @unlink($classIndex);
        }
        return true;
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
        // session-sensitive flows, or pages with a custom layout that breaks
        // when its container is swapped instead of the document being
        // reloaded). Pulled from Link::getPageLink() so they match whatever
        // URL rewrite + language the shop uses.
        //
        // `contact`, `sitemap`, `stores` are layout-fragile: their templates
        // sometimes diverge from the standard layout (no megamenu, different
        // wrapper structure), and Swup ends up with a half-swapped page
        // missing the header/footer (observed on OnlyRoots Reggae /
        // ZOneTheme on /fr/nous-contacter — captured in the v2.5.2 monitor
        // log).
        $pageNames = [
            'cart', 'order', 'order-confirmation', 'authentication',
            'identity', 'address', 'addresses', 'history', 'order-follow',
            'order-slip', 'guest-tracking', 'password', 'my-account',
            'discount', 'order-detail', 'module-payment',
            'contact', 'sitemap', 'stores',
        ];

        // Operator opt-in (CFG_INCLUDE_CONTACT, off by default): drop the
        // contact page from the exclusion list so Swup handles it like any
        // other page. The watchdog + catastrophic-swap detector stay armed
        // and will trigger a full reload if the swap fails. See the BO
        // field description for the full safety contract.
        if ((int) Configuration::get(self::CFG_INCLUDE_CONTACT) === 1) {
            $pageNames = array_values(array_filter(
                $pageNames,
                function ($p) { return $p !== 'contact'; }
            ));
        }
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
