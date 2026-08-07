//
//  LUMEN — in-app purchases, over StoreKit 2.
//
//  WHY THIS EXISTS AT ALL
//
//  The shop shipped for a long time behind a "sandbox" provider: a plain in-page
//  confirmation that granted the item and charged nothing. On the web that is an
//  honest demo. Inside the App Store wrapper it is a free unlock AND exactly what
//  guideline 3.1.1 forbids — digital goods sold through anything but in-app
//  purchase. js/iap.js therefore registers no provider on native at all, which is
//  why the money side of the shop is currently invisible in the app. This is the
//  piece that makes it real.
//
//  WHY StoreKit 2 AND NOT THE OLD API
//
//  Transaction.updates is the difference that matters. A purchase can complete
//  while the app is backgrounded, on another device, or after a crash between
//  payment and delivery. StoreKit 1 made you reconstruct that with a queue
//  observer and a lot of care; StoreKit 2 hands it to you as an async sequence
//  that also verifies the signature for you. The listener below starts with the
//  plugin and never stops, so an entitlement cannot be lost by bad timing.
//
//  WHAT THIS DELIBERATELY DOES NOT DO
//
//  It does not decide what a purchase is worth. The product ids and what they
//  grant live in js/iap.js, which is where every other platform reads them too.
//  This file moves money and reports what Apple said.
//
import Foundation
import Capacitor
import StoreKit

@objc(LumenStore)
public class LumenStore: CAPPlugin {

    private var updates: Task<Void, Never>?

    override public func load() {
        guard #available(iOS 15.0, *) else { return }
        // Start listening before anything else can happen. A transaction that
        // arrives while nobody is listening is not lost — StoreKit redelivers it
        // — but it is delayed until the next launch, and a player who paid and
        // saw nothing does not wait for the next launch.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                await self?.settle(result)
            }
        }
    }

    deinit { updates?.cancel() }

    // MARK: - what is for sale

    @objc func products(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else { call.reject("needs iOS 15"); return }
        let ids = call.getArray("ids", String.self) ?? []
        if ids.isEmpty { call.reject("no product ids"); return }
        Task {
            do {
                let found = try await Product.products(for: ids)
                // displayPrice is already localised and already carries the right
                // currency symbol for the storefront. Never format a price
                // ourselves: a hardcoded "$" is wrong in most of the world, and
                // the number is wrong too once Apple's tier maps to a local one.
                let list = found.map { p -> [String: Any] in
                    [
                        "id": p.id,
                        "title": p.displayName,
                        "description": p.description,
                        "price": p.displayPrice,
                        "raw": NSDecimalNumber(decimal: p.price).doubleValue,
                    ]
                }
                call.resolve(["products": list])
            } catch {
                call.reject("could not load products: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - buying

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else { call.reject("needs iOS 15"); return }
        guard let id = call.getString("id"), !id.isEmpty else { call.reject("no product id"); return }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("unknown product: \(id)")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    // Verified by StoreKit against Apple's key. An unverified
                    // result is not a purchase to be argued with — it is either
                    // tampering or a broken device, and either way nothing is
                    // granted.
                    guard case .verified(let transaction) = verification else {
                        call.resolve(["ok": false, "reason": "unverified"])
                        return
                    }
                    await transaction.finish()
                    call.resolve([
                        "ok": true,
                        "id": transaction.productID,
                        "transactionId": String(transaction.id),
                    ])
                case .userCancelled:
                    // Not an error. Rejecting here would make the shop show a
                    // failure message to someone who simply changed their mind.
                    call.resolve(["ok": false, "reason": "cancelled"])
                case .pending:
                    // Ask to Buy, or a bank that wants a second word. The grant
                    // arrives later through Transaction.updates.
                    call.resolve(["ok": false, "reason": "pending"])
                @unknown default:
                    call.resolve(["ok": false, "reason": "unknown"])
                }
            } catch {
                call.reject("purchase failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - restoring

    // Consumables are NOT restorable and must not be: shard packs are spent, and
    // handing them back on every reinstall would print currency. Only the
    // non-consumable sets come back, which is also exactly what guideline 3.1.1
    // requires a Restore button to do.
    @objc func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else { call.reject("needs iOS 15"); return }
        Task {
            var owned: [String] = []
            for await result in Transaction.currentEntitlements {
                if case .verified(let t) = result { owned.append(t.productID) }
            }
            call.resolve(["owned": owned])
        }
    }

    // MARK: - the background listener

    @available(iOS 15.0, *)
    private func settle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        await transaction.finish()
        // Tell the web layer, which owns what a product means. If nothing is
        // listening yet the entitlement is not lost: restore() reads it back
        // from currentEntitlements on the next look.
        notifyListeners("transaction", data: [
            "id": transaction.productID,
            "transactionId": String(transaction.id),
        ])
    }
}
