//
//  LUMEN — rewarded ads, without a third-party plugin
//
//  WHY THIS FILE EXISTS
//    @capacitor-community/admob v6 does not compile here: it is written against
//    UserMessagingPlatform 2.x and the resolved SDK is 3.x, which renamed the
//    consent APIs it calls. Pinning the pod does not help — the plugin's own
//    podspec resolves the dependency and ignores a top-level Podfile line. Two
//    builds confirmed that, and because it is a COMPILE failure it took the
//    whole pipeline down rather than one feature.
//
//    So: no plugin. This game shows exactly one kind of ad, rewarded, from one
//    place. That is a small enough surface to own outright, and owning it means
//    nothing here can break on somebody else's release schedule.
//
//    It deliberately does NOT touch UserMessagingPlatform. Consent is a real
//    obligation, but it belongs with the privacy declaration and the ATT prompt
//    in the release that turns live ads on — see docs/ADS.md. Half of that
//    shipped is a compliance problem, not a feature.
//
//  Copied into the generated Xcode project by .github/workflows/mobile.yml,
//  because `npx cap add ios` regenerates that project on every run.
//
import Foundation
import Capacitor
import GoogleMobileAds
import AppTrackingTransparency
import AdSupport

@objc(LumenAds)
public class LumenAds: CAPPlugin, GADFullScreenContentDelegate {

    private var rewarded: GADRewardedAd?
    private var pending: CAPPluginCall?
    private var earned = false
    // One load in flight, and everybody who asked while it was running. Without
    // this, a preload and a tap that arrives during it start two separate loads
    // of the same unit, and the slower one's completion overwrites the ad the
    // faster one already handed over.
    private var loading = false
    private var waiting: [CAPPluginCall] = []
    // When the held ad was loaded. Google expires a rewarded ad about an hour
    // after it arrives, and a plugin that answers "I have one" without checking
    // hands back an ad that then refuses to present.
    private var loadedAt: Date?
    // Ten minutes under Google's hour, so a tap that arrives just before the
    // boundary is still answered with something that will present.
    private static let adLifetime: TimeInterval = 50 * 60

    @objc func initialize(_ call: CAPPluginCall) {
        GADMobileAds.sharedInstance().start(completionHandler: nil)
        call.resolve()
    }

