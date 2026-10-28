// The page is complete without this file. It does three things, all from data
// already in the HTML or at this origin:
//
//   1. re-states every <time> in the reader's own time zone, and "checked" as
//      "4 minutes ago";
//   2. says so when the last check is overdue, because a frozen page that still
//      says "Everything is up" is the one failure a status page must not hide;
//   3. while the tab is visible, asks /status.json every minute for the latest
//      check. A check that changes nothing on the page only moves "checked";
//      one that changes something reloads the page.
(() => {
  const body = document.body;
  let checkedAt = Date.parse(body.dataset.checkedAt || '');
  const version = body.dataset.version;
  const staleMs = Number(body.dataset.staleMinutes) * 60_000;

  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  function ago(ms) {
    const minutes = Math.round((Date.now() - ms) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return relative.format(-minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (hours < 48) return relative.format(-hours, 'hour');
    return relative.format(-Math.round(hours / 24), 'day');
  }

  function paint() {
    for (const el of document.querySelectorAll('time[data-format]')) {
      const ms = Date.parse(el.getAttribute('datetime'));
      if (Number.isNaN(ms)) continue;
      const format = el.dataset.format;
      if (format === 'relative') {
        el.textContent = ago(ms);
        el.title = dateTime.format(ms);
      } else {
        el.textContent = (format === 'date' ? dateOnly : dateTime).format(ms);
      }
    }
    const stale = document.querySelector('.stale');
    if (stale && !Number.isNaN(checkedAt)) stale.hidden = Date.now() - checkedAt < staleMs;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const note = document.querySelector('.tz-note');
  if (note && tz) note.textContent = `Times are in your time zone (${tz}).`;

  paint();

  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    paint();
    try {
      const res = await fetch('/status.json', { cache: 'no-store' });
      if (!res.ok) return;
      const latest = await res.json();
      if (latest.version !== version) {
        location.reload();
        return;
      }
      const ms = Date.parse(latest.checkedAt || '');
      const el = document.querySelector('.checked time');
      if (el && !Number.isNaN(ms) && ms > checkedAt) {
        checkedAt = ms;
        el.setAttribute('datetime', latest.checkedAt);
        paint();
      }
    } catch {
      // Offline or GitHub is slow — keep what is on screen; the overdue note
      // covers the case where this lasts.
    }
  }
  setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', refresh);
})();
