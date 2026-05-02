<?php
/**
 * Upgrade migration for v2.5.20.
 *
 * Forces `ORP_INCLUDE_CONTACT = 1` on every install upgrading to 2.5.20.
 *
 * Rationale: in v2.5.19 we changed the install-default for the toggle
 * from 0 to 1 (so audio continues across Contact navigation), but the
 * `install()` defaults array only runs on a FRESH install, not on
 * upgrade. Operators upgrading from v2.5.18 or earlier kept their
 * stored value of 0 in the Configuration table, which meant the
 * "audio on Contact" feature was effectively never enabled for them
 * unless they manually flipped the toggle in the BO config form.
 *
 * This script forces the value to 1 unconditionally. Operators who
 * actively prefer the previous behaviour (Contact excluded from Swup,
 * audio interrupted on contact navigation) can still flip it back to
 * 0 in the BO config form after the upgrade.
 *
 * Note: this is a one-shot migration. PrestaShop runs it exactly once
 * when transitioning from any version < 2.5.20 to 2.5.20 or later.
 *
 * @author PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_2_5_20($module)
{
    return Configuration::updateValue('ORP_INCLUDE_CONTACT', 1);
}
