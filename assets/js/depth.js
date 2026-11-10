// Blush SD — depth + touch layer
// 1. On computers, the photo and caption on each Florals/Catering card drift
//    gently against the cursor, with a soft light following it.
// 2. On Android phones, taps on buttons and links give a tiny vibration.
//    (iPhones don't allow websites to vibrate, so nothing happens there.)
document.addEventListener('DOMContentLoaded', function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduceMotion) {
    document.querySelectorAll('.offering-card').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--mx', x.toFixed(3));
        card.style.setProperty('--my', y.toFixed(3));
        card.style.setProperty('--lx', ((x + 0.5) * 100).toFixed(1) + '%');
        card.style.setProperty('--ly', ((y + 0.5) * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', function () {
        card.style.setProperty('--mx', '0');
        card.style.setProperty('--my', '0');
      });
    });
  }

  if (navigator.vibrate) {
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      if (e.target.closest && e.target.closest('a, button, .form-submit')) {
        try { navigator.vibrate(8); } catch (err) {}
      }
    }, { passive: true });
  }
});
