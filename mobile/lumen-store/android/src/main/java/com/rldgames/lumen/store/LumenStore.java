package com.rldgames.lumen.store;

import android.app.Activity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.android.billingclient.api.*;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * LUMEN - in-app purchases on Android, through Google Play Billing.
 *
 * Same four methods and the same resolve shapes as the StoreKit half, because
 * js/iap.js is one file and must not know which store it is talking to:
 *
 *   products({ ids })  -> { products: [{ id, title, description, price, raw }] }
 *   purchase({ id })   -> { ok: true, transactionId } | { ok: false, reason }
 *   restore()          -> { owned: [id, ...] }
 *   requestReview()    -> { asked: boolean }
 *
 * ONE REAL DIFFERENCE FROM STOREKIT, and getting it wrong costs money in both
 * directions: Play refunds any purchase that is not finished within three days.
 * A consumable is finished by CONSUMING it, which also makes it buyable again;
 * everything else is finished by ACKNOWLEDGING it. Consume a cosmetic set and
 * the player can be charged for it twice; acknowledge a shard pack and they can
 * never buy shards again. js/iap.js already knows which is which, so it says so
 * on the call rather than this file guessing from the product id.
 */
@CapacitorPlugin(name = "LumenStore")
public class LumenStore extends Plugin {

    private BillingClient billing;
    private final Map<String, ProductDetails> details = new HashMap<>();
    private PluginCall pendingPurchase;
    private boolean pendingConsumable;

    /** Every purchase the library hands back arrives here, whenever it happens. */
    private final PurchasesUpdatedListener purchasesUpdated = (result, purchases) -> {
        PluginCall call = pendingPurchase;
        pendingPurchase = null;
        if (call == null) return;

        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) { resolveFail(call, "cancelled"); return; }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            resolveFail(call, "failed");
            return;
        }
        final Purchase p = purchases.get(0);
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) { resolveFail(call, "pending"); return; }

        finishPurchase(p, pendingConsumable, () -> {
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("transactionId", p.getOrderId() != null ? p.getOrderId() : p.getPurchaseToken());
            call.resolve(out);
            call.setKeepAlive(false);
        });
    };

    private void resolveFail(PluginCall call, String reason) {
        JSObject out = new JSObject();
        out.put("ok", false);
        out.put("reason", reason);
        call.resolve(out);
        call.setKeepAlive(false);
    }

    /** Connect once, and hand the callback a client that is actually ready. */
    private void withBilling(PluginCall call, Runnable ready) {
        if (billing != null && billing.isReady()) { ready.run(); return; }
        billing = BillingClient.newBuilder(getContext())
                .setListener(purchasesUpdated)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) ready.run();
                else call.reject("billing unavailable: " + r.getDebugMessage());
            }
            @Override public void onBillingServiceDisconnected() { /* reconnected lazily above */ }
        });
    }

    @PluginMethod
    public void products(PluginCall call) {
        JSArray idsArray = call.getArray("ids");
        List<String> ids = new ArrayList<>();
        try {
            if (idsArray != null) for (Object o : idsArray.toList()) ids.add(String.valueOf(o));
        } catch (Exception e) { call.reject("bad ids"); return; }
        if (ids.isEmpty()) { call.reject("no product ids"); return; }

        withBilling(call, () -> {
            List<QueryProductDetailsParams.Product> list = new ArrayList<>();
            for (String id : ids) {
                list.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build());
            }
            billing.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(list).build(),
                (result, found) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject("could not load products: " + result.getDebugMessage());
                        return;
                    }
                    JSArray out = new JSArray();
                    details.clear();
                    for (ProductDetails d : found) {
                        details.put(d.getProductId(), d);
                        ProductDetails.OneTimePurchaseOfferDetails offer = d.getOneTimePurchaseOfferDetails();
                        JSObject o = new JSObject();
                        o.put("id", d.getProductId());
                        o.put("title", d.getTitle());
                        o.put("description", d.getDescription());
                        // The store localised string, never a price we format:
                        // a hardcoded symbol is wrong in most of the world.
                        o.put("price", offer != null ? offer.getFormattedPrice() : "");
                        o.put("raw", offer != null ? offer.getPriceAmountMicros() / 1000000.0 : 0);
                        out.put(o);
                    }
                    JSObject res = new JSObject();
                    res.put("products", out);
                    call.resolve(res);
                });
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        final String id = call.getString("id", "");
        final boolean consumable = Boolean.TRUE.equals(call.getBoolean("consumable", false));
        if (id == null || id.isEmpty()) { call.reject("no product id"); return; }
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }

        withBilling(call, () -> {
            ProductDetails d = details.get(id);
            if (d == null) { call.reject("unknown product - call products() first"); return; }
            List<BillingFlowParams.ProductDetailsParams> params = new ArrayList<>();
            params.add(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build());
            // Held open: the answer arrives on purchasesUpdated, after the
            // player has been through the Google sheet.
            call.setKeepAlive(true);
            pendingPurchase = call;
            pendingConsumable = consumable;
            activity.runOnUiThread(() -> billing.launchBillingFlow(activity,
                BillingFlowParams.newBuilder().setProductDetailsParamsList(params).build()));
        });
    }

    /**
     * Only the non-consumables come back. A consumed shard pack is gone by
     * design - restoring it would print currency on every reinstall.
     */
    @PluginMethod
    public void restore(PluginCall call) {
        withBilling(call, () -> billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (result, purchases) -> {
                JSArray owned = new JSArray();
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                    for (Purchase p : purchases) {
                        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                        // Anything still owned was never consumed, so it is a
                        // non-consumable and belongs in the restore list.
                        if (!p.isAcknowledged()) finishPurchase(p, false, null);
                        for (String id : p.getProducts()) owned.put(id);
                    }
                }
                JSObject out = new JSObject();
                out.put("owned", owned);
                call.resolve(out);
            }));
    }

    /** Google Play In-App Review - ask the system, never gate anything on it. */
    @PluginMethod
    public void requestReview(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.resolve(new JSObject().put("asked", false)); return; }
        final ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) { call.resolve(new JSObject().put("asked", false)); return; }
            ReviewInfo info = task.getResult();
            manager.launchReviewFlow(activity, info)
                   .addOnCompleteListener(t -> call.resolve(new JSObject().put("asked", true)));
        });
    }

    /** Consume or acknowledge - the step that stops Play refunding the purchase. */
    private void finishPurchase(Purchase p, boolean consumable, Runnable done) {
        if (consumable) {
            billing.consumeAsync(
                ConsumeParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                (r, token) -> { if (done != null) done.run(); });
            return;
        }
        if (p.isAcknowledged()) { if (done != null) done.run(); return; }
        billing.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
            r -> { if (done != null) done.run(); });
    }
}
