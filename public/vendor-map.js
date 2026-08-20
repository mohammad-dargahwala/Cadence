/* Cadence — dependency pinning.
 *
 * support.js resolves React and ReactDOM from unpkg by default. The runtime
 * checks window.__resources for an override first, so declaring it here (before
 * support.js executes) redirects those loads to files we serve ourselves.
 *
 * The versions in /vendor are the exact ones support.js pins, taken from the
 * npm registry. Self-hosting means the app has no third-party runtime
 * dependency: it keeps working behind a firewall, on a plane, or if unpkg has
 * an outage, and no page view is reported to a CDN we do not control.
 *
 * This file must load before support.js. It touches no markup or styling.
 */
window.__resources = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js':
    './vendor/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':
    './vendor/react-dom.production.min.js',
};
