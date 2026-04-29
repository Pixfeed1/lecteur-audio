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
            {* Triangle visually centered: apex at x=9 (3 from right edge),
               base at x=3 (3 from left edge) → symmetric in the 12x12 box. *}
            <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="3,2 3,10 9,6" fill="currentColor"/></svg>
          </span>
          <span class="orp-track-play__icon orp-track-play__icon--pause" aria-hidden="true">
            {* Pause bars symmetric around x=6: rects at x=2.5 and x=7.5. *}
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2" width="2" height="8" fill="currentColor"/><rect x="7.5" y="2" width="2" height="8" fill="currentColor"/></svg>
          </span>
        </button>
        <span class="orp-track-position">{($trackIndex + 1)|string_format:'%02d'}</span>
        <span class="orp-track-title">{$track.title|escape:'html':'UTF-8'}</span>
      </li>
    {/foreach}
  </ol>
</div>
