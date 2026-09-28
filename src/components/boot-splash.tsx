/**
 * Animated boot splash, shown the instant the HTML arrives (no JS bundle needed to paint it,
 * which matters in the native app: Capacitor loads the live portal over the network, so this
 * is what fills the gap between the native launch image and the page actually being ready).
 * Renders the real brand lockup — the illustration and the "LEGACY / INDEPENDENT LIVING"
 * wordmark, cropped from the same source artwork so they stay perfectly aligned — and animates
 * them in as two staggered pieces instead of a static logo.
 * Removes itself once the page has loaded, or after a failsafe timeout if `load` never fires.
 */
export function BootSplash() {
  return (
    <div id="boot-splash" role="presentation" aria-hidden="true">
      {/* Rendered anywhere in the tree, Next.js hoists <link> into <head> — these need to
          start fetching immediately, before the splash's own paint, since the image only
          shows once it's downloaded. */}
      <link rel="preload" as="image" href="/brand/logo-mark-art.webp" fetchPriority="high" />
      <link rel="preload" as="image" href="/brand/logo-wordmark.webp" fetchPriority="high" />
      <style
        // Inline + scoped to this component on purpose: it must render with the very first
        // byte of HTML, before any stylesheet or JS chunk has had a chance to load.
        dangerouslySetInnerHTML={{
          __html: `
          #boot-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#fbf8f1;transition:opacity .16s ease-out;opacity:1;pointer-events:auto}
          #boot-splash.boot-splash-out{opacity:0;pointer-events:none}
          #boot-splash .bs-scene{display:flex;flex-direction:column;align-items:center;padding:0 8vw}
          #boot-splash .bs-art{width:min(46vw,190px);height:auto;opacity:0;transform:scale(.9) translateY(4px);animation:bsArtIn .55s cubic-bezier(.2,.8,.3,1.1) .05s forwards}
          #boot-splash .bs-word{width:min(64vw,240px);height:auto;margin-top:14px;opacity:0;transform:translateY(6px);animation:bsWordIn .5s ease .32s forwards}
          @media (prefers-reduced-motion: no-preference){
            #boot-splash .bs-art{animation:bsArtIn .55s cubic-bezier(.2,.8,.3,1.1) .05s forwards, bsBreathe 2.4s ease-in-out .6s infinite}
          }
          @keyframes bsArtIn{from{opacity:0;transform:scale(.9) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
          @keyframes bsWordIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
          @keyframes bsBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
        `,
        }}
      />
      <div className="bs-scene">
        {/* eslint-disable-next-line @next/next/no-img-element -- must paint before any JS/image
            optimizer is available; this is the raw HTML shown before hydration. */}
        <img className="bs-art" src="/brand/logo-mark-art.webp" alt="" width={520} height={422} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="bs-word" src="/brand/logo-wordmark.webp" alt="Legacy Independent Living" width={680} height={275} />
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function(){
            var el = document.getElementById('boot-splash');
            if(!el) return;
            var hidden = false;
            function hide(){
              if (hidden) return;
              hidden = true;
              el.classList.add('boot-splash-out');
              setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 200);
            }
            // Keep the fade-out snappy: the page underneath is already fully painted by
            // 'load', so lingering here just shows a translucent splash over a busy page.
            if (document.readyState === 'complete') {
              setTimeout(hide, 450);
            } else {
              window.addEventListener('load', function(){ setTimeout(hide, 80); });
            }
            setTimeout(hide, 3500); // failsafe if 'load' never fires (e.g. offline)
          })();
        `,
        }}
      />
    </div>
  );
}
