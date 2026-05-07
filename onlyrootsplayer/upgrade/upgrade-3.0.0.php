<?php
/**
 * Upgrade migration for v3.0.0.
 *
 * Registers the new `displayBeforeBodyClosingTag` hook on installs
 * upgrading from v2.5.x. The hook is added to install() in 3.0.0+
 * but install() doesn't run on upgrade, so existing installs would
 * never have it in the `ps_hook_module` table — the iframe HTML
 * would never be rendered, the player would be invisible.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_3_0_0($module)
{
    if (!$module instanceof Module) {
        return false;
    }
    // registerHook is idempotent: returns true if already registered.
    return (bool) $module->registerHook('displayBeforeBodyClosingTag');
}
