package cn.toside.music.mobile.audioFeature;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Decodes a remote or local audio file into 16 kHz mono float32 PCM (little endian)
 * and writes it to a cache file, so the JS recommendation pipeline can compute
 * mel-spectrograms for on-device music embeddings.
 *
 * Best-effort by design: any failure (expired URL, unsupported codec, network error)
 * rejects with a message and the caller just skips that track.
 */
public class AudioDecodeModule extends ReactContextBaseJavaModule {

  private static final int TARGET_SAMPLE_RATE = 16000;
  private static final long TIMEOUT_US = 10_000;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  public AudioDecodeModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "AudioFeatureDecode";
  }

  @ReactMethod
  public void decode(String url, int maxSeconds, ReadableMap headers, Promise promise) {
    if (url == null || url.length() == 0) {
      promise.reject("EINVAL", "url is empty");
      return;
    }
    final int limitSeconds = Math.max(1, Math.min(maxSeconds, 180));
    final java.util.Map<String, String> headerMap = new java.util.HashMap<>();
    if (headers != null) {
      for (java.util.Map.Entry<String, Object> entry : headers.toHashMap().entrySet()) {
        Object value = entry.getValue();
        if (entry.getKey() != null && value != null) headerMap.put(entry.getKey(), String.valueOf(value));
      }
    }
    executor.execute(() -> {
      MediaExtractor extractor = new MediaExtractor();
      MediaCodec codec = null;
      File outFile = null;
      try {
        if (headerMap.isEmpty()) extractor.setDataSource(url);
        else extractor.setDataSource(url, headerMap);
        int trackIndex = -1;
        MediaFormat format = null;
        for (int i = 0; i < extractor.getTrackCount(); i++) {
          MediaFormat trackFormat = extractor.getTrackFormat(i);
          String mime = trackFormat.getString(MediaFormat.KEY_MIME);
          if (mime != null && mime.startsWith("audio/")) {
            trackIndex = i;
            format = trackFormat;
            break;
          }
        }
        if (trackIndex < 0 || format == null) {
          promise.reject("ENO_AUDIO_TRACK", "no audio track found");
          return;
        }
        extractor.selectTrack(trackIndex);
        String mime = format.getString(MediaFormat.KEY_MIME);
        int sourceRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
          ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
        int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
          ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;

        codec = MediaCodec.createDecoderByType(mime);
        codec.configure(format, null, null, 0);
        codec.start();

        outFile = new File(getReactApplicationContext().getCacheDir(),
          "audio-feature-" + UUID.randomUUID().toString() + ".pcm");
        Resampler resampler = new Resampler(sourceRate, TARGET_SAMPLE_RATE);
        Queue<float[]> chunks = new ArrayDeque<>();
        int totalSamples = 0;
        long limitUs = limitSeconds * 1_000_000L;
        boolean inputDone = false;
        boolean drainDone = false;
        int tryAgainStreak = 0;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

        while (!drainDone) {
          if (!inputDone) {
            int inIndex = codec.dequeueInputBuffer(TIMEOUT_US);
            if (inIndex >= 0) {
              java.nio.ByteBuffer inBuf = codec.getInputBuffer(inIndex);
              int size = inBuf == null ? 0 : extractor.readSampleData(inBuf, 0);
              if (size < 0) {
                codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                inputDone = true;
              } else {
                long pts = extractor.getSampleTime();
                codec.queueInputBuffer(inIndex, 0, size, pts, 0);
                extractor.advance();
              }
            }
          }
          int outIndex = codec.dequeueOutputBuffer(info, TIMEOUT_US);
          if (outIndex >= 0) {
            tryAgainStreak = 0;
            java.nio.ByteBuffer outBuf = codec.getOutputBuffer(outIndex);
            if (outBuf != null && info.size > 0) {
              outBuf.position(info.offset);
              outBuf.limit(info.offset + info.size);
              float[] mono = toMonoFloat(outBuf, channels);
              float[] resampled = resampler.push(mono);
              if (resampled.length > 0) {
                chunks.add(resampled);
                totalSamples += resampled.length;
              }
            }
            codec.releaseOutputBuffer(outIndex, false);
            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) drainDone = true;
            if (info.presentationTimeUs >= limitUs) drainDone = true;
          } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            MediaFormat outFormat = codec.getOutputFormat();
            sourceRate = outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)
              ? outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : sourceRate;
            channels = outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
              ? outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : channels;
            resampler.updateSourceRate(sourceRate);
          } else {
            // INFO_TRY_AGAIN_LATER: stalled codec or EOS never flagged; bail out eventually.
            if (++tryAgainStreak > 50) drainDone = true;
          }
        }

        if (totalSamples <= 0) {
          promise.reject("EEMPTY", "decoder produced no samples");
          return;
        }
        writeFloatLE(outFile, chunks, totalSamples);

        WritableMap result = Arguments.createMap();
        result.putString("path", outFile.getAbsolutePath());
        result.putInt("samples", totalSamples);
        result.putInt("sampleRate", TARGET_SAMPLE_RATE);
        promise.resolve(result);
      } catch (Exception e) {
        if (outFile != null) outFile.delete();
        promise.reject("EDECODE", e.getMessage() == null ? "decode failed" : e.getMessage(), e);
      } finally {
        try {
          if (codec != null) {
            codec.stop();
            codec.release();
          }
        } catch (Exception ignored) {
        }
        try {
          extractor.release();
        } catch (Exception ignored) {
        }
      }
    });
  }

  /** Decodes 16-bit PCM into mono float in [-1, 1] by averaging channels. */
  private static float[] toMonoFloat(java.nio.ByteBuffer buf, int channels) {
    int frames = buf.remaining() / 2 / Math.max(1, channels);
    float[] mono = new float[frames];
    java.nio.ByteOrder order = ByteOrder.LITTLE_ENDIAN;
    for (int i = 0; i < frames; i++) {
      int acc = 0;
      for (int c = 0; c < channels; c++) {
        short s = buf.order(order).getShort();
        acc += s;
      }
      mono[i] = acc / (float) channels / 32768f;
    }
    return mono;
  }

  private static void writeFloatLE(File file, Queue<float[]> chunks, int totalSamples) throws Exception {
    java.nio.ByteBuffer bytes = java.nio.ByteBuffer.allocate(totalSamples * 4).order(ByteOrder.LITTLE_ENDIAN);
    for (float[] chunk : chunks) {
      for (float v : chunk) bytes.putFloat(v);
    }
    try (FileOutputStream out = new FileOutputStream(file, false)) {
      out.write(bytes.array());
    }
  }

  /** Linear-interpolation resampler; keeps continuity across codec buffer boundaries. */
  private static final class Resampler {
    private double srcRate;
    private final int dstRate;
    private double carryPosition = 0;
    private float lastSample = 0;
    private boolean hasLast = false;

    Resampler(double srcRate, int dstRate) {
      this.srcRate = srcRate;
      this.dstRate = dstRate;
    }

    void updateSourceRate(double newRate) {
      if (newRate > 0 && newRate != srcRate) {
        srcRate = newRate;
        carryPosition = 0;
      }
    }

    float[] push(float[] input) {
      if (input.length == 0) return new float[0];
      double step = srcRate / dstRate;
      Queue<Float> out = new ArrayDeque<>();
      double pos = carryPosition;
      while (pos < input.length) {
        int idx = (int) pos;
        float value;
        if (idx + 1 < input.length) {
          float frac = (float) (pos - idx);
          value = input[idx] * (1 - frac) + input[idx + 1] * frac;
        } else {
          // The tail sample waits for the next buffer unless this is the final one.
          value = hasLast ? input[idx] : input[idx];
        }
        out.add(value);
        pos += step;
      }
      carryPosition = pos - input.length;
      float[] result = new float[out.size()];
      int i = 0;
      while (!out.isEmpty()) result[i++] = out.poll();
      hasLast = input.length > 0;
      lastSample = input[input.length - 1];
      return result;
    }
  }
}
