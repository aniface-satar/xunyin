package cn.toside.music.mobile.island;

import android.content.ContentProviderClient;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Bridge for the vendor "dynamic island" / capsule capabilities.
 *
 * Two families of APIs are used by the OEMs for third party apps:
 *
 *  1. The media capsule (HONOR Magic Capsule "媒体胶囊" / OPPO ColorOS "音乐流体云" /
 *     vivo OriginOS "原子岛"). Those are driven by a plain Android MediaSession plus a
 *     MediaStyle notification, which is produced by react-native-track-player
 *     (see MetadataManager.java in the track player fork), so no extra call is required.
 *
 *  2. The explicit Fluid Cloud intent sharing API (OPPO ColorOS). OPPO exposes it through a
 *     system ContentProvider called "IntelligentIntent". A card is created / refreshed /
 *     dismissed by calling "shareIntent" with an IntelligentIntent JSON payload whose
 *     intentAction.actionStatus is 0 / 1 / 2.
 *
 * The second one needs the app to be granted the intent-share permission by OPPO for the
 * matching 垂域 (entityName), otherwise the provider answers with code 10101001
 * ("应用无该意图共享权限").
 */
public class IslandModule extends ReactContextBaseJavaModule {
  public static final String NAME = "IslandModule";

  /** OPPO system provider used by the "意图共享（端侧）" / Fluid Cloud API. */
  private static final String OPPO_INTENT_AUTHORITY = "IntelligentIntent";
  private static final String OPPO_INTENT_METHOD = "shareIntent";
  private static final String OPPO_INTENT_EXTRA = "intentData";

  private final ReactApplicationContext reactContext;

  public IslandModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  private static String getSystemProperty(String key) {
    try {
      Class<?> clazz = Class.forName("android.os.SystemProperties");
      Object value = clazz.getMethod("get", String.class).invoke(null, key);
      return value == null ? "" : (String) value;
    } catch (Throwable ignored) {
      return "";
    }
  }

  private static boolean containsAny(String haystack, String... needles) {
    if (haystack == null) return false;
    String value = haystack.toLowerCase(Locale.ROOT);
    for (String needle : needles) {
      if (value.contains(needle)) return true;
    }
    return false;
  }

  private static boolean isOppoFamily() {
    if (containsAny(Build.MANUFACTURER, "oppo", "oneplus", "realme")) return true;
    if (containsAny(Build.BRAND, "oppo", "oneplus", "realme")) return true;
    return !getSystemProperty("ro.build.version.opporom").isEmpty()
      || !getSystemProperty("ro.oppo.market.name").isEmpty()
      || !getSystemProperty("ro.build.version.oplusrom").isEmpty();
  }

  private static boolean isHonorFamily() {
    if (containsAny(Build.MANUFACTURER, "honor", "hihonor")) return true;
    if (containsAny(Build.BRAND, "honor")) return true;
    return !getSystemProperty("ro.build.version.magic").isEmpty()
      || !getSystemProperty("ro.build.version.honor").isEmpty();
  }

  private static boolean isVivoFamily() {
    if (containsAny(Build.MANUFACTURER, "vivo", "iqoo")) return true;
    return !getSystemProperty("ro.vivo.os.version").isEmpty();
  }

  /** Resolves the URI of the OPPO intent provider, or null when it is not installed. */
  private ContentProviderClient acquireOppoIntentProvider() {
    try {
      return reactContext.getContentResolver()
        .acquireUnstableContentProviderClient(OPPO_INTENT_AUTHORITY);
    } catch (Throwable ignored) {
      return null;
    }
  }

