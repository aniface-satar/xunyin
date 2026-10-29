package cn.xunyin.music.palette;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Log;

import com.facebook.common.executors.CallerThreadExecutor;
import com.facebook.datasource.BaseDataSubscriber;
import com.facebook.datasource.DataSource;
import com.facebook.react.bridge.ReadableMap;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PaletteModule extends ReactContextBaseJavaModule {

  // 与 src/components/common/Image.tsx 的 defaultHeaders 保持一致，否则部分音源封面取不到图
  private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";

  private static final String TAG = "PaletteModule";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  // 网络响应 4MB：封面实际几十到几百 KB，超了就是"自称是图片"的东西在撑堆。
  private static final int MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
  // 本地文件单独放宽到 32MB：本机歌曲的封面是内嵌图抽出来的文件（src/core/music/local.ts:112 会拼成 file://），
  // FLAC/高码率的内嵌封面超 4MB 很常见，用网络那个上限会把它们静默判成取色失败。
  private static final int MAX_LOCAL_BYTES = 32 * 1024 * 1024;

  // 同一张封面现在要被 readBytes 读两遍：取色那一遍要像素，糊底这一遍要位图。
  // 这条路径不经过 Fresco 的磁盘缓存（它自带 UA，走的是 HttpURLConnection），所以缓存得自己留。
  // 只留两格：切歌时两条请求背靠背落在同一个 url 上，第二格挡住"上一首还挂在宽限期里"的窗口。
  // 只收 1.5MB 以下的条目 —— 网络上限 4MB 是"防自称图片的东西撑堆"用的，真按 4MB 留两格就是白占 8MB 堆，
  // 而真实封面按下面的注释是几十到几百 KB，超上限的本就是异常件，不值得为它们留内存。
  private static final int BYTE_CACHE_ENTRIES = 2;
  private static final int BYTE_CACHE_MAX_ENTRY_BYTES = 1536 * 1024;

  private final Map<String, byte[]> byteCache = new LinkedHashMap<String, byte[]>(4, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
      return size() > BYTE_CACHE_ENTRIES;
    }
  };

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
        byte[] raw = readBytesCached(target);
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

  /**
   * 播放页 ②「动态取色」那一档的糊底位图：产出"小图 + 中等盒模糊 + 裁掉脏边"的一张 PNG，交回文件路径。
   *
   * 为什么不能在 JS 侧用 RN 的 blurRadius 顶替：那个半径是 dp 换算成**屏幕像素**后，
   * 再套到**解码出来的位图**上的（ReactImageView 给 Fresco 的 IterativeBoxBlurPostProcessor）。
   * 于是同一份 blurRadius 在 300px 的封面上会把整张糊成一坨平均色，在 1000px 的封面上又只糊掉细节 ——
   * 想调出"云纹还在、图案读不出"这一格，得跟着封面分辨率走，JS 侧根本不知道那个数。
   * 这里把长边先归一到 side 再糊，半径才是按同一尺度生效的。
   *
   * 参数由 JS 侧（src/utils/monet/backdropBlur.ts）传进来：档位与它的 σ 推导要能 node --test。
   */
  @ReactMethod
  public void getBlurredBackdrop(String url, int edge, int radius, int iterations, int cropPercent, Promise promise) {
    if (url == null || url.isEmpty()) {
      promise.reject("PALETTE_EMPTY_URL", "url is empty");
      return;
    }
    final String target = url;
    // 每一路参数都钳到"还能算完"的量级：这几个数由 JS 传，坏值不该把单线程 executor 卡死或把堆撑爆。
    final int side = Math.max(32, Math.min(edge <= 0 ? 300 : edge, 512));
    final int r = Math.max(1, Math.min(radius <= 0 ? 10 : radius, 64));
    final int times = Math.max(1, Math.min(iterations <= 0 ? 3 : iterations, 6));
    final int crop = Math.max(0, Math.min(cropPercent, 20));
    executor.execute(() -> {
      Bitmap decoded = null;
      Bitmap scaled = null;
      Bitmap blurred = null;
      Bitmap cropped = null;
      FileOutputStream out = null;
      try {
        File target2 = backdropTargetFile(target, side, r, times, crop);
        if (target2 == null) {
          promise.reject("PALETTE_NO_CONTEXT", "react context is gone");
          return;
        }
        if (target2.exists() && target2.length() > 0) {
          promise.resolve(target2.getAbsolutePath());
          return;
        }

        byte[] raw = readBytesCached(target);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("image not decodable");

        int sample = 1;
        // 这里的下界是 side 而不是 side/2：位图最后还要被 createScaledBitmap 精确撑到 side，
        // 按取色那路的 side/2 收会先糊过头再放大，白丢一层细节。
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= side) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        decoded = BitmapFactory.decodeByteArray(raw, 0, raw.length, options);
        if (decoded == null) throw new Exception("decode returned null");

        int width = decoded.getWidth();
        int height = decoded.getHeight();
        // 不夹 1f 的下界：小封面也要撑到 side。归一是为了让盒模糊的相对强度与封面原分辨率无关 ——
        // 100px 的封面不放大就糊 r=10，等于糊掉整张的 10%，比 300px 上糊 r=10 重三倍。
        float ratio = (float) side / Math.max(width, height);
        scaled = ratio == 1f
          ? decoded
          : Bitmap.createScaledBitmap(decoded, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);

        int w = scaled.getWidth();
        int h = scaled.getHeight();
        int[] pixels = new int[w * h];
        scaled.getPixels(pixels, 0, w, 0, 0, w, h);
        for (int i = 0; i < times; i++) pixels = boxBlurPass(pixels, w, h, r);
        blurred = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888);

        // 裁掉四周各 crop%：盒模糊读到图外面用的是钳边（复制边缘像素），于是贴边一圈比中间暗/脏。
        // 这一档最后要放大十倍铺满全屏，那圈脏边会跟着放大成一条看得见的暗框 ——
        // 现在 JS 侧那条 OVERSCAN 变换就是在屏幕坐标上补这件事，裁在源上才是它的正解。
        int cx = Math.round(w * crop / 100f);
        int cy = Math.round(h * crop / 100f);
        Bitmap result = blurred;
        if (cx > 0 && cy > 0 && w - cx * 2 > 0 && h - cy * 2 > 0) {
          cropped = Bitmap.createBitmap(blurred, cx, cy, w - cx * 2, h - cy * 2);
          result = cropped;
        }

        File tmp = new File(target2.getAbsolutePath() + ".tmp");
        out = new FileOutputStream(tmp);
        result.compress(Bitmap.CompressFormat.PNG, 100, out);
        out.flush();
        out.close();
        out = null;
        // 先写 .tmp 再改名：半张 PNG 落在缓存目录里会被下一次的 exists() 当成命中，
        // 于是那张封面的糊底永远坏在"只写了一半"那一版。
        if (!tmp.renameTo(target2)) {
          if (!target2.exists()) throw new Exception("rename failed");
        }
        promise.resolve(target2.getAbsolutePath());
      } catch (Throwable t) {
        // 与 getArgbPixels 同一个理由：必须接 Throwable（OOM 是 Error），否则工作线程里逃逸出去会直接杀进程，
        // 而且 promise 永不 settle —— JS 侧按 url 缓存了这条 promise，等于这张封面到杀进程为止都不会再糊。
        promise.reject("BACKDROP_FAILED", String.valueOf(t), t);
      } finally {
        if (out != null) {
          try {
            out.close();
          } catch (Throwable ignored) {
            // 已经 reject 过了，关不掉临时文件只是留个 .tmp，换不到信息
          }
        }
        try {
          if (cropped != null && cropped != blurred) cropped.recycle();
          if (blurred != null) blurred.recycle();
          if (scaled != null && scaled != decoded) scaled.recycle();
          if (decoded != null) decoded.recycle();
        } catch (Throwable ignored) {
          // recycle 只在 finally 里跑，此刻 promise 已经 settle，抛出去只会杀进程
        }
      }
    });
  }

  // 糊底位图的落盘位置：cacheDir/cover-backdrop/<md5(参数+url)>.png。
  // 参数进 key 是为了改档位之后旧产物自然失效，而不是让新参数读回上一档的糊图。
  private File backdropTargetFile(String url, int side, int r, int times, int crop) {
    try {
      ReactApplicationContext context = getReactApplicationContext();
      File dir = new File(context.getCacheDir(), "cover-backdrop");
      if (!dir.isDirectory() && !dir.mkdirs()) return null;
      MessageDigest digest = MessageDigest.getInstance("MD5");
      byte[] hash = digest.digest((side + ":" + r + ":" + times + ":" + crop + ":" + url).getBytes("UTF-8"));
      StringBuilder name = new StringBuilder(hash.length * 2);
      for (byte b : hash) {
        name.append(Character.forDigit((b >> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
      }
      return new File(dir, name + ".png");
    } catch (Throwable t) {
      Log.w(TAG, "backdrop path failed: " + url + " - " + t);
      return null;
    }
  }

  /**
   * 一次可分离盒模糊：先横后竖，窗口宽 2r+1，越界按钳边（复制最外圈像素）处理。
   * 迭代次数由调用方给 —— 3 次盒模糊叠出来的 σ 约等于单次乘 √3，那才是逆向到的那一档。
   * 逐通道滑动窗口，O(w*h) 一遍，300×300 三次在这里是毫秒级，不值得上 RenderScript。
   */
  private static int[] boxBlurPass(int[] src, int w, int h, int r) {
    int[] tmp = new int[w * h];
    int[] dst = new int[w * h];
    int win = r * 2 + 1;

    for (int y = 0; y < h; y++) {
      int row = y * w;
      int sr = 0;
      int sg = 0;
      int sb = 0;
      for (int i = -r; i <= r; i++) {
        int p = src[row + clampIndex(i, w)];
        sr += (p >> 16) & 255;
        sg += (p >> 8) & 255;
        sb += p & 255;
      }
      for (int x = 0; x < w; x++) {
        int self = src[row + x];
        tmp[row + x] = (self & 0xFF000000) | ((sr / win) << 16) | ((sg / win) << 8) | (sb / win);
        int add = src[row + clampIndex(x + r + 1, w)];
        int sub = src[row + clampIndex(x - r, w)];
        sr += ((add >> 16) & 255) - ((sub >> 16) & 255);
        sg += ((add >> 8) & 255) - ((sub >> 8) & 255);
        sb += (add & 255) - (sub & 255);
      }
    }

    for (int x = 0; x < w; x++) {
      int sa = 0;
      int sr = 0;
      int sg = 0;
      int sb = 0;
      for (int i = -r; i <= r; i++) {
        int p = tmp[clampIndex(i, h) * w + x];
        sa += (p >>> 24);
        sr += (p >> 16) & 255;
        sg += (p >> 8) & 255;
        sb += p & 255;
      }
      for (int y = 0; y < h; y++) {
        dst[y * w + x] = ((sa / win) << 24) | ((sr / win) << 16) | ((sg / win) << 8) | (sb / win);
        int add = tmp[clampIndex(y + r + 1, h) * w + x];
        int sub = tmp[clampIndex(y - r, h) * w + x];
        sa += (add >>> 24) - (sub >>> 24);
        sr += ((add >> 16) & 255) - ((sub >> 16) & 255);
        sg += ((add >> 8) & 255) - ((sub >> 8) & 255);
        sb += (add & 255) - (sub & 255);
      }
    }
    return dst;
  }

  // 钳边：窗口伸出图外时读到最外圈那一列/行，而不是绕回对侧（环绕会在接缝上多出一条亮边）。
  private static int clampIndex(int index, int size) {
    return index < 0 ? 0 : (index >= size ? size - 1 : index);
  }

  private byte[] readBytesCached(String url) throws Exception {
    byte[] hit;
    synchronized (byteCache) {
      hit = byteCache.get(url);
    }
    if (hit != null) return hit;
    byte[] raw = readBytes(url);
    if (raw.length <= BYTE_CACHE_MAX_ENTRY_BYTES) {
      synchronized (byteCache) {
        byteCache.put(url, raw);
      }
    }
    return raw;
  }

  // 封面字节预热：把下一首的封面原图下载进 Fresco 的磁盘缓存。
  // 不能用 RN 自带的 Image.prefetch —— 它建请求时不带 headers
  // （ImageLoaderModule.java:219 是 ImageRequestBuilder.newBuilderWithSource(uri).build()），
  // 而有 UA 校验的 CDN 会 403。这里复用 ReactNetworkImageRequest，
  // headers 由 ReactOkHttpNetworkFetcher.java:59-72 真正发出去，落到与页面渲染同一个 pipeline。
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
          // prefetch 会先推一次"还没结束"的中间结果再推终态，中间结果这次 isFinished 还是 false，
          // 必须早退等下一个回调，此刻既不能 settle 也不能 close：
          // close 等于把中间结果当终态、自己把这次预热取消掉，而 BaseDataSubscriber.onCancellation
          // 是空实现、不会被回调，promise 就永久 settle 不了了 —— Task 5 那边按 url 缓存了这个
          // promise 的话，下一首的封面到杀进程为止都不会再预热。
          // 终态回调（成功或失败）之后 Fresco 的 BaseDataSubscriber 自己会 close，所以这里不手动 close。
          if (!dataSource.isFinished()) return;
          promise.resolve(true);
        }

        @Override
        protected void onFailureImpl(DataSource<Void> dataSource) {
          Throwable t = dataSource.getFailureCause();
          // 预热失败只是"下一首还得现下"，不值得像 getArgbPixels 那样 reject：
          // reject 会让 JS 侧每个坏封面都走一遍 catch，还会在 __DEV__ 刷一堆红字。
          // 带上 url：坏封面得能在 logcat 里对上号，否则只知道"有一张没预热上"。
          Log.w(TAG, "cover prefetch failed: " + url + " - " + (t == null ? "unknown" : t.getMessage()));
          promise.resolve(false);
        }
      }, CallerThreadExecutor.getInstance());
    } catch (Throwable t) {
      // 工作线程外的 Throwable 也一并吃掉：prefetch 不是正确性路径。
      Log.w(TAG, "cover prefetch threw: " + url + " - " + t);
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
