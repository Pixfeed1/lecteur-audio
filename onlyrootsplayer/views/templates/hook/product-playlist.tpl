{*
 * OnlyRoots Persistent Audio Player — integrated product-page playlist
 *
 * Replaces the third-party Papp module's MediaElement.js player on product
 * pages when CFG_REPLACE_PAPP_PLAYER is enabled. Each track row carries
 * data-track-* attributes that views/js/player.js reads to load the audio
 * into the persistent footer player on click.
 *
 * Variables (assigned by hookDisplayProductPlaylistPlugin):
 *   $orp_product_id           int      product the tracks belong to
 *   $orp_product_tracks       array    [{filename, title, url}, ...]
 *   $orp_playlist_skin        string   'orp' | 'papp' (the active skin)
 *   $orp_playlist_track_count int      sizeof($orp_product_tracks)
 *
 * @author PixFeed - Marc Gueffie
 *}
<div class="orp-product-playlist" data-skin="{$orp_playlist_skin|escape:'html':'UTF-8'}" data-product-id="{(int) $orp_product_id}">
  <div class="orp-product-playlist__header">
    <button type="button" class="orp-playlist-play-all" data-product-id="{(int) $orp_product_id}" aria-label="{l s='Tout écouter' d='Modules.Onlyrootsplayer.Shop'}">
      <span class="orp-playlist-play-all__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 12 12"><polygon points="3,1 3,11 10,6" fill="currentColor"/></svg>
      </span>
      <span class="orp-playlist-play-all__label">{l s='Tout écouter' d='Modules.Onlyrootsplayer.Shop'}</span>
    </button>
    <h3 class="orp-product-playlist__title">
      {l s='Écouter' d='Modules.Onlyrootsplayer.Shop'}
      <span class="orp-product-playlist__count">({(int) $orp_playlist_track_count})</span>
    </h3>
  </div>

  <ol class="orp-product-playlist__tracks">
    {foreach from=$orp_product_tracks item=track key=trackIndex}
      <li class="orp-product-playlist__track" data-track-index="{(int) $trackIndex}">
        <button type="button"
                class="orp-track-play"
                data-product-id="{(int) $orp_product_id}"
                data-track-index="{(int) $trackIndex}"
                data-track-url="{$track.url|escape:'html':'UTF-8'}"
                data-track-title="{$track.title|escape:'html':'UTF-8'}"
                aria-label="{l s='Écouter' d='Modules.Onlyrootsplayer.Shop'}">
          <span class="orp-track-play__icon orp-track-play__icon--play" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="3,1 3,11 10,6" fill="currentColor"/></svg>
          </span>
          <span class="orp-track-play__icon orp-track-play__icon--pause" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>
          </span>
        </button>
        <span class="orp-track-position">{($trackIndex + 1)|string_format:'%02d'}</span>
        <span class="orp-track-title">{$track.title|escape:'html':'UTF-8'}</span>
      </li>
    {/foreach}
  </ol>
</div>
