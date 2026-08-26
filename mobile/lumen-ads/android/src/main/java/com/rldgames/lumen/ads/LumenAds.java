package com.rldgames.lumen.ads;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

import java.util.ArrayList;
import java.util.List;

/**
 * LUMEN — rewarded ads on Android.
 *
 * The exact same four-method contract as the iOS half, because js/ads.js is one
 * file and must not learn which platform it is on:
 *
 *   initialize()            -> resolve
 *   requestTracking()       -> resolve { status, tracking }
 *   prepare({ adId })       -> resolve when an ad is loaded, reject when not
 *   show()                  -> resolve { earned: boolean }
 *
 * Two rules carried over from the iOS file because they are not iOS problems:
 *
 *  - Presentation happens on the UI thread. Capacitor runs plugin methods off
 *    it, and showing from a background thread is how the iOS side spent a build
 *    reporting "no ad right now" for an ad that had loaded perfectly.
 *  - show() resolves when the ad is DISMISSED, not when it is presented.
 *    Resolving early pays a player who closed it instantly, and closing early is
 *    a choice rather than a failure, so it resolves { earned: false } instead of
 *    rejecting.
 */
@CapacitorPlugin(name = "LumenAds")
public class LumenAds extends Plugin {

    private RewardedAd rewarded;
    private PluginCall pending;
    private boolean earned;
    // One load in flight, and everybody who asked while it was running. Without
    // this, a preload and a tap arriving during it start two loads of the same
    // unit and the slower completion overwrites the ad the faster one gave out.
    private boolean loading;
    private final List<PluginCall> waiting = new ArrayList<>();

    @PluginMethod
    public void initialize(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            MobileAds.initialize(activity, status -> {});
            call.resolve();
        });
    }

    /**
     * There is no App Tracking Transparency on Android — the advertising id is
     * governed by a system setting the app does not get to prompt for. Resolving
     * with the same shape the iOS side uses keeps js/ads.js free of platform
     * branches: "unavailable" means nobody was asked, and tracking stays true
     * because nothing here has denied it.
     */
    @PluginMethod
    public void requestTracking(PluginCall call) {
        JSObject out = new JSObject();
        out.put("status", "unavailable");
        out.put("tracking", true);
        call.resolve(out);
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        final String unit = call.getString("adId", "");
        if (unit == null || unit.isEmpty()) { call.reject("no ad unit"); return; }
        Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }

        // ANSWER AT ONCE IF ONE IS ALREADY LOADED, and that is the whole point.
        // This used to load unconditionally, which made the preload in js/ads.js
        // pure waste -- every tap paid for a full network load before anything
        // could be shown, reported as "you have to press a few times and it
        // comes very slowly".
        activity.runOnUiThread(() -> {
            if (rewarded != null) { call.resolve(); return; }
            waiting.add(call);
            if (loading) return;
            loading = true;
            RewardedAd.load(
                activity, unit, new AdRequest.Builder().build(),
                new RewardedAdLoadCallback() {
                    @Override public void onAdLoaded(RewardedAd ad) {
                        loading = false;
                        rewarded = ad;
                        for (PluginCall c : drain()) c.resolve();
                    }
                    @Override public void onAdFailedToLoad(LoadAdError error) {
                        // Ordinary: no fill, no network, a unit that is not
                        // serving yet. The caller turns this into "try again
                        // shortly".
                        loading = false;
                        rewarded = null;
                        String why = "load failed: " + error.getMessage();
                        for (PluginCall c : drain()) c.reject(why);
                    }
                });
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }

        activity.runOnUiThread(() -> {
            if (rewarded == null) { call.reject("nothing loaded"); return; }
            call.setKeepAlive(true);
            pending = call;
            earned = false;

            rewarded.setFullScreenContentCallback(new FullScreenContentCallback() {
                @Override public void onAdDismissedFullScreenContent() { finish(); }
                @Override public void onAdFailedToShowFullScreenContent(AdError error) {
                    // A presentation failure is an error, not "watched and earned
                    // nothing" — reporting it as the latter is what left the iOS
                    // side saying "no ad right now" with nothing after it.
                    rewarded = null;
                    PluginCall c = pending;
                    pending = null;
                    if (c != null) { c.reject("present failed: " + error.getMessage()); c.setKeepAlive(false); }
                }
            });

            rewarded.show(activity, reward -> earned = true);
        });
    }

    // Hand out the queue and clear it in one step, so a listener that fires
    // twice cannot answer the same call twice.
    private List<PluginCall> drain() {
        List<PluginCall> out = new ArrayList<>(waiting);
        waiting.clear();
        return out;
    }

    private void finish() {
        rewarded = null;
        PluginCall c = pending;
        pending = null;
        if (c == null) return;
        JSObject out = new JSObject();
        out.put("earned", earned);
        c.resolve(out);
        c.setKeepAlive(false);
    }
}
