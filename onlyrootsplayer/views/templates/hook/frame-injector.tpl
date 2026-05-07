{**
 * OnlyRoots Persistent Audio Player — iframe injector
 *
 * Rendered via hookDisplayBeforeBodyClosingTag on every front page.
 * Inserts the persistent <iframe> at the very bottom of <body>,
 * outside any theme container, so it's never accidentally swapped
 * by Swup or restructured by the theme.
 *
 * `data-swup-persist` makes Swup explicitly skip this element on
 * every swap. The iframe itself reloads only when the user does a
 * full reload of the parent (Ctrl+R, language switch, login flow,
 * etc.) — and even then, the iframe restores its state from
 * localStorage (set by iframe-player.js).
 *
 * @author PixFeed - Marc Gueffie
 *}
{if $orp_audio_available}
<iframe id="orp-frame"
        src="{$orp_frame_url|escape:'html':'UTF-8'}"
        title="{l s='Lecteur audio' d='Modules.Onlyrootsplayer.Shop'}"
        data-swup-persist="orp-frame"
        scrolling="no"
        allow="autoplay; encrypted-media"
        loading="eager"></iframe>
{/if}
