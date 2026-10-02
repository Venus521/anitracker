package android.content.res;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;

/** 桌面测试替身：把 assets 目录当 APK 里的 assets/ 读。 */
public class AssetManager {
    private final File root;

    public AssetManager(String root) {
        this.root = new File(root);
    }

    public InputStream open(String path) throws FileNotFoundException {
        File f = new File(root, path);
        if (!f.isFile()) throw new FileNotFoundException(path);
        try {
            return new FileInputStream(f);
        } catch (FileNotFoundException e) {
            throw e;
        }
    }
}
