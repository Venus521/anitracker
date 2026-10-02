package android.content.pm;

/** 桌面测试替身：只回答 WebUpdater 那一次「现在这个 App 是第几版」。 */
public class PackageManager {
    private final PackageInfo info;

    public PackageManager(PackageInfo info) {
        this.info = info;
    }

    public PackageInfo getPackageInfo(String pkg, int flags) throws NameNotFoundException {
        return info;
    }

    public static class NameNotFoundException extends Exception {
    }
}
