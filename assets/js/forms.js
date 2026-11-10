// Blush SD — form sending
// Sends the inquiry and testimonial forms to Formspree without leaving the site,
// then shows a thank-you note in place of the form.
// If the quiet send fails for any reason, the form falls back to the normal
// Formspree submit, so no message is ever lost.
document.addEventListener('DOMContentLoaded', function () {
  var forms = document.querySelectorAll('form[data-thanks]');

  Array.prototype.forEach.call(forms, function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.fallback === '1') return; // let the browser submit normally
      e.preventDefault();

      var button = form.querySelector('[type="submit"]');
      var label = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Sending…'; }

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('Formspree returned ' + res.status);
        showThanks(form);
      }).catch(function () {
        if (button) { button.disabled = false; button.textContent = label; }
        form.dataset.fallback = '1';
        HTMLFormElement.prototype.submit.call(form);
      });
    });
  });

  function showThanks(form) {
    var box = document.createElement('div');
    box.className = 'form-thanks';
    box.setAttribute('role', 'status');
    box.innerHTML =
      '<p class="form-thanks-eyebrow">Thank you</p>' +
      '<h2 class="form-thanks-title">' + form.dataset.thanks + '</h2>' +
      '<p class="form-thanks-body">' + (form.dataset.thanksBody || '') + '</p>' +
      '<a href="index.html" class="page-back-link">Back to Home</a>';
    form.parentNode.replaceChild(box, form);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
