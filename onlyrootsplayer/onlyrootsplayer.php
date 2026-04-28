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
 * @version   2.4.6
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
        $this->version          = '2.4.6';
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
            // staging-validated fix for the v2.4.6 production breakage. Operators
            // on ZOneTheme must opt in via BO after testing in staging with the
            // F12 console open to capture any reinit-related errors.
            self::CFG_THEME_PRESET      => self::THEME_PRESET_NONE,
            self::CFG_MONITOR_ENABLED   => 0,
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
            self::CFG_THEME_PRESET,
            self::CFG_MONITOR_ENABLED,
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

        $action = htmlspecialchars(
            $this->context->link->getAdminLink('AdminModules', false)
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
        ];
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
        // session-sensitive flows, or pages with a custom layout that breaks
        // when its container is swapped instead of the document being
        // reloaded). Pulled from Link::getPageLink() so they match whatever
        // URL rewrite + language the shop uses.
        //
        // `contact`, `sitemap`, `stores` are layout-fragile: their templates
        // sometimes diverge from the standard layout (no megamenu, different
        // wrapper structure), and Swup ends up with a half-swapped page
        // missing the header/footer (observed on OnlyRoots Reggae /
        // ZOneTheme on /fr/nous-contacter — captured in the v2.4.6 monitor
        // log).
        $pageNames = [
            'cart', 'order', 'order-confirmation', 'authentication',
            'identity', 'address', 'addresses', 'history', 'order-follow',
            'order-slip', 'guest-tracking', 'password', 'my-account',
            'discount', 'order-detail', 'module-payment',
            'contact', 'sitemap', 'stores',
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
