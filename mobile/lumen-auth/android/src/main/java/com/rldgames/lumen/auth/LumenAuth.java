package com.rldgames.lumen.auth;

import android.app.Activity;
import android.os.CancellationSignal;

import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.CustomCredential;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * LUMEN — signing in on Android, with Google.
 *
 * The iOS build signs in with Apple through the native sheet. Android has no
 * equivalent, and the community apple-sign-in plugin's Android implementation is
 * a single `echo` method — so `Capacitor.Plugins.SignInWithApple` existed, the
 * button drew, the player tapped it, and `authorize` was simply not on the
 * object. That is why js/auth.js switched the whole account surface off there.
 * This is what switches it back on.
 *
 * ONE METHOD, one shape, matching what js/auth.js already does with Apple:
 *
 *   signIn({ serverClientId, nonce }) -> { idToken }
 *
 * `serverClientId` is the WEB OAuth client id, not the Android one. That trips
 * everybody up once: the Android client exists to prove this package, signed
 * with this certificate, is allowed to ask — but the token that comes back is
 * minted FOR the web client, because that is the audience Supabase verifies
 * against. Passing the Android id here returns a token no backend will accept.
 *
 * `nonce` is the SHA-256 of the raw nonce. Google embeds it in the token,
 * Supabase is given the raw one and re-hashes it, and a token captured
 * elsewhere cannot be replayed into our session. Same rule as the Apple path.
 */
@CapacitorPlugin(name = "LumenAuth")
public class LumenAuth extends Plugin {

    private final Executor executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void signIn(final PluginCall call) {
        final String serverClientId = call.getString("serverClientId", "");
        final String nonce = call.getString("nonce", "");
        if (serverClientId == null || serverClientId.isEmpty()) {
            call.reject("no serverClientId");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }

        GetGoogleIdOption.Builder option = new GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            // FALSE, deliberately. Filtering by authorized accounts only offers
            // accounts that have signed into this app before, which on a first
            // run is none of them — the sheet comes up empty and the player is
            // told there is nothing to sign in with. Showing every account on
            // the phone is what makes the first sign-in possible at all.
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false);
        if (nonce != null && !nonce.isEmpty()) option.setNonce(nonce);

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option.build())
            .build();

        CredentialManager manager = CredentialManager.create(getContext());
        // The sheet is UI, so it is asked for from the activity, and the answer
        // arrives on a background executor.
        manager.getCredentialAsync(
            activity,
            request,
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override public void onResult(GetCredentialResponse response) {
                    try {
                        androidx.credentials.Credential cred = response.getCredential();
                        if (!(cred instanceof CustomCredential)
                            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(cred.getType())) {
                            call.reject("unexpected credential type");
                            return;
                        }
                        GoogleIdTokenCredential google =
                            GoogleIdTokenCredential.createFrom(((CustomCredential) cred).getData());
                        JSObject out = new JSObject();
                        out.put("idToken", google.getIdToken());
                        // Offered only so the game can pre-fill the name field;
                        // the identity itself comes from the token, never from
                        // these, and nothing is stored from them.
                        out.put("name", google.getDisplayName());
                        call.resolve(out);
                    } catch (Exception e) {
                        call.reject("could not read the credential: " + e.getMessage());
                    }
                }

                @Override public void onError(GetCredentialException e) {
                    // Cancelling is a CHOICE, not a fault, and the two are
                    // reported separately so the game can stay quiet about one
                    // and explain the other. Telling a player who closed the
                    // sheet that sign-in "failed" is how a working feature comes
                    // to look broken.
                    if (e instanceof GetCredentialCancellationException) {
                        call.reject("cancelled");
                        return;
                    }
                    if (e instanceof NoCredentialException) {
                        call.reject("no-google-account");
                        return;
                    }
                    call.reject(e.getMessage() == null ? "sign-in failed" : e.getMessage());
                }
            });
    }
}
