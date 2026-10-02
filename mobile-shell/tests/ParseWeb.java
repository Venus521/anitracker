import com.venus.anitracker.WebInfo;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * 用手机上那份 WebInfo 读一遍本地内容清单 —— 发布前撞一次。
 * 和 ParseFile 同一个道理：清单歪了（少个校验前缀、地址跨到别的 code 目录）
 * 只让发布这一步失败，别留给手机上点「检查内容更新」的人去发现。
 */
public class ParseWeb {

    public static void main(String[] args) {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true,
                StandardCharsets.UTF_8);
        try {
            byte[] raw = read(new File(args[0]));
            WebInfo w = WebInfo.parse(new String(raw, "UTF-8"));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < w.files.size(); i++) {
                if (i > 0) b.append(' ');
                b.append(w.files.get(i)[0]).append(':').append(w.files.get(i)[2]);
            }
            out.println("PARSE OK " + w.code + " files=" + w.files.size()
                    + " total=" + w.totalKb() + "KB [" + b + "]");
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
