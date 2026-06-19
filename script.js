// University of Toronto Effective Altruism — interactions
(function () {
  var docEl = document.documentElement;
  var nav = document.querySelector(".nav");
  var topbar = document.querySelector(".topbar");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var scrollBehavior = reduceMotion ? "auto" : "smooth";

  function isHome(path) { return path === "/" || /\/index\.html$/.test(path); }

  // 1) Collapse the nav wordmark to "UTEA" once the page is scrolled.
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // 2) Size the homepage hero to fill the viewport beneath the fixed chrome
  //    (announcement bar + sticky nav) so nothing peeks below on load.
  function setChromeHeight() {
    var h = (nav ? nav.offsetHeight : 0) + (topbar ? topbar.offsetHeight : 0);
    docEl.style.setProperty("--chrome-h", h + "px");
  }
  setChromeHeight();
  window.addEventListener("resize", setChromeHeight, { passive: true });

  // 3) Clicking the brand while already home scrolls to top instead of
  //    reloading. In-page anchors use the browser's native smooth scroll.
  var brand = document.querySelector(".brand");
  if (brand) {
    brand.addEventListener("click", function (e) {
      var samePage = brand.pathname === location.pathname
        || (isHome(brand.pathname) && isHome(location.pathname));
      if (!samePage) return; // let it navigate home (e.g. from Resources)
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: scrollBehavior });
      if (location.hash && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
  }

  // 4) Reveal on scroll: elements rise and settle as they enter the viewport,
  //    cascading within each group. The hidden state is applied before first
  //    paint by the <head> guard (the "reveal" class), so there's no flash.
  if (docEl.classList.contains("reveal")) {
    var selectors = [
      ".hero__copy > *",
      ".section__head > *",
      ".cols .col",
      ".list .list__row",
      ".cta-band .wrap > *",
      ".page-hero .wrap > *",
      "main.wrap .res-group"
    ];
    var els = [];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (els.indexOf(el) === -1) els.push(el);
      });
    });

    // Stagger siblings within the same parent for a cascading entrance.
    var counts = new Map();
    els.forEach(function (el) {
      var parent = el.parentNode;
      var i = counts.get(parent) || 0;
      el.style.setProperty("--d", (i * 0.07).toFixed(2) + "s");
      counts.set(parent, i + 1);
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach(function (el) { io.observe(el); });
  }

  // 5) Landed from another page aiming at a section (hash stashed in <head>):
  //    start at the top and smooth-scroll there once layout has settled.
  var target = window.__scrollTarget && document.getElementById(window.__scrollTarget);
  if (target) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        target.scrollIntoView({ behavior: scrollBehavior, block: "start" });
        if (history.replaceState) history.replaceState(null, "", "#" + target.id);
        if ("scrollRestoration" in history) history.scrollRestoration = "auto";
      });
    });
  }
})();
