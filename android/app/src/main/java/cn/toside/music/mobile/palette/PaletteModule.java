package cn.toside.music.mobile.palette;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableNativeArray;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PaletteModule extends ReactContextBaseJavaModule {

  // 与 src/components/common/Image.tsx 的 defaultHeaders 保持一致，否则部分音源封面取不到图
  private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  PaletteModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "PaletteModule";
  }

  @ReactMethod
  public void getArgbPixels(String url, int maxSize, Promise promise) {
    if (url == null || url.isEmpty()) {
      promise.reject("PALETTE_EMPTY_URL", "url is empty");
      return;
    }
    final String target = url;
    final int limit = maxSize <= 0 ? 128 : maxSize;
    executor.execute(() -> {
      Bitmap decoded = null;
      Bitmap scaled = null;
      try {
        byte[] raw = readBytes(target);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("image not decodable");

        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= limit * 2) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        decoded = BitmapFactory.decodeByteArray(raw, 0, raw.length, options);

        int width = decoded.getWidth();
        int height = decoded.getHeight();
        float ratio = Math.min((float) limit / Math.max(width, height), 1f);
        scaled = ratio == 1f
          ? decoded
          : Bitmap.createScaledBitmap(decoded, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);

        int[] pixels = new int[scaled.getWidth() * scaled.getHeight()];
        scaled.getPixels(pixels, 0, scaled.getWidth(), 0, 0, scaled.getWidth(), scaled.getHeight());

        WritableNativeArray result = new WritableNativeArray();
        for (int pixel : pixels) result.pushInt(pixel);
        promise.resolve(result);
      } catch (Exception e) {
        promise.reject("PALETTE_FAILED", e.getMessage());
      } finally {
        if (scaled != null && scaled != decoded) scaled.recycle();
        if (decoded != null) decoded.recycle();
      }
    });
  }

  private byte[] readBytes(String url) throws Exception {
    String path = url.startsWith("file://") ? Uri.parse(url).getPath() : url;
    if (path == null) throw new Exception("bad file uri");
    if (!path.startsWith("http")) {
      File file = new File(path);
      FileInputStream in = new FileInputStream(file);
      try {
        return readAll(in);
      } finally {
        in.close();
      }
    }
    HttpURLConnection conn = (HttpURLConnection) new URL(path).openConnection();
    conn.setRequestProperty("User-Agent", USER_AGENT);
    conn.setConnectTimeout(8000);
    conn.setReadTimeout(8000);
    conn.setInstanceFollowRedirects(true);
    try {
      int code = conn.getResponseCode();
      if (code < 200 || code >= 400) throw new Exception("http " + code);
      // 走到这里只剩 2xx/3xx：3xx 没跟随时响应体在 getInputStream()，getErrorStream() 恒为 null，
      // 那样会把"靠 UA 才拿得到的 CDN 跳转封面"误判成取色失败。
      InputStream in = conn.getInputStream();
      if (in == null) throw new Exception("empty body");
      try {
        return readAll(in);
      } finally {
        in.close();
      }
    } finally {
      conn.disconnect();
    }
  }

  private byte[] readAll(InputStream in) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
    return out.toByteArray();
  }
}
