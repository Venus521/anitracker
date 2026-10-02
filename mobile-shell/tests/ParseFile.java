import com.venus.anitracker.UpdateInfo;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * 用手机上那份 UpdateInfo 读一遍本地清单文件 —— 发布前撞一次，
 * 免得清单写歪了（少个 sha、url 用了 http）只有手机上点「检查更新」的人才发现。
 */
public class ParseFile {

    public static void main(String[] args) {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true,
                StandardCharsets.UTF_8);
        try {
            byte[] raw = read(new File(args[0]));
            UpdateInfo u = UpdateInfo.parse(new String(raw, "UTF-8"));
            out.println("PARSE OK " + u.versionCode + " " + u.describe() + " " + u.url);
        } catch (Exception e) {
            out.println("PARSE FAIL " + e);
            System.exit(1);
        }
    }

    static byte[] read(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toByteArray();
    }
}
