{*
 * OnlyRoots Persistent Audio Player — footer markup
 * Theme-agnostic: uses only orp-* classes scoped under .orp-player.
 *
 * @author PixFeed - Marc Gueffie
 *}

<div id="orp-player" class="orp-player" style="display:none;" data-playing="false" role="region" aria-label="{l s='Audio player' d='Modules.Onlyrootsplayer.Shop'}">
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
            <button class="orp-btn orp-btn-prev" id="orp-prev" type="button"
                    title="{l s='Previous track' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Previous track' d='Modules.Onlyrootsplayer.Shop'}">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="2" width="2" height="10" fill="currentColor"/><polygon points="13,2 13,12 5,7" fill="currentColor"/></svg>
            </button>
            <button class="orp-btn orp-btn-play" id="orp-play" type="button"
                    title="{l s='Play / Pause' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Play or pause' d='Modules.Onlyrootsplayer.Shop'}">
                <svg class="orp-icon-play" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><polygon points="4,2 4,14 13,8" fill="currentColor"/></svg>
                <svg class="orp-icon-pause" width="16" height="16" viewBox="0 0 16 16" style="display:none;" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>
            </button>
            <button class="orp-btn orp-btn-next" id="orp-next" type="button"
                    title="{l s='Next track' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Next track' d='Modules.Onlyrootsplayer.Shop'}">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><polygon points="1,2 1,12 9,7" fill="currentColor"/><rect x="11" y="2" width="2" height="10" fill="currentColor"/></svg>
            </button>
        </div>

        <div class="orp-info">
            <div class="orp-info-text">
                <a href="#" id="orp-product-link" class="orp-track-name" title="">
                    <span id="orp-track-title">-</span>
                </a>
                <span class="orp-track-meta">
                    <span id="orp-product-name">-</span>
                    <span class="orp-track-sep">&middot;</span>
                    <span id="orp-track-counter">0/0</span>
                </span>
            </div>
            <div class="orp-progress-wrap" id="orp-progress-wrap">
                <div class="orp-progress-bar" role="slider" aria-label="{l s='Progress' d='Modules.Onlyrootsplayer.Shop'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
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
            <button class="orp-btn orp-btn-vol" id="orp-vol-btn" type="button"
                    title="{l s='Volume' d='Modules.Onlyrootsplayer.Shop'}"
                    aria-label="{l s='Mute or unmute' d='Modules.Onlyrootsplayer.Shop'}">
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
                <div class="orp-volume-bar" role="slider" aria-label="{l s='Volume' d='Modules.Onlyrootsplayer.Shop'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80" tabindex="0">
                    <div class="orp-volume-fill" id="orp-volume-fill" style="width:80%;"></div>
                </div>
            </div>
        </div>

        <button class="orp-btn orp-btn-close" id="orp-close" type="button"
                title="{l s='Close' d='Modules.Onlyrootsplayer.Shop'}"
                aria-label="{l s='Close the player' d='Modules.Onlyrootsplayer.Shop'}">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </button>

    </div>

    <audio id="orp-audio" preload="none"></audio>
</div>
