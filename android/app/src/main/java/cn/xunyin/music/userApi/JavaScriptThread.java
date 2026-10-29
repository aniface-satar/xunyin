package cn.xunyin.music.userApi;

import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Message;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;

public class JavaScriptThread extends HandlerThread {
  private Handler handler;
  private volatile QuickJS javaScriptExecutor;
  private final ReactApplicationContext reactContext;
  private final Bundle scriptInfo;
  // 这个线程已经被替换掉了：队列里剩下的消息不再执行
  private volatile boolean stopped = false;

  JavaScriptThread(ReactApplicationContext context, Bundle info) {
    super("JavaScriptThread");
    this.reactContext = context;
    this.scriptInfo = info;
  }

  public void prepareHandler(final Handler mainHandler) {
    start();
    Log.d("UserApi [thread]", "running 2");
    this.handler = new Handler(getLooper()) {
      @Override
      public void handleMessage(@NonNull Message message) {
        // 销毁消息最优先处理：即使这个线程已经被换掉，也要把上下文清掉
        if (message.what == HandlerWhat.DESTROY) {
          if (javaScriptExecutor != null) {
            javaScriptExecutor.destroy();
            javaScriptExecutor = null;
          }
          return;
        }
        // 被替换掉的线程还剩消息没执行完：一样都不许做
        if (stopped) return;
        if (javaScriptExecutor == null) {
          javaScriptExecutor = new QuickJS(reactContext, mainHandler);
          // 创建期间被换掉了：这个实例一个事件都不许发，也不许再加载脚本
          if (stopped) {
            javaScriptExecutor.markDestroyed();
            return;
          }
          Log.d("UserApi [thread]", "javaScript executor created");
          String result = javaScriptExecutor.loadScript(scriptInfo);
          if ("".equals(result)) {
            Log.d("UserApi [thread]", "script loaded");
            mainHandler.sendEmptyMessage(HandlerWhat.INIT_SUCCESS);
          } else {
            Log.w("UserApi [thread]", "script load failed: " + result);
            mainHandler.sendMessage(mainHandler.obtainMessage(HandlerWhat.INIT_FAILED, result));
          }
        }
        switch (message.what) {
          case HandlerWhat.INIT: break;
          case HandlerWhat.ACTION: {
            Object[] data = (Object[]) message.obj;
            // Log.d("UserApi [handler]", "handler action: " + data[0]);
            javaScriptExecutor.callJS((String) data[0], data[1]);
            return;
          }
          default:
            Log.w("UserApi [handler]", "Unknown message what: " + message.what);
            break;
        }
      }
    };
  }

  public Handler getHandler() {
    return this.handler;
  }

  /**
   * 换脚本时从外部叫停：先让当前实例闭嘴，队列里剩下的消息也不再执行。
   * 用 quitSafely 而不是 quit：否则排在后面的 DESTROY 会被丢掉，上下文留着不释放。
   */
  public void markDestroyed() {
    this.stopped = true;
    QuickJS executor = this.javaScriptExecutor;
    if (executor != null) executor.markDestroyed();
  }

  public void stopThread() {
    quitSafely();
  }
}
