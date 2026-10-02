import android.content.Context;
import com.venus.anitracker.LocalServer;

import java.io.File;

/**
 * 桌面测试入口：把真正会上 APK 的 LocalServer 跑起来。
 * 参数：assets 根目录、可选上游、可选热更内容目录（对应手机上 WebUpdater 下来的那一份）。
 */
public class ServerMain {
    public static void main(String[] args) throws Exception {
        Context ctx = new Context(args[0], args.length > 3 ? args[3] : null);
        String up = args.length > 1 && args[1].length() > 0 ? args[1] : null;
        File root = args.length > 2 && args[2].length() > 0 ? new File(args[2]) : null;
        LocalServer s = LocalServer.start(ctx, up, root);
        System.out.println("READY " + s.pageUrl());
        Thread.sleep(120000);
        s.stop();
    }
}
