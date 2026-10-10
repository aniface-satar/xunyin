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
    if (seconds < 1 || seconds > MAX_SECONDS) {
      promise.reject("EINVAL", "seconds must be within 1.." + MAX_SECONDS);
      return;
    }
    if (recording.get()) {
      promise.reject("EBUSY", "another recording is still running");
      return;
    }
    if (ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      promise.reject("EPERM", "RECORD_AUDIO is not granted");
      return;
    }

    recording.set(true);
    cancelRequested.set(false);
    final int totalBytes = seconds * SAMPLE_RATE * 2;

    executor.execute(() -> {
      AudioRecord record = null;
      try {
        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) {
          promise.reject("EAUDIODEV", "getMinBufferSize returned " + minBuffer);
          return;
        }
        record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(minBuffer, SAMPLE_RATE * 2));
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
          promise.reject("EAUDIODEV", "AudioRecord failed to initialise");
          return;
        }

        byte[] bytes = new byte[totalBytes];
        record.startRecording();
        int written = 0;
        while (written < totalBytes) {
          if (cancelRequested.get()) {
            promise.reject("ECANCEL", "recording cancelled");
            return;
          }
          int read = record.read(bytes, written, Math.min(CHUNK_BYTES, totalBytes - written));
          if (read <= 0) {
            promise.reject("EIO", "AudioRecord.read returned " + read);
            return;
          }
          written += read;
        }
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP));
      } catch (Exception e) {
        promise.reject("EREC", e.getMessage());
      } finally {
        if (record != null) {
          try {
            if (record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
              record.stop();
            }
          } catch (Exception ignored) {
          }
          record.release();
        }
        recording.set(false);
      }
    });
  }

  /** Aborts the running capture; the pending promise rejects with ECANCEL. */
  @ReactMethod
  public void cancel() {
    cancelRequested.set(true);
  }
}
