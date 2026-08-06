# Ads

One kind, and one only: **rewarded**. The player asks, watches, and is paid.
Nothing interrupts a run, nothing appears between menus, nothing needs
dismissing. An ad you did not ask for is a tax on playing; an ad you chose is a
trade.

## The number

**75 shards, three times a day.**

The shop's real items cost 4,500 and 9,000. At 50 a player does the arithmetic,
sees ninety ads, and never watches one. Above 100 the ads beat playing, and the
game becomes a waiting room. 75 is roughly a good run — so an ad repeats a good
run instead of replacing it. Three a day is 225: a 4,500 item is about twenty
days on ads alone, far less if you actually play. An accelerator, not a
shortcut.

## Right now it is TEST ads

`js/ads.js` falls back to Google's published sample units when
`CONFIG.admob` has no real ones. They render the real ad UI and the real
callbacks while serving nothing and earning nothing — which is what you want
before there is anything to earn from, and while the app is in review without an
ads declaration.

## Before real units go live — ALL of this, in the same release

Switching `CONFIG.admob` to live ids is **not** a config change. A live AdMob
unit collects a device identifier and serves personalised advertising, so:

1. **App Privacy** gains `Identifiers -> Device ID` and `Used for Tracking: Yes`.
   The current declaration says the opposite. Shipping live units against it
   makes the store listing a false statement.
2. **App Tracking Transparency** becomes mandatory on iOS: `NSUserTrackingUsageDescription`
   in the plist, and the prompt shown before any tracking request.
   `Ads.init()` passes `requestTrackingAuthorization: false` today precisely
   because there is nothing to ask about yet.
3. **AdMob needs LUMEN's own app records.** The account currently holds two, both
   Shelves & Streets. Using those ids would file LUMEN's revenue, policy status
   and reporting under a different game.
4. The age rating may need revisiting — a 4+ game serving third-party ads has
   rules of its own.

Do these together or not at all. Half of this shipped is a compliance problem,
not a bug.

## The native plugin is NOT in the build

`@capacitor-community/admob` v6 does not compile against the toolchain this
project uses:

```
ConsentExecutor.swift: error: 'sharedInstance' … 'UMPConsentStatus' …
```

It is written against UserMessagingPlatform 2.x and the resolved SDK is 3.x,
which renamed exactly what it calls. Pinning `GoogleUserMessagingPlatform` in
the Podfile does not help — the plugin's own podspec resolves the dependency and
the pin is ignored. Two builds confirmed that.

This is a COMPILE failure, so the unsigned-archive fallback cannot rescue it and
NOTHING ships while the plugin is present. That is why it has been removed
rather than left in place broken: a pipeline that cannot produce a build is a
worse problem than a feature that is not finished.

`js/ads.js` stays. It is provider-agnostic and already covered by tests against
a stub, and with no plugin present it reports `available: false`, so the button
never appears — which is its designed behaviour, not a workaround.

Next attempt, in rough order of promise:
1. `@capacitor-community/admob` v7 plus a Capacitor 6 -> 7 migration.
2. A `post_install` hook in the Podfile forcing the older UMP into the plugin's
   own target, rather than a top-level pod line.
3. A thin native shim in the iOS project calling GADRewardedAd directly, which
   is about forty lines and no third-party plugin at all.
