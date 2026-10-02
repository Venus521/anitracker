package android.content;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;

import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * 桌面测试替身：壳里那几个类真正碰到的 Android 能力就这几样。
 * 偏好存内存（一次进程内的读写对得上就行）；外置目录指到临时目录，
 * 这样 WebUpdater 的下载/校验/换目录在电脑上跑的是手机上那份字节。
 */
public class Context {
    public static final int MODE_PRIVATE = 0;

    private final AssetManager am;
    private final File external;
    private final PackageInfo pi = new PackageInfo();
    private final PackageManager pm = new PackageManager(pi);
    private final Map<String, SharedPreferences> prefs = new HashMap<String, SharedPreferences>();

    public Context(String assetsRoot) {
        this(assetsRoot, null);
    }

    public Context(String assetsRoot, String externalDir) {
        this.am = new AssetManager(assetsRoot);
        this.external = externalDir == null ? null : new File(externalDir);
    }

    public AssetManager getAssets() {
        return am;
    }

    public File getExternalFilesDir(String type) {
        return external;
    }

    public File getFilesDir() {
        return external;
    }

    public String getPackageName() {
        return "com.venus.anitracker";
    }

    public PackageManager getPackageManager() {
        return pm;
    }

    /** 门禁要演「装了新版 App」这一幕，就直接改这个版本号。 */
    public void setVersionCode(int code) {
        pi.versionCode = code;
    }

    public SharedPreferences getSharedPreferences(String name, int mode) {
        synchronized (prefs) {
            SharedPreferences p = prefs.get(name);
            if (p == null) {
                p = new SharedPreferences();
                prefs.put(name, p);
            }
            return p;
        }
    }
}