    // App Tracking Transparency.
    //
    // Ask BEFORE the SDK starts, never after: the answer decides whether Google
    // may read the advertising identifier at all, and a request made once the
    // SDK is already running changes nothing for the session it is running in.
    // js/ads.js:init() therefore awaits this and only then calls initialize().
    //
    // Declining is a complete answer, not a failure. Without permission the SDK
    // serves non-personalised ads, which pay less and work fine, so this always
    // resolves — a rejected promise here would be read as "no ad available" and
    // would take the reward away from someone who simply said no.
    //
    // Resolves { status } so the caller can tell "asked and declined" from
    // "never asked", and { tracking } as the plain yes/no.
    @objc func requestTracking(_ call: CAPPluginCall) {
        guard #available(iOS 14, *) else {
            // Before iOS 14 there is no prompt and the identifier is governed by
            // the old system switch, which is not ours to ask about.
            call.resolve(["status": "unavailable", "tracking": true])
            return
        }
        // Presentation, so main thread — the same rule that cost this plugin a
        // build when show() was called off it.
        DispatchQueue.main.async {
            ATTrackingManager.requestTrackingAuthorization { status in
                let name: String
                switch status {
                case .authorized:        name = "authorized"
                case .denied:            name = "denied"
                case .restricted:        name = "restricted"
                case .notDetermined:     name = "notDetermined"
                @unknown default:        name = "unknown"
                }
                call.resolve(["status": name, "tracking": status == .authorized])
            }
        }
    }

    // ANSWER AT ONCE IF ONE IS ALREADY LOADED, and that is the whole point.
    //
    // This used to call GADRewardedAd.load unconditionally, which made the
    // JavaScript side's preload pure waste: every tap on WATCH AN AD paid for a
    // full network load before anything could be presented. Players reported it
    // as "you have to press a few times and it comes very slowly" — and pressing
    // again did not help, because the second tap joins the first flight. The
    // comment in js/ads.js promising that "the native side keeps a single loaded
    // ad and resolves at once when it has one" described an intention nothing
    // implemented.
    @objc func prepare(_ call: CAPPluginCall) {
        let unit = call.getString("adId") ?? ""
        if unit.isEmpty { call.reject("no ad unit"); return }
        // Loading on main too: the SDK delivers its callbacks there, and the
        // delegate assignment below touches state the presentation path reads.
        DispatchQueue.main.async {
        // Holding one is not the same as holding a USABLE one. An app that sat
        // in the background overnight would otherwise answer the next tap
        // instantly with an expired ad, `show()` would be refused, and the
        // player would get "no ad right now" followed by a second tap that
        // works — which is exactly the symptom this cache exists to remove.
        if self.rewarded != nil, let at = self.loadedAt, Date().timeIntervalSince(at) < LumenAds.adLifetime {
            call.resolve(); return
        }
        self.rewarded = nil
        self.loadedAt = nil
        self.waiting.append(call)
        if self.loading { return }
        self.loading = true
        let request = GADRequest()
        GADRewardedAd.load(withAdUnitID: unit, request: request) { [weak self] ad, error in
            guard let self = self else { return }
            self.loading = false
            let asked = self.waiting
            self.waiting = []
            if let error = error {
                // A missing ad is ordinary — no fill, no network, a unit that is
                // not serving yet. The caller turns this into "try again
                // shortly", never into an error the player has to think about.
                for c in asked { c.reject("load failed: \(error.localizedDescription)") }
                return
            }
            ad?.fullScreenContentDelegate = self
            self.rewarded = ad
            self.loadedAt = Date()
            for c in asked { c.resolve() }
        }
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        // ON THE MAIN THREAD, and this is the whole bug.
        //
        // Capacitor runs plugin methods on a background queue, and UIKit refuses
        // to put anything on screen from there:
        //
        //   cannot present: presentation must be called on the main thread
        //
        // The ad was loading correctly the entire time and simply could not be
        // shown. What reached the player was "No ad right now", a sentence that
        // described neither the cause nor the fix — and it took surfacing the
        // real message to find a one-line answer.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let ad = self.rewarded else { call.reject("nothing loaded"); return }
            guard let vc = self.bridge?.viewController else {
                call.reject("no view controller"); return
            }
            // canPresent answers BEFORE the sheet is attempted, and with a
            // reason. The alternative is learning it from a delegate callback.
            do { try ad.canPresent(fromRootViewController: vc) }
            catch { call.reject("cannot present: \(error.localizedDescription)"); return }
            // Held so the delegate can answer once the ad is actually dismissed.
            // Resolving on `present` would pay a player who closed it instantly.
            // keepAlive is a property in Capacitor 6, not a method.
            call.keepAlive = true
            self.pending = call
            self.earned = false
            ad.present(fromRootViewController: vc) { [weak self] in
                self?.earned = true
            }
        }
    }

    // Dismissed, whether or not the reward was earned. One resolve, one shape:
    // { earned: Bool }. Closing early is a choice, not a failure, so it is never
    // reported as one.
    public func adDidDismissFullScreenContent(_ ad: GADFullScreenPresentingAd) {
        finish()
    }

    // A presentation FAILURE is not "you watched it and earned nothing" — it is
    // an error, and reporting it as the former is why the game could only say
    // "no ad right now" with nothing after it. The reason has to survive.
    public func ad(_ ad: GADFullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        rewarded = nil
        loadedAt = nil
        guard let call = pending else { return }
        pending = nil
        call.reject("present failed: \(error.localizedDescription)")
        call.keepAlive = false
    }

    private func finish() {
        rewarded = nil
        loadedAt = nil
        guard let call = pending else { return }
        pending = nil
        call.resolve(["earned": earned])
        call.keepAlive = false
    }
}
