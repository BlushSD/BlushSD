// Blush SD — site analytics (Google Analytics 4)
// Loads GA4 and records the actions that matter to the business.
// To connect it: replace the ID on the line below with the Measurement ID
// from Google Analytics (Admin → Data streams → your stream). It starts with "G-".
var BLUSH_GA_ID = 'G-NPYPQZMW8L';

(function () {
  // Skip if the ID hasn't been filled in yet, or on the private owner pages.
  if (!/^G-[A-Z0-9]+$/.test(BLUSH_GA_ID) || BLUSH_GA_ID === 'G-XXXXXXXXXX') return;
  if (/\/owner(\.html)?$/.test(location.pathname)) return;

  // Standard Google tag loader
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + BLUSH_GA_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', BLUSH_GA_ID);

  function track(name, params) {
    gtag('event', name, Object.assign({ page_name: location.pathname.split('/').pop() || 'index.html' }, params));
  }

  // Which service a link or form belongs to
  function serviceFrom(href) {
    if (/floral/i.test(href)) return 'florals';
    if (/catering/i.test(href)) return 'catering';
    return 'general';
  }

  // One listener handles every click on the site, so no buttons need editing.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a, button');
    if (!el) return;
    var href = el.getAttribute('href') || '';
    var inMenu = !!el.closest('.nav-overlay');

    // "Book Florals" / "Book Catering" / "Request a Floral Quote" links
    if (/(florals|catering)-signup\.html/.test(href)) {
      track('book_click', { service: serviceFrom(href), location: inMenu ? 'menu' : 'page' });
    }
    // Homepage offering cards
    else if (el.classList.contains('offering-card')) {
      track('service_card_click', { service: serviceFrom(href) });
    }
    // Instagram / TikTok
    else if (/instagram\.com/.test(href)) {
      track('social_click', { network: 'instagram', location: el.closest('footer') ? 'footer' : 'page' });
    } else if (/tiktok\.com/.test(href)) {
      track('social_click', { network: 'tiktok', location: el.closest('footer') ? 'footer' : 'page' });
    }
    // Email and phone links (if added later)
    else if (/^mailto:/.test(href)) {
      track('email_click', {});
    } else if (/^tel:/.test(href)) {
      track('phone_click', {});
    }
    // Gallery photos opened
    else if (el.classList.contains('floral-tile') || el.classList.contains('gallery-tile')) {
      track('photo_view', { service: el.classList.contains('floral-tile') ? 'florals' : 'catering' });
    }
  });

  // Inquiry form sent — the most important number on the dashboard.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('signup-form')) return;
    var type = form.querySelector('input[name="form_type"]');
    track('inquiry_submit', {
      service: serviceFrom(type ? type.value : location.pathname),
      transport_type: 'beacon'
    });
  });
})();
