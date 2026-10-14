// UTEA website Worker: serves the static site and one small API route.
//
// GET /api/events — upcoming meetups from the UTEA Luma calendar (lu.ma/utea)
// as JSON for the homepage calendar. Browsers can't read Luma's iCal feed from
// our domain (no CORS headers), so the Worker fetches it server-side, keeps the
// events that haven't ended yet, and caches the result at the edge for 15 min.
//
// Every other request is a static file from the repo (env.ASSETS); static
// files are matched before this code runs, so pages never touch the Worker.

const ICS_URLS = [
  "https://api.luma.com/ics/get?entity=calendar&id=cal-fh8Pi0BvCtkoalt",
  "https://api.lu.ma/ics/get?entity=calendar&id=cal-fh8Pi0BvCtkoalt", // older domain, same feed
];
const CACHE_SECONDS = 900;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events") return events(request, ctx);
    return env.ASSETS.fetch(request);
  },
};

async function events(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/events", request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let list = null;
  for (const src of ICS_URLS) {
    try {
      const res = await fetch(src, { headers: { accept: "text/calendar" } });
      const text = res.ok ? await res.text() : "";
      if (text.includes("BEGIN:VCALENDAR")) {
        list = upcoming(parseIcs(text));
        break;
      }
    } catch (err) {
      // try the next address
    }
  }
  if (!list) return json({ events: [], error: "unavailable" }, 502, "no-store");

  const response = json({ events: list }, 200, "public, max-age=" + CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function json(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

// Minimal iCal reader: unfold continuation lines, then collect each VEVENT's
// properties by name. Luma writes timed events in UTC ("...Z") and all-day
// events as VALUE=DATE.
export function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(";");
    current[name.toUpperCase()] = { value: line.slice(colon + 1), params };
  }
  return events.map(toEvent).filter(Boolean);
}

function toEvent(raw) {
  if (!raw.DTSTART || !raw.SUMMARY) return null;
  if (raw.STATUS && raw.STATUS.value.toUpperCase() === "CANCELLED") return null;
  const start = toDate(raw.DTSTART);
  if (!start) return null;
  const end = raw.DTEND ? toDate(raw.DTEND) : start;
  const description = raw.DESCRIPTION ? unescape(raw.DESCRIPTION.value) : "";
  const link = (raw.URL && raw.URL.value) ||
    (description.match(/https:\/\/(?:lu\.ma|luma\.com)\/[\w-]+/) || [])[0] ||
    "https://lu.ma/utea";
  const location = raw.LOCATION ? unescape(raw.LOCATION.value) : "";
  return {
    id: raw.UID ? raw.UID.value : start.iso + raw.SUMMARY.value,
    title: unescape(raw.SUMMARY.value),
    start: start.iso,
    end: end ? end.iso : start.iso,
    allDay: start.allDay,
    location,
    place: location.split(",")[0].trim(),
    url: link,
  };
}

// "20261022T220000Z" -> ISO instant; "20261023" (VALUE=DATE) -> "2026-10-23".
function toDate(prop) {
  const v = prop.value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`, allDay: false };
}

function unescape(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

export function upcoming(events) {
  const now = Date.now();
  return events
    .filter((e) => {
      // All-day events count until the end of their last day in Toronto.
      const end = Date.parse(e.allDay ? e.end + "T23:59:59-05:00" : e.end);
      return isNaN(end) ? Date.parse(e.start) >= now : end >= now;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 20);
}
