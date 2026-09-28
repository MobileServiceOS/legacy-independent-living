/**
 * Animated boot splash, shown the instant the HTML arrives (no JS bundle needed to paint it,
 * which matters in the native app: Capacitor loads the live portal over the network, so this
 * is what fills the gap between the native launch image and the page actually being ready).
 * Removes itself once the page has loaded, or after a failsafe timeout if `load` never fires.
 */
export function BootSplash() {
  return (
    <div id="boot-splash" role="presentation" aria-hidden="true">
      <style
        // Inline + scoped to this component on purpose: it must render with the very first
        // byte of HTML, before any stylesheet or JS chunk has had a chance to load.
        dangerouslySetInnerHTML={{
          __html: `
          #boot-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#fbf8f1;transition:opacity .5s ease}
          #boot-splash.boot-splash-out{opacity:0;pointer-events:none}
          #boot-splash svg{width:min(58vw,220px);height:auto;overflow:visible}
          #boot-splash .bs-word{margin-top:14px;text-align:center;font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:1.5rem;color:#3a431f;letter-spacing:.02em;opacity:0;animation:bsWordIn .6s ease .5s forwards}
          #boot-splash .bs-scene{display:flex;flex-direction:column;align-items:center}
          @media (prefers-reduced-motion: no-preference){
            #boot-splash .bs-tree{transform-origin:64px 150px;animation:bsSway 2.6s ease-in-out infinite}
            #boot-splash .bs-person{animation:bsBob 0.9s ease-in-out infinite}
            #boot-splash .bs-person-1{animation-delay:0s}
            #boot-splash .bs-person-2{animation-delay:.15s}
            #boot-splash .bs-person-3{animation-delay:.3s}
            #boot-splash .bs-house{animation:bsHouseIn .7s cubic-bezier(.2,.8,.3,1.2) .2s both}
            #boot-splash .bs-people{animation:bsWalk 2.4s ease-in-out infinite alternate}
          }
          @keyframes bsSway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
          @keyframes bsBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
          @keyframes bsWalk{0%{transform:translateX(-3px)}100%{transform:translateX(3px)}}
          @keyframes bsHouseIn{from{opacity:0;transform:scale(.85) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
          @keyframes bsWordIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        `,
        }}
      />
      <div className="bs-scene">
        <svg viewBox="0 0 260 170" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 150 Q65 138 130 150 T260 150 V170 H0 Z" fill="#e2efdc" />

          <g className="bs-tree">
            <rect x="60" y="100" width="8" height="50" rx="3" fill="#634c2c" />
            <circle cx="64" cy="88" r="26" fill="#a8b06a" />
            <circle cx="46" cy="102" r="18" fill="#8fa05a" />
            <circle cx="82" cy="102" r="18" fill="#7e814c" />
          </g>

          <g className="bs-house">
            <rect x="178" y="96" width="62" height="54" rx="3" fill="#f5e8d5" />
            <path d="M170 100 L209 68 L248 100 Z" fill="#3a431f" />
            <rect x="200" y="118" width="18" height="32" fill="#4a5533" />
            <rect x="186" y="106" width="14" height="14" rx="2" fill="#4a5533" />
          </g>

          <g className="bs-people">
            <g className="bs-person bs-person-1">
              <circle cx="118" cy="112" r="7" fill="#3a431f" />
              <path d="M108 150 L110 128 Q118 122 126 128 L128 150 Z" fill="#4a5533" />
            </g>
            <g className="bs-person bs-person-2">
              <circle cx="140" cy="118" r="5.5" fill="#634c2c" />
              <path d="M133 150 L134.5 133 Q140 129 145.5 133 L147 150 Z" fill="#8fa05a" />
            </g>
            <g className="bs-person bs-person-3">
              <circle cx="156" cy="123" r="6.5" fill="#3a431f" />
              <path d="M148 150 L149.5 137 Q156 133 162.5 137 L164 150 Z" fill="#7e814c" />
            </g>
          </g>
        </svg>
        <p className="bs-word">Legacy Living</p>
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
              setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 550);
            }
            if (document.readyState === 'complete') {
              setTimeout(hide, 700);
            } else {
              window.addEventListener('load', function(){ setTimeout(hide, 350); });
            }
            setTimeout(hide, 3500); // failsafe if 'load' never fires (e.g. offline)
          })();
        `,
        }}
      />
    </div>
  );
}
