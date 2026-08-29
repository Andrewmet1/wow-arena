/**
 * Cookie consent banner + Google Analytics (GA4) with opt-in/opt-out.
 * Analytics only loads after user accepts. Consent stored in localStorage.
 * Include this script on every page: <script src="/src/analytics/consent.js"></script>
 */
(function() {
  var GA_ID = 'G-XXXXXXXXXX'; // Replace with real GA4 Measurement ID
  var CONSENT_KEY = 'ec_analytics_consent';

  function getConsent() {
    return localStorage.getItem(CONSENT_KEY); // 'accepted', 'rejected', or null
  }

  function setConsent(value) {
    localStorage.setItem(CONSENT_KEY, value);
  }

  function loadGA() {
    if (document.getElementById('ga-script')) return;
    var s = document.createElement('script');
    s.id = 'ga-script';
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function removeGA() {
    // Delete GA cookies
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var name = cookies[i].split('=')[0].trim();
      if (name.indexOf('_ga') === 0 || name.indexOf('_gid') === 0) {
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + location.hostname;
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
      }
    }
  }

  function hideBanner() {
    var b = document.getElementById('cookie-consent-banner');
    if (b) b.style.display = 'none';
  }

  function showBanner() {
    // Don't show if already decided
    if (getConsent()) return;

    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:rgba(10,10,20,0.97);border-top:1px solid #2a2a3a;padding:16px 24px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font-family:inherit;backdrop-filter:blur(12px);';

    var text = document.createElement('span');
    text.style.cssText = 'color:#a0a0a0;font-size:12px;line-height:1.5;max-width:600px;';
    text.innerHTML = 'We use cookies for analytics to improve the game. No tracking for ads. <a href="/privacy/" style="color:#c8a860;text-decoration:underline;">Privacy Policy</a>';

    var acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'ACCEPT';
    acceptBtn.style.cssText = 'padding:8px 20px;background:linear-gradient(135deg,#c8a860,#8b6914);color:#0a0a0a;font-size:10px;font-weight:800;letter-spacing:2px;border:none;border-radius:3px;cursor:pointer;white-space:nowrap;';
    acceptBtn.onclick = function() {
      setConsent('accepted');
      loadGA();
      hideBanner();
    };

    var rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'DECLINE';
    rejectBtn.style.cssText = 'padding:8px 20px;background:transparent;color:#666;font-size:10px;font-weight:800;letter-spacing:2px;border:1px solid #333;border-radius:3px;cursor:pointer;white-space:nowrap;';
    rejectBtn.onclick = function() {
      setConsent('rejected');
      removeGA();
      hideBanner();
    };

    banner.appendChild(text);
    banner.appendChild(acceptBtn);
    banner.appendChild(rejectBtn);
    document.body.appendChild(banner);
  }

  // Skip analytics entirely on native mobile apps (Capacitor)
  var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isCapacitor) return;

  // On load: check consent
  var consent = getConsent();
  if (consent === 'accepted') {
    loadGA();
  } else if (consent === 'rejected') {
    // Do nothing
  } else {
    // No decision yet — show banner after short delay
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { setTimeout(showBanner, 1000); });
    } else {
      setTimeout(showBanner, 1000);
    }
  }
})();
