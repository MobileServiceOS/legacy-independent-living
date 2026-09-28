/**
 * Animated boot splash, shown the instant the HTML arrives (no JS bundle needed to paint it,
 * which matters in the native app: Capacitor loads the live portal over the network, so this
 * is what fills the gap between the native launch image and the page actually being ready).
 * Renders the real brand lockup — the illustration and the "LEGACY / INDEPENDENT LIVING"
 * wordmark, cropped from the same source artwork so they stay perfectly aligned — behind a
 * soft glow, with a gentle floating loop on the art and a one-time light sweep across the
 * wordmark once it settles in. The family is additionally cut out of the same artwork (with
 * feathered edges) and layered exactly on top of itself so it can carry its own subtle
 * walking bob independent of the tree/house/arc behind it.
 * Removes itself once the page has loaded, or after a failsafe timeout if `load` never fires.
 */
export function BootSplash() {
  return (
    <div id="boot-splash" role="presentation" aria-hidden="true">
      {/* Rendered anywhere in the tree, Next.js hoists <link> into <head> — these need to
          start fetching immediately, before the splash's own paint, since the image only
          shows once it's downloaded. */}
      <link rel="preload" as="image" href="/brand/logo-mark-art.webp" fetchPriority="high" />
      <link rel="preload" as="image" href="/brand/logo-family-cutout.webp" fetchPriority="high" />
      <link rel="preload" as="image" href="/brand/logo-wordmark.webp" fetchPriority="high" />
      <style
        // Inline + scoped to this component on purpose: it must render with the very first
        // byte of HTML, before any stylesheet or JS chunk has had a chance to load.
        dangerouslySetInnerHTML={{
          __html: `
          #boot-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#fbf8f1;overflow:hidden;transition:opacity .16s ease-out;opacity:1;pointer-events:auto}
          #boot-splash.boot-splash-out{opacity:0;pointer-events:none}
          #boot-splash .bs-glow{position:absolute;width:min(90vw,420px);height:min(90vw,420px);border-radius:50%;background:radial-gradient(circle,rgba(74,85,51,.16) 0%,rgba(74,85,51,0) 68%);opacity:0;animation:bsGlowIn 1.8s ease-out .1s forwards}
          #boot-splash .bs-scene{position:relative;display:flex;flex-direction:column;align-items:center;padding:0 8vw}
          #boot-splash .bs-art-wrap{position:relative;opacity:0;transform:scale(.88) translateY(8px);animation:bsArtIn .6s cubic-bezier(.2,.8,.3,1.1) .08s forwards}
          #boot-splash .bs-art{display:block;width:min(46vw,190px);height:auto}
          /* Positioned as a % of the art image's own box (computed from the source crop
             coordinates) so it tracks the art exactly at every viewport size. */
          #boot-splash .bs-family{position:absolute;left:24.81%;top:33.54%;width:41.77%;height:54.6%}
          #boot-splash .bs-family img{display:block;width:100%;height:100%}
          #boot-splash .bs-word-wrap{position:relative;overflow:hidden;margin-top:14px;opacity:0;transform:translateY(8px);animation:bsWordIn .55s ease .38s forwards}
          #boot-splash .bs-word{display:block;width:min(64vw,240px);height:auto}
          #boot-splash .bs-word-wrap::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.75) 48%,transparent 66%);transform:translateX(-120%);animation:bsShine 1.1s ease .95s 1}
          @media (prefers-reduced-motion: no-preference){
            #boot-splash .bs-art-wrap{animation:bsArtIn .6s cubic-bezier(.2,.8,.3,1.1) .08s forwards, bsFloat 3.2s ease-in-out .7s infinite}
            #boot-splash .bs-family{animation:bsWalk .86s ease-in-out .7s infinite}
          }
          @media (prefers-reduced-motion: reduce){
            #boot-splash .bs-word-wrap::after{animation:none}
          }
          @keyframes bsGlowIn{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
          @keyframes bsArtIn{from{opacity:0;transform:scale(.88) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
          @keyframes bsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
          @keyframes bsWalk{0%,100%{transform:translate(0,0)}25%{transform:translate(.6px,-1.6px)}50%{transform:translate(0,0)}75%{transform:translate(-.6px,-1.6px)}}
          @keyframes bsWordIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @keyframes bsShine{from{transform:translateX(-120%)}to{transform:translateX(120%)}}
        `,
        }}
      />
      <div className="bs-glow" />
      <div className="bs-scene">
        <div className="bs-art-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element -- must paint before any JS/image
              optimizer is available; this is the raw HTML shown before hydration. */}
          <img className="bs-art" src="/brand/logo-mark-art.webp" alt="" width={520} height={422} />
          {/* The family, cut from the same artwork with feathered edges, layered exactly over
              itself so it can carry its own tiny walking bob independent of the background. */}
          <div className="bs-family">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-family-cutout.webp" alt="" width={330} height={350} />
          </div>
        </div>
        <div className="bs-word-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="bs-word" src="/brand/logo-wordmark.webp" alt="Legacy Independent Living" width={680} height={275} />
        </div>
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
            // Give the shine sweep (ends ~2050ms) room to land before we start fading out.
            if (document.readyState === 'complete') {
              setTimeout(hide, 900);
            } else {
              window.addEventListener('load', function(){ setTimeout(hide, 550); });
            }
            setTimeout(hide, 3800); // failsafe if 'load' never fires (e.g. offline)
          })();
        `,
        }}
      />
    </div>
  );
}
