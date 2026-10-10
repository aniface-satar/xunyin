package cn.toside.music.mobile.audioRecord;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Records a short clip of the microphone and returns it as base64-encoded
 * 48 kHz mono PCM16 (little endian). One-shot by design: no streaming, no
 * background capture, no foreground service, and the bytes never touch disk.
 *
 * The whole feature relies on this single capture: since Android 10 a second
 * concurrent AudioRecord client gets muted on a fair share of devices, so every
 * downstream format must be decimated from this one stream in JS.
 */
public class AudioRecordModule extends ReactContextBaseJavaModule {

  private static final int SAMPLE_RATE = 48000;
  private static final int MAX_SECONDS = 10;
  // 2400 samples = 50 ms per read, which also bounds the cancel latency.
  private static final int CHUNK_BYTES = 2400 * 2;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean recording = new AtomicBoolean(false);
  private final AtomicBoolean cancelRequested = new AtomicBoolean(false);

  public AudioRecordModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "MusicAudioRecord";
  }

  @ReactMethod
  public void start(int seconds, Promise promise) {
    // One settlement guard per call: every early return below and every path inside the
    // worker shares it, so no code path can both resolve and reject this promise.
    final AtomicBoolean settled = new AtomicBoolean(false);
    if (seconds < 1 || seconds > MAX_SECONDS) {
      reject(promise, settled, "EINVAL", "seconds must be within 1.." + MAX_SECONDS, null);
      return;
    }
    // Checked before claiming `recording` so the flag is only ever set true here and
    // cleared in the worker's finally.
    if (ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      reject(promise, settled, "EPERM", "RECORD_AUDIO is not granted", null);
      return;
    }
    // CAS rather than get()+set(): correctness must not depend on the bridge serialising
    // two calls (newArchEnabled=false is a build setting, not a guarantee).
    if (!recording.compareAndSet(false, true)) {
      reject(promise, settled, "EBUSY", "another recording is still running", null);
      return;
    }

    cancelRequested.set(false);
    final int totalBytes = seconds * SAMPLE_RATE * 2;

    executor.execute(() -> {
      AudioRecord record = null;
      try {
        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) {
          reject(promise, settled, "EAUDIODEV", "getMinBufferSize returned " + minBuffer, null);
          return;
        }
        record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(minBuffer, SAMPLE_RATE * 2));
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
          reject(promise, settled, "EAUDIODEV", "AudioRecord failed to initialise", null);
          return;
        }

        byte[] bytes = new byte[totalBytes];
        record.startRecording();
        int written = 0;
        while (written < totalBytes) {
          if (cancelRequested.get()) {
            reject(promise, settled, "ECANCEL", "recording cancelled", null);
            return;
          }
          int read = record.read(bytes, written, Math.min(CHUNK_BYTES, totalBytes - written));
          if (read <= 0) {
            reject(promise, settled, "EIO", "AudioRecord.read returned " + read, null);
            return;
          }
          written += read;
        }
        // cancel() landing after the last read would otherwise deliver a full clip for a
        // recording the user already abandoned.
        if (cancelRequested.get()) {
          reject(promise, settled, "ECANCEL", "recording cancelled", null);
        } else {
          resolve(promise, settled, Base64.encodeToString(bytes, Base64.NO_WRAP));
        }
      } catch (Throwable t) {
        // Throwable, not Exception: an OutOfMemoryError from the PCM buffer or the base64
        // String must still settle the promise, else the caller awaits forever.
        reject(promise, settled, "EREC", "recording failed: " + t, t);
      } finally {
        try {
          if (record != null) {
            try {
              if (record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                record.stop();
              }
            } catch (Throwable ignored) {
            }
            record.release();
          }
        } catch (Throwable ignored) {
          // release() throws IllegalStateException on the not-initialised path; nothing from
          // teardown may escape the lambda, or the process dies on the executor thread.
        } finally {
          recording.set(false);
        }
      }
    });
  }

  /** Aborts the running capture; the pending promise rejects with ECANCEL. */
  @ReactMethod
  public void cancel() {
    cancelRequested.set(true);
  }

  private static void resolve(Promise promise, AtomicBoolean settled, String value) {
    if (!settled.compareAndSet(false, true)) return;
    try {
      promise.resolve(value);
    } catch (Throwable ignored) {
      // Bridge already torn down; there is no JS left to notify.
    }
  }

  private static void reject(Promise promise, AtomicBoolean settled, String code, String message, Throwable error) {
    if (!settled.compareAndSet(false, true)) return;
    try {
      if (error != null) {
        promise.reject(code, message, error);
      } else {
        promise.reject(code, message);
      }
    } catch (Throwable ignored) {
      // Bridge already torn down; there is no JS left to notify.
    }
  }
}