  private static void closeQuietly(ContentProviderClient client) {
    if (client == null) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        client.close();
      } else {
        //noinspection deprecation
        client.release();
      }
    } catch (Throwable ignored) {
    }
  }

  /**
   * Reports which capsule flavours the current device can talk to.
   */
  @ReactMethod
  public void getSupportInfo(Promise promise) {
    new Thread(() -> {
      try {
        WritableMap info = Arguments.createMap();
        info.putString("brand", Build.BRAND == null ? "" : Build.BRAND);
        info.putString("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        info.putString("model", Build.MODEL == null ? "" : Build.MODEL);
        info.putInt("sdkInt", Build.VERSION.SDK_INT);
        info.putBoolean("isOppoFamily", isOppoFamily());
        info.putBoolean("isHonorFamily", isHonorFamily());
        info.putBoolean("isVivoFamily", isVivoFamily());
        // The MediaStyle based music capsule is a platform feature, every one of these ROMs
        // renders it (when the user enabled it in the system settings).
        info.putBoolean("supportsMediaCapsule", true);

        ContentProviderClient client = acquireOppoIntentProvider();
        boolean hasIntentProvider = client != null;
        closeQuietly(client);
        info.putBoolean("supportsFluidCloudIntent", hasIntentProvider);
        promise.resolve(info);
      } catch (Throwable e) {
        promise.reject("ISLAND_SUPPORT_FAILED", e);
      }
    }).start();
  }

  /**
   * Creates / refreshes / dismisses an OPPO Fluid Cloud card.
   *
   * @param intentData the IntelligentIntent JSON string, see the OPPO
   *                   "意图共享数据结构" documentation.
   */
  @ReactMethod
  public void shareFluidCloudIntent(String intentData, Promise promise) {
    if (intentData == null || intentData.isEmpty()) {
      promise.reject("ISLAND_INVALID_ARGUMENT", "intentData must not be empty");
      return;
    }
    new Thread(() -> {
      ContentProviderClient client = null;
      try {
        client = acquireOppoIntentProvider();
        if (client == null) {
          promise.reject("ISLAND_NOT_SUPPORTED",
            "The IntelligentIntent content provider is not available on this device");
          return;
        }

        Bundle extras = new Bundle();
        extras.putString(OPPO_INTENT_EXTRA, intentData);

        Bundle result = client.call(OPPO_INTENT_METHOD, null, extras);
        String raw = result == null ? null : result.getString("result");

        WritableMap payload = Arguments.createMap();
        payload.putString("raw", raw);
        if (raw == null || raw.isEmpty()) {
          payload.putInt("code", -1);
          payload.putString("message", "empty response from IntelligentIntent provider");
        } else {
          JSONObject json = new JSONObject(raw);
          payload.putInt("code", json.optInt("code", -1));
          payload.putString("message", json.optString("message", ""));
          if (json.has("data")) payload.putString("data", json.optString("data", ""));
        }
        promise.resolve(payload);
      } catch (Throwable e) {
        promise.reject("ISLAND_SHARE_FAILED", e);
      } finally {
        closeQuietly(client);
      }
    }).start();
  }

  /**
   * Convenience helper: dismisses (销卡) a previously created Fluid Cloud card.
   */
  @ReactMethod
  public void dismissFluidCloudIntent(String identifier, Promise promise) {
    if (identifier == null || identifier.isEmpty()) {
      promise.reject("ISLAND_INVALID_ARGUMENT", "identifier must not be empty");
      return;
    }
    try {
      JSONObject intentAction = new JSONObject();
      intentAction.put("actionStatus", 2);
      JSONObject payload = new JSONObject();
      payload.put("identifier", identifier);
      payload.put("intentAction", intentAction);
      shareFluidCloudIntent(payload.toString(), promise);
    } catch (Throwable e) {
      promise.reject("ISLAND_DISMISS_FAILED", e);
    }
  }

  /** Exposed for diagnostics; returns whether the OPPO provider can be reached. */
  @ReactMethod
  public void isFluidCloudSupported(Promise promise) {
    new Thread(() -> {
      ContentProviderClient client = acquireOppoIntentProvider();
      boolean available = client != null;
      closeQuietly(client);
      promise.resolve(available);
    }).start();
  }
}