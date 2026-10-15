package cn.toside.music.mobile.palette;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Log;
import com.facebook.common.executors.CallerThreadExecutor;
import com.facebook.datasource.BaseDataSubscriber;
import com.facebook.datasource.DataSource;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.modules.fresco.ReactNetworkImageRequest;
import com.facebook.drawee.backends.pipeline.Fresco;
import com.facebook.imagepipeline.request.ImageRequest;
import com.facebook.imagepipeline.request.ImageRequestBuilder;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableNativeMap;

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

  // 网络响应 4MB：封面实际几十到几百 KB，超了就是"自称是图片"的东西在撑堆。
  private static final int MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
  // 本地文件单独放宽到 32MB：本机歌曲的封面是内嵌图抽出来的文件（src/core/music/local.ts:112 会拼成 file://），
  // FLAC/高码率的内嵌封面超 4MB 很常见，用网络那个上限会把它们静默判成取色失败。
  private static final int MAX_LOCAL_BYTES = 32 * 1024 * 1024;

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
    // 下界 1、上界 512：上界不是装饰 —— 巨大的 maxSize 会让下面 limit * 2 溢出成负数，
    // while 条件恒 false，于是原图不缩放直接按宽高分配 int[]，最坏 OOM（和下面 catch Throwable 是同一个坑）。
    final int limit = Math.max(1, Math.min(maxSize <= 0 ? 128 : maxSize, 512));
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
        // 截断的响应体能骗过上面 inJustDecodeBounds 的探边，但完整解码返回 null。
        // 不显式判就会靠 decoded.getWidth() 的 NPE 兜住，reject 文案变成 ART 的长句，看不出是"图不完整"。
        if (decoded == null) throw new Exception("decode returned null");

        int width = decoded.getWidth();
        int height = decoded.getHeight();
        float ratio = Math.min((float) limit / Math.max(width, height), 1f);
        scaled = ratio == 1f
          ? decoded
          : Bitmap.createScaledBitmap(decoded, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);

        int[] pixels = new int[scaled.getWidth() * scaled.getHeight()];
        scaled.getPixels(pixels, 0, scaled.getWidth(), 0, 0, scaled.getWidth(), scaled.getHeight());

        WritableNativeArray pixelArray = new WritableNativeArray();
        for (int pixel : pixels) pixelArray.pushInt(pixel);
        // 行宽只能在这里拿到：JS 侧只有 length，128×86 的封面被当成 128 行宽采样会斜成条纹。
        WritableNativeMap result = new WritableNativeMap();
        result.putArray("pixels", pixelArray);
        result.putInt("width", scaled.getWidth());
        result.putInt("height", scaled.getHeight());
        promise.resolve(result);
      } catch (Throwable t) {
        // 必须是 Throwable 不是 Exception：大封面解码可能抛 OutOfMemoryError，那是 Error 不是 Exception。
        // ART 上工作线程里逃逸的 Throwable 会直接把整个 App 杀掉（用户看到的是"进播放页偶发闪退"）；
        // 而且 promise 会永不 settle —— Task 5 的 pixelCache 按 url 缓存 Promise，
        // 一条永不 settle 的 promise 等于这张封面到杀进程为止都不会再尝试上色，违反"失败即回落"。
        promise.reject("PALETTE_FAILED", String.valueOf(t), t);
      } finally {
        try {
          if (scaled != null && scaled != decoded) scaled.recycle();
          if (decoded != null) decoded.recycle();
        } catch (Throwable ignored) {
          // recycle 只在 finally 里跑，此刻 promise 已经 settle，抛出去只会杀进程，换不到任何信息
        }
      }
    });
  }

  // 封面字节预热：把下一首的封面原图下载进 Fresco 的磁盘缓存。
  // 不能用 RN 自带的 Image.prefetch —— 它建请求时不带 headers
  // （ImageLoaderModule.java:219 是 ImageRequestBuilder.newBuilderWithSource(uri).build()），
  // 而有 UA 校验的 CDN 会 403。这里复用 ReactNetworkImageRequest，
  // headers 由 ReactOkHttpNetworkFetcher.java:60-63 真正发出去，落到与页面渲染同一个 pipeline。
  @ReactMethod
  public void prefetchImageWithHeaders(String url, ReadableMap headers, Promise promise) {
    if (url == null || url.isEmpty() || !url.startsWith("http")) {
      promise.resolve(false);
      return;
    }
    try {
      ImageRequest request = ReactNetworkImageRequest.fromBuilderWithHeaders(
        ImageRequestBuilder.newBuilderWithSource(Uri.parse(url)), headers);
      DataSource<Void> prefetchSource = Fresco.getImagePipeline().prefetchToDiskCache(request, null);
      prefetchSource.subscribe(new BaseDataSubscriber<Void>() {
        @Override
        protected void onNewResultImpl(DataSource<Void> dataSource) {
          boolean isFinished = dataSource.isFinished();
          dataSource.close();
          if (isFinished) promise.resolve(true);
        }

        @Override
        protected void onFailureImpl(DataSource<Void> dataSource) {
          Throwable t = dataSource.getFailureCause();
          dataSource.close();
          // 预热失败只是"下一首还得现下"，不值得像 getArgbPixels 那样 reject：
          // reject 会让 JS 侧每个坏封面都走一遍 catch，还会在 __DEV__ 刷一堆红字。
          Log.d("PaletteModule", "cover prefetch failed: " + (t == null ? "unknown" : t.getMessage()));
          promise.resolve(false);
        }
      }, CallerThreadExecutor.getInstance());
    } catch (Throwable t) {
      // 工作线程外的 Throwable 也一并吃掉：prefetch 不是正确性路径。
      Log.d("PaletteModule", "cover prefetch threw: " + t);
      promise.resolve(false);
    }
  }

  private byte[] readBytes(String url) throws Exception {
    String path = url.startsWith("file://") ? Uri.parse(url).getPath() : url;
    if (path == null) throw new Exception("bad file uri");
    if (!path.startsWith("http")) {
      File file = new File(path);
      FileInputStream in = new FileInputStream(file);
      try {
        return readAll(in, MAX_LOCAL_BYTES);
      } finally {
        in.close();
      }
    }
    HttpURLConnection conn = (HttpURLConnection) new URL(path).openConnection();
    conn.setRequestProperty("User-Agent", USER_AGENT);
    // 单线程 executor 意味着排队：一个"慢慢滴"的服务器能占住这条唯一的工作线程，
    // 把用户正在听的这首歌的上色挤到几十秒后。背景是装饰功能，过期就回落，不值得等 8+8 秒。
    conn.setConnectTimeout(4000);
    conn.setReadTimeout(4000);
    conn.setInstanceFollowRedirects(true);
    try {
      int code = conn.getResponseCode();
      if (code < 200 || code >= 400) throw new Exception("http " + code);
      // 走到这里只剩 2xx/3xx：3xx 没跟随时响应体在 getInputStream()，getErrorStream() 恒为 null，
      // 那样会把"靠 UA 才拿得到的 CDN 跳转封面"误判成取色失败。
      InputStream in = conn.getInputStream();
      if (in == null) throw new Exception("empty body");
      try {
        return readAll(in, MAX_DOWNLOAD_BYTES);
      } finally {
        in.close();
      }
    } finally {
      conn.disconnect();
    }
  }

  private byte[] readAll(InputStream in, int maxBytes) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
      if (out.size() + read > maxBytes) throw new Exception("image too large");
      out.write(buffer, 0, read);
    }
    return out.toByteArray();
  }
}
