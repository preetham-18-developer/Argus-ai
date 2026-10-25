(function (root) {
  'use strict';

  root.ARGUS_FEATURES = Object.assign(
    { staircaseMode: true },
    root.ARGUS_FEATURES || {}
  );

  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-feature-flag]').forEach((element) => {
      if (root.ARGUS_FEATURES[element.dataset.featureFlag] === false) {
        element.hidden = true;
        element.style.display = 'none';
      }
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
