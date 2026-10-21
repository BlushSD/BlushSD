// Blush SD — nav menu toggle
// Opens/closes the full-screen nav overlay from the hamburger button.
document.addEventListener('DOMContentLoaded', function () {
  var openBtn = document.querySelector('.nav-hamburger');
  var closeBtn = document.querySelector('.nav-overlay-close');
  var overlay = document.getElementById('navOverlay');

  if (!openBtn || !overlay) return;

  function openMenu() {
    overlay.classList.add('open');
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    overlay.classList.remove('open');
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  openBtn.addEventListener('click', openMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);

  // Close when a menu link is clicked (so it doesn't stay open on the next page)
  overlay.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });
});

// Owner entrance: tap the "© 2026 Blush SD" line at the bottom of any page
// three times quickly to open the private Studio Insights page.
document.addEventListener('DOMContentLoaded', function () {
  var line = document.querySelector('footer p');
  if (!line) return;
  var taps = 0, timer;
  line.style.touchAction = 'manipulation'; // stops phones zooming on the quick taps
  line.style.webkitUserSelect = 'none';
  line.style.userSelect = 'none';
  line.addEventListener('click', function () {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(function () { taps = 0; }, 900);
    if (taps >= 3) { taps = 0; window.location.href = 'owner.html'; }
  });
});
