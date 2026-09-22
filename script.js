// University of Toronto Effective Altruism — interactions
(function () {
  var docEl = document.documentElement;
  var nav = document.querySelector(".nav");
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

  // 2) Size the homepage hero to fill the viewport beneath the sticky nav
  //    so the next section sits just past the fold on load.
  function setChromeHeight() {
    docEl.style.setProperty("--chrome-h", (nav ? nav.offsetHeight : 0) + "px");
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
      ".cta-band .wrap > *",
      ".page-hero .wrap > *",
      ".res-grid .tile",
      ".team-list .member",
      ".gate__inner > *"
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

  // 5) Resource hearts. Counts are shared across everyone via a public counter
  //    (Abacus); which ones *you* hearted is remembered per-browser. The
  //    service only offers a keyless increment, so each resource keeps a pair
  //    of counters — "<slug>" for hearts and "<slug>-undo" for hearts taken
  //    back — and the number on screen is the difference. That way un-hearting
  //    really does lower the count for everyone.
  //
  //    The API rate-limits to 30 requests per 10s per IP, and a whole grid is
  //    two requests per tile, so reads are staggered, cached, and a failed read
  //    (429, offline) leaves the last known number alone instead of showing a
  //    zero that isn't true. Only a 404 — nobody has hearted this yet — is a
  //    real zero.
  var HEART_API = "https://abacus.jasoncameron.dev";
  var HEART_NS = "uteffectivealtruism-ca";
  var HEART_MINE = "utea:hearted";
  var HEART_SEEN = "utea:heartSeen";   // last known good counts, survives reloads
  var HEART_FETCHED = "utea:heartAt";  // when we last hit the network
  var HEART_TTL = 180000;
  var HEART_STAGGER = 130;             // ms between tiles, to stay under the limit

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function store(area, key, value) {
    try { area.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function read(area, key, fallback) {
    try { return safeParse(area.getItem(key), fallback); } catch (e) { return fallback; }
  }

  var hearts = document.querySelectorAll(".tile[data-heart]");
  if (hearts.length) {
    var mine = read(window.localStorage, HEART_MINE, {}) || {};
    var seen = read(window.localStorage, HEART_SEEN, {}) || {};

    // Resolves {ok:true, value:n} for a real number, {ok:false} when the read
    // failed and the number on screen should be left as it is.
    function counter(key) {
      return fetch(HEART_API + "/get/" + HEART_NS + "/" + encodeURIComponent(key))
        .then(function (r) {
          if (r.status === 404) return { ok: true, value: 0 }; // nobody yet
          if (!r.ok) return { ok: false };                     // 429 and friends
          return r.json().then(function (d) {
            return typeof d.value === "number" ? { ok: true, value: d.value } : { ok: false };
          });
        })
        .catch(function () { return { ok: false }; });
    }
    function bump(key) {
      return fetch(HEART_API + "/hit/" + HEART_NS + "/" + encodeURIComponent(key))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && typeof d.value === "number" ? d.value : null; })
        .catch(function () { return null; });
    }

    function paint(btn, count, on) {
      var label = btn.querySelector(".heart__count");
      if (typeof count === "number") label.textContent = String(Math.max(0, count));
      btn.classList.toggle("is-on", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      var n = parseInt(label.textContent, 10);
      if (isNaN(n)) n = 0;
      btn.setAttribute(
        "aria-label",
        btn.getAttribute("data-label") + " \u2014 " + n + (n === 1 ? " heart" : " hearts")
      );
    }

    function remember(slug, value) {
      seen[slug] = Math.max(0, value);
      store(window.localStorage, HEART_SEEN, seen);
    }

    var lastFetch = read(window.sessionStorage, HEART_FETCHED, 0) || 0;
    var stale = Date.now() - lastFetch > HEART_TTL;
    if (stale) store(window.sessionStorage, HEART_FETCHED, Date.now());

    hearts.forEach(function (tile, i) {
      var slug = tile.getAttribute("data-heart");
      var btn = tile.querySelector(".heart");
      if (!btn) return;
      var undoKey = slug + "-undo";
      var busy = false;

      // Start from the last number this browser saw, so a rate-limited or
      // offline load shows something plausible rather than a wrong zero.
      paint(btn, typeof seen[slug] === "number" ? seen[slug] : 0, mine[slug]);

      // One retry covers a transient rate-limit, which a first-time visitor
      // would otherwise see as a count of zero with nothing cached to fall
      // back on. After that we give up quietly.
      function refresh(attempt) {
        Promise.all([counter(slug), counter(undoKey)]).then(function (v) {
          if (!v[0].ok || !v[1].ok) {
            if (attempt === 0) setTimeout(function () { refresh(1); }, 4000 + i * HEART_STAGGER);
            return; // leave the shown number alone
          }
          var net = v[0].value - v[1].value;
          paint(btn, net, mine[slug]);
          remember(slug, net);
        });
      }

      if (stale) setTimeout(function () { refresh(0); }, i * HEART_STAGGER);

      btn.addEventListener("click", function () {
        if (busy) return; // ignore double-clicks while a write is in flight
        busy = true;

        var turningOn = !mine[slug];
        var label = btn.querySelector(".heart__count");
        var shown = parseInt(label.textContent, 10);
        if (isNaN(shown)) shown = 0;
        var target = Math.max(0, turningOn ? shown + 1 : shown - 1);

        if (turningOn) {
          mine[slug] = 1;
          btn.classList.remove("is-popping");
          void btn.offsetWidth; // restart the pop
          btn.classList.add("is-popping");
        } else {
          delete mine[slug];
        }
        store(window.localStorage, HEART_MINE, mine);
        paint(btn, target, turningOn); // optimistic
        remember(slug, target);

        bump(turningOn ? slug : undoKey)
          .then(function (value) {
            if (value === null) return;
            // Re-read the other half of the pair so the settled number is the
            // real shared total, not just our own optimistic guess.
            return counter(turningOn ? undoKey : slug).then(function (other) {
              if (!other.ok) return;
              var net = turningOn ? value - other.value : other.value - value;
              paint(btn, net, !!mine[slug]);
              remember(slug, net);
            });
          })
          .then(function () { busy = false; }, function () { busy = false; });
      });
    });
  }

  // 6) Copy an organiser's email to the clipboard instead of opening a mail
  //    app. The confirmation happens on the button itself and lasts a couple
  //    of seconds; the address is never printed on screen.
  function markCopied(btn, text) {
    btn.classList.add("is-copied");
    if (text) {
      if (!btn.getAttribute("data-copy-original")) {
        btn.setAttribute("data-copy-original", btn.textContent.trim());
      }
      btn.textContent = text;
    }
    clearTimeout(btn.__copyTimer);
    btn.__copyTimer = setTimeout(function () {
      btn.classList.remove("is-copied");
      btn.classList.remove("is-copy-failed");
      var original = btn.getAttribute("data-copy-original");
      if (original) btn.textContent = original;
    }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // execCommand path for older browsers and for pages served over plain http,
    // where navigator.clipboard is unavailable.
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    });
  }

  document.querySelectorAll("[data-copy-email]").forEach(function (btn) {
    var label = btn.getAttribute("data-copy-label"); // icon buttons have none
    btn.addEventListener("click", function () {
      copyText(btn.getAttribute("data-copy-email")).then(
        function () { markCopied(btn, label); },
        function () {
          btn.classList.add("is-copy-failed");
          markCopied(btn, label ? "Couldn't copy" : null);
        }
      );
    });
  });

  // 7) Landed from another page aiming at a section (hash stashed in <head>):
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
