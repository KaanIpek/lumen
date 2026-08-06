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

@objc(LumenAds)
public class LumenAds: CAPPlugin, GADFullScreenContentDelegate {

    private var rewarded: GADRewardedAd?
    private var pending: CAPPluginCall?
    private var earned = false

    @objc func initialize(_ call: CAPPluginCall) {
        GADMobileAds.sharedInstance().start(completionHandler: nil)
        call.resolve()
    }

    @objc func prepare(_ call: CAPPluginCall) {
        let unit = call.getString("adId") ?? ""
        if unit.isEmpty { call.reject("no ad unit"); return }
        // Loading on main too: the SDK delivers its callbacks there, and the
        // delegate assignment below touches state the presentation path reads.
        DispatchQueue.main.async {
        let request = GADRequest()
        GADRewardedAd.load(withAdUnitID: unit, request: request) { [weak self] ad, error in
            guard let self = self else { return }
            if let error = error {
                // A missing ad is ordinary — no fill, no network, a unit that is
                // not serving yet. The caller turns this into "try again
                // shortly", never into an error the player has to think about.
                call.reject("load failed: \(error.localizedDescription)")
                return
            }
            ad?.fullScreenContentDelegate = self
            self.rewarded = ad
            call.resolve()
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
        guard let call = pending else { return }
        pending = nil
        call.reject("present failed: \(error.localizedDescription)")
        call.keepAlive = false
    }

    private func finish() {
        rewarded = nil
        guard let call = pending else { return }
        pending = nil
        call.resolve(["earned": earned])
        call.keepAlive = false
    }
}
