package com.rldgames.lumen.voice;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * LUMEN — voice control on Android.
 *
 * WHY THIS FILE EXISTS: Android's WebView does not implement the Web Speech API.
 * `window.SpeechRecognition` and `window.webkitSpeechRecognition` are both
 * absent, so js/voice.js decided the feature was unsupported and returned before
 * touching anything. The visible result was the worst kind of bug — the setting
 * toggled on and stayed on, the microphone was never requested, no permission
 * dialog ever appeared, and nothing worked, with nothing anywhere saying why.
 *
 * The contract js/voice.js talks to:
 *
 *   available()          -> { available, granted }
 *   requestMic()         -> { granted }        (shows the OS dialog)
 *   start({ lang })      -> resolve            (then emits "transcript" events)
 *   stop()               -> resolve
 *
 * Events: "transcript" { text, final }  and  "denied" {} when the mic is refused
 * mid-session, which is the one failure the game must react to rather than log.
 *
 * SpeechRecognizer ends after every utterance and has to be restarted; the loop
 * below does that for as long as the game says it wants to listen. Restarts are
 * throttled, because a recogniser that fails instantly (no network, no service)
 * would otherwise spin as fast as the CPU allows and flatten the battery.
 */
@CapacitorPlugin(
    name = "LumenVoice",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = LumenVoice.MIC)
    }
)
public class LumenVoice extends Plugin {

    static final String MIC = "mic";

    private SpeechRecognizer recognizer;
    private Intent intent;
    private boolean wantOn;
    private long lastStartAt;
    private int failures;

    /**
     * Can this phone recognise speech at all, and may we listen yet?
     *
     * Answered honestly and separately: a device with no recogniser is not the
     * same as a player who has not been asked, and the game shows a different
     * thing for each — the toggle disappears in the first case and explains
     * itself in the second.
     */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        boolean ok;
        try {
            ok = SpeechRecognizer.isRecognitionAvailable(getContext());
        } catch (Exception e) {
            ok = false;
        }
        out.put("available", ok);
        out.put("granted", getPermissionState(MIC) == PermissionState.GRANTED);
        call.resolve(out);
    }

    /**
     * Ask for the microphone — the actual OS dialog, once.
     *
     * The game shows its own explanation FIRST and only calls this when the
     * player has read it and said yes, because a system prompt with no stated
     * reason is the one people refuse. If the permission is already granted this
     * resolves immediately rather than re-prompting.
     */
    @PluginMethod
    public void requestMic(PluginCall call) {
        if (getPermissionState(MIC) == PermissionState.GRANTED) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        requestPermissionForAlias(MIC, call, "micResult");
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        call.resolve(new JSObject().put("granted", getPermissionState(MIC) == PermissionState.GRANTED));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            call.reject("microphone not granted");
            return;
        }
        final String lang = call.getString("lang", "en-US");
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }

        // SpeechRecognizer is main-thread only — every method on it, not just
        // creation. Capacitor runs plugin calls off it.
        activity.runOnUiThread(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    call.reject("no recognition service");
                    return;
                }
                wantOn = true;
                failures = 0;
                buildIntent(lang);
                buildRecognizer();
                listen();
                call.resolve();
            } catch (Exception e) {
                call.reject("start failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final Activity activity = getActivity();
        wantOn = false;
        if (activity == null) { call.resolve(); return; }
        activity.runOnUiThread(() -> {
            teardown();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        wantOn = false;
        final Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(this::teardown);
    }

    // ---- the loop ---------------------------------------------------------

    private void buildIntent(String lang) {
        intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        // Partial results are the whole point: a command has to fire while the
        // player is still alive, not a second after the utterance is complete.
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        // Silence windows kept short so the recogniser cycles quickly rather than
        // sitting open for seconds after a one-word command.
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 900L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L);
    }

    private void buildRecognizer() {
        if (recognizer != null) return;
        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { failures = 0; }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}

            @Override public void onError(int error) {
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    // The one error the game must act on: switch the feature off
                    // rather than retry into a wall the player already closed.
                    wantOn = false;
                    notifyListeners("denied", new JSObject());
                    teardown();
                    return;
                }
                // Everything else — no match, timeout, busy, network — is ordinary
                // and means "go round again".
                failures++;
                relisten();
            }

            @Override public void onResults(Bundle results) {
                emit(results, true);
                relisten();
            }

            @Override public void onPartialResults(Bundle partial) {
                emit(partial, false);
            }

            @Override public void onEvent(int eventType, Bundle params) {}
        });
    }

    private void emit(Bundle b, boolean isFinal) {
        if (b == null) return;
        ArrayList<String> hits = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (hits == null || hits.isEmpty()) return;
        for (String text : hits) {
            if (text == null || text.trim().isEmpty()) continue;
            JSObject ev = new JSObject();
            ev.put("text", text);
            ev.put("final", isFinal);
            notifyListeners("transcript", ev);
        }
    }

    private void listen() {
        if (!wantOn || recognizer == null || intent == null) return;
        lastStartAt = System.currentTimeMillis();
        try { recognizer.startListening(intent); } catch (Exception e) { failures++; }
    }

    /**
     * Restart, with a back-off that grows only when the recogniser is failing.
     *
     * A recogniser that errors immediately — no network, service busy, no match
     * on silence — returns in a few milliseconds, and restarting it at that rate
     * is a hot loop with a microphone attached. A normal cycle resets `failures`
     * the moment it reaches onReadyForSpeech, so a player who is actually
     * speaking never waits.
     */
    private void relisten() {
        if (!wantOn) return;
        long delay = 250;
        if (failures > 2) delay = Math.min(4000, 250L * failures);
        final Activity activity = getActivity();
        if (activity == null) return;
        activity.getWindow().getDecorView().postDelayed(() -> {
            if (!wantOn) return;
            try { recognizer.cancel(); } catch (Exception e) {}
            listen();
        }, delay);
    }

    private void teardown() {
        if (recognizer == null) return;
        try { recognizer.stopListening(); } catch (Exception e) {}
        try { recognizer.cancel(); } catch (Exception e) {}
        try { recognizer.destroy(); } catch (Exception e) {}
        recognizer = null;
    }
}
