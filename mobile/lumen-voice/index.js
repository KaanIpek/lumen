// Deliberately empty of logic, exactly like lumen-ads and lumen-store.
//
// The game reaches this plugin through Capacitor.Plugins.LumenVoice in
// js/voice.js. This project has no bundler, so an import here would never run;
// the file exists so `main` resolves and the package is here for its NATIVE half.
module.exports = {};
