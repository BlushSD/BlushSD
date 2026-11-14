/* Blush SD — inquiry form submission
 *
 * Sends the Book Florals / Book Catering forms to the Blush inquiries Worker
 * and shows the on-page confirmation with the customer's reference number.
 *
 * Safety net: if this script, the Worker or the spam check can't be reached,
 * the form falls back to Formspree exactly as it worked before.
 */
(function () {
  // ===== SETTING: the address of the inquiries Worker (no slash at the end) =====
  var API = 'https://blush-inquiries.blushsd619.workers.dev';
  // ===== SETTING: the Turnstile site key (public — safe to be in this file) =====
  // While this says REPLACE_ME the new system stays OFF and the forms keep
  // using Formspree exactly as before. Fill it in last (worker/SETUP.md, Part F).
  var TURNSTILE_SITE_KEY = '0x4AAAAAAF-ye9RkbMsUHUEL';

  var form = document.querySelector('form.signup-form');
  if (!form || /REPLACE_ME/.test(API + TURNSTILE_SITE_KEY) || !window.fetch || !window.JSON || !window.Promise) return;

  // Tell forms.js this form is handled here (forms.js covers it while this is off).
  form.dataset.managed = '1';

  var turnstileToken = '';
  loadTurnstile();

  var button = form.querySelector('.form-submit');
  var statusEl = form.querySelector('.form-status');
  var confirmEl = document.querySelector('.inquiry-confirm');
  var introEl = document.querySelector('.inquiry-intro');
  var typeInput = form.querySelector('input[name="form_type"]');
  var service = typeInput && /catering/i.test(typeInput.value) ? 'catering' : 'florals';
  var buttonLabel = button ? button.textContent : '';
  var submissionId = makeId();
  var sending = false;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    if (form.checkValidity && !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    send();
  });

  function send() {
    sending = true;
    setBusy(true);
    showStatus('');

    waitForTurnstile(8000).then(function (token) {
      if (!token) {
        // Spam check couldn't load (blocked or offline) — use the old route.
        return fallbackToFormspree();
      }
      return post(collect(token));
    }).catch(function () {
      fallbackToFormspree();
    });
  }

  function collect(token) {
    function val(name) {
      var el = form.elements[name];
      return el ? String(el.value || '') : '';
    }
    return {
      submission_id: submissionId,
      service: service,
      name: val('name'),
      email: val('email'),
      phone: val('phone'),
      event_date: val('event-date'),
      venue: val('venue'),
      guests: val('guests'),
      message: val('message'),
      _gotcha: val('_gotcha'),
      turnstile_token: token
    };
  }

  function post(payload) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);

    return fetch(API + '/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data.ok) {
          sendEmailCopy(data.reference);
          return showConfirmation(data);
        }
        if (res.status >= 500) return fallbackToFormspree();
        handleProblem(res.status, data);
      });
    }, function () {
      clearTimeout(timer);
      fallbackToFormspree();
    });
  }

  function handleProblem(status, data) {
    sending = false;
    setBusy(false);
    resetTurnstile();
    if (status === 422 && data && data.fields) {
      var first = Object.keys(data.fields)[0];
      var labels = { name: 'your name', email: 'your email address', phone: 'your phone number', event_date: 'the event date',
        venue: 'the venue', guests: 'the guest count', message: 'your message' };
      showStatus('Please check ' + (labels[first] || 'the form') + ' and try again.');
      var field = form.elements[first === 'event_date' ? 'event-date' : first];
      if (field && field.focus) field.focus();
    } else if (status === 429) {
      showStatus('We’ve received several inquiries from you already. Please email us directly at blushsd619@gmail.com.');
    } else if (status === 403) {
      showStatus('We couldn’t confirm your submission. Please try again in a moment.');
    } else {
      showStatus('Something went wrong. Please try again, or email us at blushsd619@gmail.com.');
    }
  }

  function showConfirmation(data) {
    if (!confirmEl) return;
    var refEl = confirmEl.querySelector('[data-ref]');
    var igEl = confirmEl.querySelector('[data-ig]');
    var copyEl = confirmEl.querySelector('[data-copy]');
    var startEl = confirmEl.querySelector('[data-ig-start]');
    var helpEl = confirmEl.querySelector('[data-ig-help]');
    var msgEl = confirmEl.querySelector('[data-ig-msg]');
    var statusIgEl = confirmEl.querySelector('[data-ig-status]');

    if (refEl) refEl.textContent = data.reference;
    if (igEl && /^https:\/\/ig\.me\//.test(data.ig_link || '')) igEl.href = data.ig_link;

    // The ready-made first message for Instagram, e.g.
    // "Hi Blush! This is Jane. My inquiry reference is BL-7K3Q-M9XD."
    var nameField = form.elements.name;
    var first = nameField ? String(nameField.value || '').trim().split(/\s+/)[0] : '';
    var dm = 'Hi Blush! ' + (first ? 'This is ' + first + '. ' : '') +
      'My ' + (service === 'catering' ? 'catering' : 'floral') + ' inquiry reference is ' + data.reference + '.';
    if (msgEl) msgEl.textContent = dm;

    if (copyEl) {
      copyEl.addEventListener('click', function () {
        copyText(data.reference).then(function () {
          copyEl.textContent = 'Copied';
          setTimeout(function () { copyEl.textContent = 'Copy'; }, 2000);
        });
      });
    }

    // Tap 1: copy the message and show the three simple steps.
    // Tap 2: "Open Instagram" opens the chat with Blush.
    if (startEl && helpEl) {
      startEl.addEventListener('click', function () {
        copyText(dm).then(function (ok) {
          if (statusIgEl) {
            statusIgEl.textContent = ok ? 'Your message is copied' : 'Your message';
          }
          if (!ok && msgEl) selectText(msgEl);
        });
        startEl.hidden = true;
        helpEl.hidden = false;
        var y = helpEl.getBoundingClientRect().top + window.pageYOffset - 90;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      });
    }
    // Re-copy on the second tap too, in case something else was copied in between.
    if (igEl) {
      igEl.addEventListener('click', function () { copyText(dm); });
    }

    form.hidden = true;
    if (introEl) introEl.hidden = true;
    confirmEl.hidden = false;
    confirmEl.focus({ preventScroll: true });
    var top = confirmEl.getBoundingClientRect().top + window.pageYOffset - 100;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Email backup: the same inquiry also goes to Noor's email through Formspree,
  // tagged with the reference. Sent in the background; the customer doesn't wait.
  function sendEmailCopy(reference) {
    try {
      var fd = new FormData(form);
      fd.delete('cf-turnstile-response');
      fd.set('reference', reference);
      var t = fd.get('form_type') || 'Inquiry';
      fd.set('_subject', 'New ' + t + ' ' + reference + ' \u2014 Blush SD');
      fetch(form.action, {
        method: 'POST',
        body: fd,
        headers: { Accept: 'application/json' },
        keepalive: true
      }).catch(function () { /* the phone alert and saved copy still exist */ });
    } catch (err) { /* ignore */ }
  }

  // Last resort: hand the form to Formspree the way it always worked.
  // form.submit() skips this script's listener, so it can't loop.
  function fallbackToFormspree() {
    var extra = form.querySelectorAll('input[name="cf-turnstile-response"]');
    for (var i = 0; i < extra.length; i++) extra[i].disabled = true;
    HTMLFormElement.prototype.submit.call(form);
  }

  // Cloudflare Turnstile spam check. "interaction-only" keeps it invisible
  // unless Cloudflare needs the visitor to tick a box.
  var widgetId = null;
  function loadTurnstile() {
    var slot = form.querySelector('.form-turnstile');
    if (!slot) return;
    window.blushTurnstileReady = function () {
      try {
        widgetId = window.turnstile.render(slot, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: 'interaction-only',
          theme: 'light',
          action: 'inquiry',
          callback: function (token) { turnstileToken = token; },
          'expired-callback': function () { turnstileToken = ''; },
          'error-callback': function () { turnstileToken = ''; }
        });
      } catch (err) { /* fall back to Formspree on submit */ }
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=blushTurnstileReady&render=explicit';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  function waitForTurnstile(maxMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function check() {
        if (turnstileToken) return resolve(turnstileToken);
        if (Date.now() - start > maxMs) return resolve('');
        setTimeout(check, 200);
      })();
    });
  }

  function resetTurnstile() {
    turnstileToken = '';
    try { if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); } catch (err) { /* ignore */ }
  }

  function setBusy(on) {
    if (!button) return;
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.textContent = on ? 'Sending…' : buttonLabel;
  }

  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }

  // Resolves true if the text reached the clipboard, false if the browser refused.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(t);
    return ok;
  }

  // If copying is blocked, highlight the message so the customer can copy it by hand.
  function selectText(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) { /* ignore */ }
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
})();
