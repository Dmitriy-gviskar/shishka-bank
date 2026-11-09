package ru.elkakvest.shishka;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

// Держит WebSocket к серверу и показывает системные уведомления (чат, задания…).
// Без Firebase: пуши работают, пока сервис жив (фоновое «связь с лесом»).
public class PushService extends Service {

    public static final String PREFS = "shishka_wv";
    public static final String KEY_TOKEN = "device_token";
    private static final String CH_PUSH = "shishka_push";
    private static final String CH_LINK = "shishka_link";
    private static final int ID_LINK = 42;
    private static final String WS_URL = "wss://elka-kvest-2026.ru/api/push/ws";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private OkHttpClient client;
    private WebSocket socket;
    private int backoffSec = 2;
    private boolean stopped;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, PushService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
        client = new OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_LINK, linkNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(ID_LINK, linkNotification());
        }
        connect();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (socket == null) connect();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        handler.removeCallbacksAndMessages(null);
        try { if (socket != null) socket.close(1000, "bye"); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel push = new NotificationChannel(CH_PUSH, "Сообщения леса", NotificationManager.IMPORTANCE_HIGH);
        push.setDescription("Чаты, задания, подарки");
        nm.createNotificationChannel(push);
        NotificationChannel link = new NotificationChannel(CH_LINK, "Связь с лесом", NotificationManager.IMPORTANCE_MIN);
        link.setDescription("Фоновая доставка уведомлений");
        link.setShowBadge(false);
        nm.createNotificationChannel(link);
    }

    private Notification linkNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CH_LINK)
            : new Notification.Builder(this);
        return b.setContentTitle("Шишка Банк")
            .setContentText("Связь с лесом")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private String token() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        return p.getString(KEY_TOKEN, "");
    }

    private void connect() {
        if (stopped) return;
        String t = token();
        if (t == null || t.isEmpty()) {
            handler.postDelayed(this::connect, 8000);
            return;
        }
        try { if (socket != null) socket.cancel(); } catch (Exception ignored) {}
        Request req = new Request.Builder().url(WS_URL + "?token=" + t).build();
        socket = client.newWebSocket(req, new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                backoffSec = 2;
            }
            @Override public void onMessage(WebSocket webSocket, String text) {
                try {
                    JSONObject o = new JSONObject(text);
                    if (o.optBoolean("ok", false) && !o.has("title")) return;
                    String title = o.optString("title", "Шишка Банк");
                    String body = o.optString("body", "");
                    if (body.isEmpty() && title.isEmpty()) return;
                    showPush(title, body);
                } catch (Exception ignored) {}
            }
            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                scheduleReconnect();
            }
            @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (stopped) return;
        int wait = Math.min(60, backoffSec) * 1000;
        backoffSec = Math.min(60, backoffSec * 2);
        handler.postDelayed(this::connect, wait);
    }

    private void showPush(String title, String body) {
        Intent open = new Intent(this, MainActivity.class);
        open.setData(android.net.Uri.parse("https://elka-kvest-2026.ru/mail.html"));
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CH_PUSH)
            : new Notification.Builder(this);
        Notification n = b.setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(Notification.PRIORITY_HIGH)
            .build();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((int) (System.currentTimeMillis() & 0xfffffff), n);
    }
}
