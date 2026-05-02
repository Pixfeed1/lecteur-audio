{*
 * OnlyRoots Persistent Audio Player — frame injector (parent-side, v3.0.1)
 *
 * Injects the iframe at the very bottom of every page via the
 * `displayBeforeBodyClosingTag` hook. The iframe is the host document
 * for the audio engine — see views/templates/front/frame.tpl for its
 * content.
 *
 * The iframe lives OUTSIDE the `#content-wrapper` Swup container, so
 * it survives every internal navigation by construction. No special
 * data-* attribute is needed; Swup ignores nodes that aren't inside
 * the swap container.
 *
 *   - allow="autoplay" : permission policy explicitly granting the
 *     iframe the right to play audio without user gesture (the gesture
 *     happens on the parent and is forwarded via postMessage).
 *
 * @author PixFeed - Marc Gueffie
 *}
<iframe id="orp-frame"
        src="{$orp_frame_url|escape:'html':'UTF-8'}"
        title="OnlyRoots Audio Player"
        allow="autoplay"
        loading="eager"
        aria-hidden="true"
        tabindex="-1"
        style="position:fixed;left:0;right:0;bottom:0;width:100%;height:0;border:0;background:transparent;z-index:9999;transition:height .2s ease-out;color-scheme:light dark;"></iframe>
