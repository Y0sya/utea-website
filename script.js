// University of Toronto Effective Altruism — interactions
(function () {
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function isHome(path) { return path === "/" || /\/index(\.html)?$/.test(path); }

  // 1) The line under the nav only appears once the page has scrolled.
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 4);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // 2) Clicking the brand while already home scrolls to top instead of
  //    reloading.
  var brand = document.querySelector(".brand");
  if (brand) {
    brand.addEventListener("click", function (e) {
      var samePage = brand.pathname === location.pathname
        || (isHome(brand.pathname) && isHome(location.pathname));
      if (!samePage) return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      if (location.hash && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
  }

  // Clipboard helper shared by the email buttons and the iCal link.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // execCommand path for older browsers and pages served over plain http.
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

  // Briefly mark a button as copied; text buttons also swap their label.
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

  // 3) Copy an organiser's email (or the calendar's iCal link) to the
  //    clipboard. The address is never printed on screen.
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    var label = btn.getAttribute("data-copy-label"); // icon buttons have none
    btn.addEventListener("click", function () {
      copyText(btn.getAttribute("data-copy")).then(
        function () { markCopied(btn, label); },
        function () {
          btn.classList.add("is-copy-failed");
          markCopied(btn, label ? "Couldn't copy" : null);
        }
      );
    });
  });

  // 4) Subscribe menu: a <details> dropdown, closed by Escape or a click
  //    anywhere else.
  document.querySelectorAll(".subscribe").forEach(function (menu) {
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  });

  // 5) Meetup calendar. Events come from /api/events (a Pages Function that
  //    reads the UTEA Luma calendar's iCal feed). Dates are shown in Toronto
  //    time whatever the visitor's timezone.
  var cal = document.querySelector("[data-calendar]");
  if (cal) {
    var TZ = "America/Toronto";
    var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"];
    var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    var monthEl = cal.querySelector(".cal__month");
    var gridEl = cal.querySelector(".cal__grid");
    var listEl = cal.querySelector(".cal__list");
    var emptyEl = cal.querySelector(".cal__empty");

    var dayParts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short"
    });
    var clock = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

    function torontoDay(date) {
      var p = {};
      dayParts.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month - 1, d: +p.day, wd: p.weekday };
    }
    function sameDay(a, b) { return a.y === b.y && a.m === b.m && a.d === b.d; }
    function before(a, b) { return a.y !== b.y ? a.y < b.y : a.m !== b.m ? a.m < b.m : a.d < b.d; }

    var today = torontoDay(new Date());
    var view = { y: today.y, m: today.m };
    var events = [];
    var picked = null;

    function normalize(e, i) {
      var day, time;
      if (e.allDay) {
        var p = e.start.split("-");
        day = { y: +p[0], m: +p[1] - 1, d: +p[2] };
        day.wd = WEEKDAYS[new Date(day.y, day.m, day.d).getDay()];
        time = "All day";
      } else {
        var start = new Date(e.start);
        var end = new Date(e.end);
        day = torontoDay(start);
        time = end > start
          ? (clock.formatRange ? clock.formatRange(start, end) : clock.format(start) + " – " + clock.format(end))
          : clock.format(start);
      }
      return {
        id: e.id || String(i),
        title: e.title,
        day: day,
        meta: [day.wd, time, e.place].filter(Boolean).join(" · "),
        url: e.url || "https://lu.ma/utea"
      };
    }

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function select(ev) {
      picked = ev.id;
      view = { y: ev.day.y, m: ev.day.m };
      render();
    }

    function renderGrid() {
      monthEl.textContent = MONTHS[view.m] + " " + view.y;
      gridEl.textContent = "";
      var first = new Date(view.y, view.m, 1).getDay();
      var days = new Date(view.y, view.m + 1, 0).getDate();
      for (var b = 0; b < first; b++) gridEl.appendChild(el("span", "day", ""));
      for (var d = 1; d <= days; d++) {
        var date = { y: view.y, m: view.m, d: d };
        var ev = null;
        for (var i = 0; i < events.length; i++) {
          if (sameDay(events[i].day, date)) { ev = events[i]; break; }
        }
        var cell;
        if (ev) {
          cell = el("button", "day day--event", String(d));
          cell.type = "button";
          cell.setAttribute("aria-pressed", ev.id === picked ? "true" : "false");
          cell.setAttribute("aria-label", ev.title + ", " + MONTHS[view.m] + " " + d);
          cell.addEventListener("click", select.bind(null, ev));
        } else {
          cell = el("span", "day", String(d));
        }
        if (before(date, today)) cell.classList.add("day--past");
        if (sameDay(date, today)) cell.classList.add("day--today");
        gridEl.appendChild(cell);
      }
    }

    function renderList() {
      listEl.textContent = "";
      events.slice(0, 5).forEach(function (ev) {
        var li = el("li", "event" + (ev.id === picked ? " is-selected" : ""));

        var pick = el("button", "event__pick");
        pick.type = "button";
        var date = el("span", "event__date");
        date.appendChild(el("span", "event__mon", MONTHS[ev.day.m].slice(0, 3).toUpperCase()));
        date.appendChild(el("span", "event__day", String(ev.day.d)));
        var text = el("span", "event__text");
        text.appendChild(el("span", "event__title", ev.title));
        text.appendChild(el("span", "event__meta", ev.meta));
        pick.appendChild(date);
        pick.appendChild(text);
        pick.addEventListener("click", select.bind(null, ev));

        var rsvp = el("a", "rsvp", "RSVP");
        rsvp.href = ev.url;
        rsvp.target = "_blank";
        rsvp.rel = "noopener";
        rsvp.setAttribute("aria-label", "RSVP for " + ev.title + " on " + MONTHS[ev.day.m] + " " + ev.day.d + " (opens Luma)");
        rsvp.insertAdjacentHTML("beforeend",
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>');

        li.appendChild(pick);
        li.appendChild(rsvp);
        listEl.appendChild(li);
      });
    }

    function render() {
      renderGrid();
      renderList();
    }

    cal.querySelector("[data-cal-prev]").addEventListener("click", function () {
      var d = new Date(view.y, view.m - 1, 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
      renderGrid();
    });
    cal.querySelector("[data-cal-next]").addEventListener("click", function () {
      var d = new Date(view.y, view.m + 1, 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
      renderGrid();
    });

    render();

    fetch("/api/events", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        events = (data.events || []).map(normalize);
        if (events.length) {
          picked = events[0].id;
          view = { y: events[0].day.y, m: events[0].day.m };
          render();
          listEl.hidden = false;
        } else {
          emptyEl.hidden = false;
        }
      })
      .catch(function () {
        emptyEl.textContent = "";
        emptyEl.appendChild(document.createTextNode("Couldn't load meetups. They're also on "));
        var a = el("a", null, "lu.ma/utea");
        a.href = "https://lu.ma/utea";
        a.target = "_blank";
        a.rel = "noopener";
        emptyEl.appendChild(a);
        emptyEl.appendChild(document.createTextNode("."));
        emptyEl.hidden = false;
      });
  }

  // 6) Resource hearts. Counts are shared across everyone via a public counter
  //    (Abacus); which ones *you* hearted is remembered per-browser. The
  //    service only offers a keyless increment, so each resource keeps a pair
  //    of counters — "<slug>" for hearts and "<slug>-undo" for hearts taken
  //    back — and the number on screen is the difference. That way un-hearting
  //    really does lower the count for everyone.
  //
  //    The API rate-limits to 30 requests per 10s per IP, and a whole page is
  //    two requests per resource, so reads are staggered, cached, and a failed
  //    read (429, offline) leaves the last known number alone instead of
  //    showing a zero that isn't true. Only a 404 — nobody has hearted this
  //    yet — is a real zero.
  var HEART_API = "https://abacus.jasoncameron.dev";
  var HEART_NS = "uteffectivealtruism-ca";
  var HEART_MINE = "utea:hearted";
  var HEART_SEEN = "utea:heartSeen";   // last known good counts, survives reloads
  var HEART_FETCHED = "utea:heartAt";  // when we last hit the network
  var HEART_TTL = 180000;
  var HEART_STAGGER = 130;             // ms between resources, to stay under the limit

  function safeParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function store(area, key, value) {
    try { area.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function read(area, key, fallback) {
    try { return safeParse(area.getItem(key), fallback); } catch (e) { return fallback; }
  }

  var hearts = document.querySelectorAll("[data-heart]");
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
        btn.getAttribute("data-label") + " — " + n + (n === 1 ? " heart" : " hearts")
      );
    }

    function remember(slug, value) {
      seen[slug] = Math.max(0, value);
      store(window.localStorage, HEART_SEEN, seen);
    }

    var lastFetch = read(window.sessionStorage, HEART_FETCHED, 0) || 0;
    var stale = Date.now() - lastFetch > HEART_TTL;
    if (stale) store(window.sessionStorage, HEART_FETCHED, Date.now());

    hearts.forEach(function (item, i) {
      var slug = item.getAttribute("data-heart");
      var btn = item.querySelector(".heart");
      if (!btn) return;
      var undoKey = slug + "-undo";
      var busy = false;

      // Start from the last number this browser saw, so a rate-limited or
      // offline load shows something plausible rather than a wrong zero.
      paint(btn, typeof seen[slug] === "number" ? seen[slug] : 0, mine[slug]);

      // One retry covers a transient rate-limit; after that give up quietly.
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
})();
