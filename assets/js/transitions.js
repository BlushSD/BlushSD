// Blush SD — "Blush Veil" page transition
// Tapping a link to another page raises a soft blush sheet with the gold logo,
// the next page loads behind it, then the sheet lifts away.
// Skipped for visitors who have "reduce motion" turned on.
(function () {
  var KEY = 'blushVeil';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function veil() { return document.querySelector('.page-veil'); }
  function restart(el, cls) {
    el.classList.remove('is-cover', 'is-reveal');
    void el.offsetWidth;
    if (cls) el.classList.add(cls);
  }

  // ---- Arriving on a page: lift the veil once the first photo is ready ----
  function reveal() {
    var v = veil();
    root.classList.remove('veil-arriving');
    if (!v) return;
    restart(v, 'is-reveal');
    setTimeout(function () { v.classList.remove('is-reveal'); }, 900);
  }

  if (root.classList.contains('veil-arriving')) {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    var done = false;
    var go = function () { if (!done) { done = true; setTimeout(reveal, 120); } };
    document.addEventListener('DOMContentLoaded', function () {
      var img = document.querySelector('.hero-img, .page-hero img');
      if (img && !img.complete) {
        img.addEventListener('load', go);
        img.addEventListener('error', go);
        setTimeout(go, 1200); // never wait longer than this
      } else {
        go();
      }
    });
  }

  // Coming back with the browser's Back button: make sure the page isn't covered
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      root.classList.remove('veil-arriving');
      var v = veil();
      if (v) v.classList.remove('is-cover', 'is-reveal');
    }
  });

  if (reduce) return;

  // ---- Leaving a page: cover, then go ----
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(sms|tel|mailto|javascript):/i.test(href)) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // same page
    var v = veil();
    if (!v) return;

    e.preventDefault();
    try { sessionStorage.setItem(KEY, '1'); } catch (err) {}
    restart(v, 'is-cover');
    setTimeout(function () { location.href = url.href; }, 640);
  });
})();
