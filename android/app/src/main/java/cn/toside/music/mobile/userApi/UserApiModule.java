package cn.toside.music.mobile.userApi;

import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.util.Log;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import java.lang.Thread;

public class UserApiModule extends ReactContextBaseJavaModule {
  private JavaScriptThread javaScriptThread;
  private final ReactApplicationContext reactContext;
  private UtilsEvent utilsEvent;

  private int listenerCount = 0;

  UserApiModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.javaScriptThread = null;
    this.utilsEvent = null;
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "UserApiModule";
  }

  @ReactMethod
  public void addListener(String eventName) {
    if (listenerCount == 0) {
      // Set up any upstream listeners or background tasks as necessary
    }

    listenerCount += 1;
  }

  @ReactMethod
  public void removeListeners(Integer count) {
    listenerCount -= count;
    if (listenerCount == 0) {
      // Remove upstream listeners, stop unnecessary background tasks
    }
  }

  @ReactMethod
  public void loadScript(ReadableMap data) {
    if (this.utilsEvent == null) this.utilsEvent = new UtilsEvent(this.reactContext);
    if (this.javaScriptThread != null) destroy();
    Bundle info = Arguments.toBundle(data);
    this.javaScriptThread = new JavaScriptThread(this.reactContext, info);
    // 加载序号一路带到 init 事件里：JS 侧据此丢掉上一次加载迟到的事件
    this.javaScriptThread.prepareHandler(new JsHandler(this.reactContext.getMainLooper(), this.utilsEvent, info.getString("loadSeq", "")));
    this.javaScriptThread.getHandler().sendEmptyMessage(HandlerWhat.INIT);
    this.javaScriptThread.setUncaughtExceptionHandler((thread, ex) -> {
      Handler jsHandler = javaScriptThread.getHandler();
      Message message = jsHandler.obtainMessage();
      message.what = HandlerWhat.LOG;
      message.obj = new Object[]{"error", "Uncaught exception in JavaScriptThread: " + ex.getMessage()};
      jsHandler.sendMessage(message);
      Log.e("JavaScriptThread", "Uncaught exception in JavaScriptThread: " + ex.getMessage());
    });
    Log.d("UserApi", "Module Thread id: " + Thread.currentThread().getId());
  }

  @ReactMethod
  public boolean sendAction(String action, String info) {
    JavaScriptThread javaScriptThread = this.javaScriptThread;
    if (javaScriptThread == null) return false;
    Handler jsHandler = javaScriptThread.getHandler();
    Message message = jsHandler.obtainMessage();
    message.what = HandlerWhat.ACTION;
    message.obj = new Object[]{action, info};
    jsHandler.sendMessage(message);
    return true;
  }

  @ReactMethod
  public void destroy() {
    JavaScriptThread javaScriptThread = this.javaScriptThread;
    if (javaScriptThread == null) return;
    // 先叫停再收线程：quit 后排在后面的 DESTROY 可能丢，但旧实例绝不能再往 JS 发事件
    javaScriptThread.markDestroyed();
    javaScriptThread.getHandler().sendEmptyMessage(HandlerWhat.DESTROY);
    javaScriptThread.stopThread();
    this.javaScriptThread = null;
  }
}
