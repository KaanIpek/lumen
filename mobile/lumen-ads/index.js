// Deliberately empty of logic.
//
// The game reaches this plugin through Capacitor.registerPlugin('LumenAds') in
// js/ads.js, because this project has no bundler and an import here would never
// be executed. The file exists so `main` resolves and npm is happy; the package
// is here for its NATIVE half.
module.exports = {};
