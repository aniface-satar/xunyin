package cn.toside.music.mobile.audioFeature;

import android.content.Context;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableMap;

import org.tensorflow.lite.Interpreter;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Minimal generic TFLite runner for on-device music embeddings.
 * The JS side owns all model semantics (mel-spectrogram layout, output averaging);
 * this module only loads a .tflite file and runs one inference per call.
 *
 * Model lookup order: app documents dir first (downloadable, no APK rebuild),
 * then APK assets under models/ (bundled at build time).
 */
public class TfliteModule extends ReactContextBaseJavaModule {

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private Interpreter interpreter;
  private int inputSize = -1;
  private int outputSize = -1;
  private String loadedModelId = null;

  public TfliteModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "AudioFeatureTflite";
  }

  @ReactMethod
  public void load(String modelPath, Promise promise) {
    executor.execute(() -> {
      try {
        MappedByteBuffer model = readModel(getReactApplicationContext(), modelPath);
        synchronized (this) {
          if (interpreter != null) interpreter.close();
          Interpreter.Options options = new Interpreter.Options();
          options.setNumThreads(2);
          interpreter = new Interpreter(model, options);
          int[] inShape = interpreter.getInputTensor(0).shape();
          int[] outShape = interpreter.getOutputTensor(0).shape();
          inputSize = product(inShape);
          outputSize = product(outShape);
          loadedModelId = modelPath;
          WritableMap result = Arguments.createMap();
          result.putString("inputShape", joinShape(inShape));
          result.putString("outputShape", joinShape(outShape));
          promise.resolve(result);
        }
      } catch (Exception e) {
        synchronized (this) {
          interpreter = null;
          loadedModelId = null;
        }
        promise.reject("ELOAD", e.getMessage() == null ? "model load failed" : e.getMessage(), e);
      }
    });
  }

  /** input is a flat row-major float array; shape must match the model signature. */
  @ReactMethod
  public void run(String modelPath, ReadableArray input, ReadableArray shape, Promise promise) {
    executor.execute(() -> {
      try {
        Interpreter current;
        int inSize;
        int outSize;
        synchronized (this) {
          if (interpreter == null || !modelPath.equals(loadedModelId)) {
            throw new IllegalStateException("model not loaded: " + modelPath);
          }
          current = interpreter;
          inSize = inputSize;
          outSize = outputSize;
        }
        if (input == null || input.size() != inSize) {
          promise.reject("ESHAPE", "input size mismatch: got "
            + (input == null ? 0 : input.size()) + ", expected " + inSize);
          return;
        }
        int[] dims = new int[shape.size()];
        int expected = 1;
        for (int i = 0; i < dims.length; i++) {
          dims[i] = shape.getInt(i);
          expected *= Math.max(1, dims[i]);
        }
        if (expected != inSize) {
          promise.reject("ESHAPE", "shape mismatch: given shape expects " + expected + ", model expects " + inSize);
          return;
        }
        ByteBuffer in = ByteBuffer.allocateDirect(inSize * 4).order(ByteOrder.nativeOrder());
        for (int i = 0; i < inSize; i++) in.putFloat((float) input.getDouble(i));
        in.rewind();
        float[][] out = new float[1][outSize];
        synchronized (current) {
          current.run(in, out);
        }
        float[] flat = out[0];
        WritableMap result = Arguments.createMap();
        result.putArray("output", toArray(flat));
        promise.resolve(result);
      } catch (Exception e) {
        promise.reject("ERUN", e.getMessage() == null ? "inference failed" : e.getMessage(), e);
      }
    });
  }

  @ReactMethod
  public void release(Promise promise) {
    executor.execute(() -> {
      synchronized (this) {
        if (interpreter != null) interpreter.close();
        interpreter = null;
        loadedModelId = null;
      }
      promise.resolve(null);
    });
  }

  private static int product(int[] shape) {
    int size = 1;
    for (int dim : shape) size *= Math.max(1, dim);
    return size;
  }

  private static String joinShape(int[] shape) {
    StringBuilder sb = new StringBuilder();
    for (int dim : shape) {
      if (sb.length() > 0) sb.append('x');
      sb.append(dim);
    }
    return sb.toString();
  }

  private static com.facebook.react.bridge.WritableArray toArray(float[] values) {
    com.facebook.react.bridge.WritableArray arr = Arguments.createArray();
    for (float v : values) arr.pushDouble(v);
    return arr;
  }

  private static MappedByteBuffer readModel(Context context, String modelPath) throws Exception {
    // asset:///models/xxx.tflite → bundled APK asset; anything else is an absolute file path
    if (modelPath.startsWith("asset:///")) {
      String assetPath = modelPath.substring("asset:///".length());
      File cacheCopy = new File(context.getCacheDir(), "tflite-" + new File(assetPath).getName());
      if (!cacheCopy.exists() || cacheCopy.length() == 0) {
        try (InputStream in = context.getAssets().open(assetPath);
             FileOutputStream out = new FileOutputStream(cacheCopy)) {
          byte[] buf = new byte[64 * 1024];
          int read;
          while ((read = in.read(buf)) > 0) out.write(buf, 0, read);
        }
      }
      return readFile(cacheCopy);
    }
    return readFile(new File(modelPath));
  }

  private static MappedByteBuffer readFile(File file) throws Exception {
    try (FileInputStream in = new FileInputStream(file);
         FileChannel channel = in.getChannel()) {
      return channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
    }
  }
}
