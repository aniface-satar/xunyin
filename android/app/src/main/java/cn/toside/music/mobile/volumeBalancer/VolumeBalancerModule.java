package cn.toside.music.mobile.volumeBalancer;

import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

/**
 * 音量均衡：在播放器的 audio session 上挂系统 DynamicsProcessing 的多段压缩器（MBC），
 * 把响的歌曲动态压小，缩小不同歌曲之间的音量差异。
 */
public class VolumeBalancerModule extends ReactContextBaseJavaModule {
  private static final String TAG = "VolumeBalancer";

  // 音效归属于播放器的 audio session，而 JS 模块实例会在 RN 重载时重建，
  // 所以实例必须放在静态字段上，否则每次重载都会泄漏一个系统音效。
  private static DynamicsProcessing sEffect = null;
  private static int sSessionId = -1;

  public VolumeBalancerModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "VolumeBalancerModule";
  }

  @ReactMethod
  public void apply(double sessionIdNumber, double levelNumber, Promise promise) {
    Log.i(TAG, "apply called: session=" + sessionIdNumber + " level=" + levelNumber
        + " sdk=" + Build.VERSION.SDK_INT);
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      promise.resolve(buildResult(false, "UNSUPPORTED_SDK"));
      return;
    }
    int sessionId = (int) sessionIdNumber;
    // session 由音频渲染器就绪后才分配，未就绪时是 0，等下一次播放事件再试
    if (sessionId <= 0) {
      promise.resolve(buildResult(false, "NO_SESSION"));
      return;
    }
    int level = (int) levelNumber;

    if (sEffect != null && sSessionId == sessionId) {
      configure(level, promise);
      return;
    }

    releaseEffect();
    try {
      sEffect = new DynamicsProcessing(sessionId);
    } catch (Throwable err) {
      Log.e(TAG, "Create DynamicsProcessing failed", err);
      promise.resolve(buildResult(false, "CREATE_FAILED"));
      return;
    }
    sSessionId = sessionId;
    configure(level, promise);
  }

  @ReactMethod
  public void release(Promise promise) {
    releaseEffect();
    promise.resolve(buildResult(true, "RELEASED"));
  }

  private void configure(int level, Promise promise) {
    DynamicsProcessing effect = sEffect;
    if (effect == null) {
      promise.resolve(buildResult(false, "NOT_APPLIED"));
      return;
    }
    try {
      DynamicsProcessing.Config config = effect.getConfig();
      int channelCount = effect.getChannelCount();
      int bandCount = config.getMbcBandCount();
      if (!config.isMbcInUse() || bandCount <= 0) {
        Log.e(TAG, "Effect has no usable MBC stage, channels=" + channelCount + " bands=" + bandCount);
        promise.resolve(buildResult(false, "NO_MBC"));
        return;
      }

      float ratio;
      float thresholdDb;
      float postGainDb;
      if (level <= 0) {
        ratio = 2.0f;
        thresholdDb = -12.0f;
        postGainDb = 0.0f;
      } else if (level == 1) {
        ratio = 4.0f;
        thresholdDb = -18.0f;
        postGainDb = 1.0f;
      } else {
        ratio = 8.0f;
        thresholdDb = -24.0f;
        postGainDb = 2.0f;
      }

      for (int channel = 0; channel < channelCount; channel++) {
        DynamicsProcessing.Mbc mbc = effect.getMbcByChannelIndex(channel);
        mbc.setEnabled(true);
        effect.setMbcByChannelIndex(channel, mbc);
      }
      for (int band = 0; band < bandCount; band++) {
        DynamicsProcessing.MbcBand params =
            new DynamicsProcessing.MbcBand(config.getMbcBandByChannelIndex(0, band));
        params.setEnabled(true);
        params.setRatio(ratio);
        params.setThreshold(thresholdDb);
        params.setKneeWidth(3.0f);
        params.setAttackTime(5.0f);
        params.setReleaseTime(150.0f);
        params.setPreGain(0.0f);
        params.setPostGain(postGainDb);
        params.setExpanderRatio(1.0f);
        params.setNoiseGateThreshold(-90.0f);
        effect.setMbcBandAllChannelsTo(band, params);
      }
      // 限幅器只打开、不改参数：补偿增益后要靠它挡一下爆音，参数留给设备默认值。
      if (config.isLimiterInUse()) {
        for (int channel = 0; channel < channelCount; channel++) {
          DynamicsProcessing.Limiter limiter = effect.getLimiterByChannelIndex(channel);
          limiter.setEnabled(true);
          effect.setLimiterByChannelIndex(channel, limiter);
        }
      }

      Log.i(TAG, "Volume balancer applied: session=" + sSessionId + " level=" + level
          + " channels=" + channelCount + " mbcBands=" + bandCount
          + " limiter=" + config.isLimiterInUse());
      promise.resolve(buildResult(true, "OK"));
    } catch (Throwable err) {
      Log.e(TAG, "Configure DynamicsProcessing failed", err);
      releaseEffect();
      promise.resolve(buildResult(false, "CONFIGURE_FAILED"));
    }
  }

  private static void releaseEffect() {
    if (sEffect == null) return;
    try {
      sEffect.release();
    } catch (Throwable err) {
      Log.e(TAG, "Release DynamicsProcessing failed", err);
    }
    sEffect = null;
    sSessionId = -1;
  }

  private static WritableMap buildResult(boolean ok, String code) {
    Log.i(TAG, "result: ok=" + ok + " code=" + code);
    WritableMap result = Arguments.createMap();
    result.putBoolean("ok", ok);
    result.putString("code", code);
    return result;
  }
}
