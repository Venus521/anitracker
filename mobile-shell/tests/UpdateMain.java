import com.venus.anitracker.UpdateInfo;
import com.venus.anitracker.WebInfo;
import com.venus.anitracker.WebUpdater;

import android.content.Context;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * UpdateInfo（云端 APK 清单）与 WebUpdater/WebInfo（云端内容包）的桌面断言
 * —— 跑的就是手机上那份 .java，没有替身。
 * W 组要真发 HTTP，所以这里起一个本机假发布服，路径规矩和 CloudBase 那个桶一模一样。
 * 输出交给 test-server.py 汇总，所以自己用 UTF-8 往外写：
 * JDK 的 System.out 在被重定向时走本机 ANSI 码页（这台是 GBK），中文名单会变乱码。
 */
public class UpdateMain {

    static final PrintStream OUT =
            new PrintStream(new FileOutputStream(FileDescriptor.out), true,
                    java.nio.charset.StandardCharsets.UTF_8);
    static final List<String> BAD = new ArrayList<String>();
    static final String H = UpdateInfo.HOST;
    static final String GOOD_URL = "https://" + H + "/app/AniTracker.apk";
    static final String SHA = "a3f5b9c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7";

    public static void main(String[] args) {
        String good = manifest(4, "1.3", GOOD_URL, 623456, SHA, "修好了白屏");

        UpdateInfo u = null;
        try {
            u = UpdateInfo.parse(good);
        } catch (Exception e) {
            fail("U01 正常清单能解析", "抛了 " + e);
        }
        if (u != null) {
            check("U01 正常清单能解析", u.versionCode == 4 && "1.3".equals(u.versionName)
                    && GOOD_URL.equals(u.url) && u.size == 623456 && SHA.equals(u.sha256)
                    && "修好了白屏".equals(u.notes), u == null ? "" : u.versionCode + "/" + u.versionName);
            check("U02 数字写成字符串也认（别让一个引号把更新卡死）",
                    parses(manifest(4, "1.3", GOOD_URL, 623456, SHA, "") .replace("\"versionCode\":4", "\"versionCode\":\"4\"")
                            .replace("\"size\":623456", "\"size\":\"623456\"")));
            check("U03 多出来的字段（比如 ts）不影响解析",
                    parses(good.replace("\"notes\":", "\"ts\":\"2026-09-26T15:00:00\",\"notes\":")));
            check("U04 isNewerThan 卡等号：同版本不算新版",
                    !u.isNewerThan(4) && u.isNewerThan(3) && !u.isNewerThan(5));
            check("U05 describe 给人看的版本号字节数", u.describe().contains("1.3") && u.describe().contains("608 KB"),
                    u.describe());
        }

        check("U06 伪装成同前缀的域名拒绝", !UpdateInfo.isSafeDownload(
                "https://evil-" + H + "/app/a.apk"));
        check("U07 user@host 花招拒绝（真正危险的是 @ 后面那个）", !UpdateInfo.isSafeDownload(
                "https://" + H + "@evil.com/app/a.apk"));
        check("U08 明文 http 一律拒绝", !UpdateInfo.isSafeDownload(
                "http://" + H + "/app/a.apk"));
        check("U09 不落在 /app/ 下的拒绝", !UpdateInfo.isSafeDownload(
                "https://" + H + "/other/a.apk"));
        check("U10 非 .apk 后缀拒绝", !UpdateInfo.isSafeDownload(
                "https://" + H + "/app/a.exe"));
        check("U11 路径穿越拒绝", !UpdateInfo.isSafeDownload(
                "https://" + H + "/app/../../evil.apk"));
        check("U12 带 query/锚点的正规地址放行（CDN 常加参数）",
                UpdateInfo.isSafeDownload(GOOD_URL + "?v=4") && UpdateInfo.isSafeDownload(GOOD_URL + "#x"));
        check("U13 显式写 :443 也放行", UpdateInfo.isSafeDownload("https://" + H + ":443/app/a.apk"));

        check("U14 缺 versionCode 拒绝", rejects(manifest(0, "1.3", GOOD_URL, 623456, SHA, "")));
        check("U15 versionCode 是负数拒绝", rejectsRaw("{\"versionCode\":-4,\"versionName\":\"1.3\",\"url\":\""
                + GOOD_URL + "\",\"size\":623456,\"sha256\":\"" + SHA + "\"}"));
        check("U16 缺 sha256 / 长度不对 / 含非十六进制都拒绝",
                rejects(manifest(4, "1.3", GOOD_URL, 623456, "", ""))
                        && rejects(manifest(4, "1.3", GOOD_URL, 623456, SHA.substring(1), ""))
                        && rejects(manifest(4, "1.3", GOOD_URL, 623456, SHA.substring(0, 63) + "g", "")));
        check("U17 大写十六进制的 sha 归一化后收下",
                parses(manifest(4, "1.3", GOOD_URL, 623456, SHA.toUpperCase(), "")));
        check("U18 缺 versionName 或 size 非法拒绝",
                rejects(manifest(4, "", GOOD_URL, 623456, SHA, ""))
                        && rejects(manifest(4, "1.3", GOOD_URL, 0, SHA, "")));
        check("U19 下载地址不合法时整张清单作废（不是只 warn）", rejects(
                manifest(4, "1.3", "https://evil.com/app/a.apk", 623456, SHA, "")));

        check("U20 尾逗号 / 缺逗号 / 截断 / 嵌套对象一律拒绝",
                rejectsRaw(good.substring(0, good.length() - 1) + ",}")
                        && rejectsRaw("{\"a\":1 \"b\":2}")
                        && rejectsRaw("{\"a\":1")
                        && rejectsRaw("{\"a\":{\"b\":1}}")
                        && rejectsRaw("[1,2]")
                        && rejectsRaw("")
                        && rejectsRaw("<!DOCTYPE html>"));
        check("U21 转义与 \\u 中文正确还原", escapes());
        check("U22 发布清单地址本身锁在 https 的 /app/version.json",
                UpdateInfo.MANIFEST.equals("https://" + H + "/app/version.json"));

        webCases();

        OUT.println("RESULT " + BAD.size() + (BAD.isEmpty() ? "" : " | " + join(BAD)));
        OUT.flush();
        System.exit(BAD.isEmpty() ? 0 : 1);
    }

    /* ---------- 内容包：清单解析、下载白名单、整包落盘与清扫 ---------- */

    static final Map<String, byte[]> SERVED = new HashMap<String, byte[]>();
    static File webRoot;

    static void webCases() {
        String prod = WebInfo.BASE;
        // W01~W07 都在**生产前缀**上判地址，这样测的正是手机上那道闸，而不是被测试改松过的闸
        String P = prod;
        check("W01 正常内容清单能解析（三字段一条不漏）", w01(P));
        check("W02 校验前缀位数不对 / 非十六进制拒绝",
                wRejections(P) && !wParses(pw(P, 7, P + "7/a.js|" + "abc12" + "|10", "")));
        check("W03 地址不落在 /app/web/ 下的拒绝", !wParses(pw(P, 7,
                "https://" + UpdateInfo.HOST + "/other/7/a.js|00000000|10", "")));
        check("W04 地址跨到别的 code 目录拒绝（清单不能顺手指向旧内容）", !wParses(pw(P, 7,
                P + "6/a.js|00000000|10", "")));
        check("W05 穿越/怪字符地址一律拒绝（.. 与反斜杠都拦）",
                !wParses(pw(P, 7, P + "7/../../etc/passwd|00000000|10", ""))
                        && !wParses(pw(P, 7, P + "7/a.js|00000000|10", "").replace("7/a.js", "7\\a.js"))
                        && !wParses(pw(P, 7, P + "7/a.js|00000000|10 空格", "")));
        check("W05b 重复条目 / 尾随分号拒绝（清单歪了必须报错，不能静默跳过）",
                !wParses(pw(P, 7, P + "7/a.js|00000000|10;" + P + "7/a.js|00000000|10", ""))
                        && !wParses(pw(P, 7, P + "7/a.js|00000000|10;", "")));
        check("W06 code 缺失 / 非整数 / files 空 都拒绝",
                !wParses("{\"notes\":\"x\",\"files\":\"\"}".replace("{\"notes\"", "{\"code\":7,\"notes\""))
                        && !wParses(pw(P, 0, P + "7/a.js|00000000|10", ""))
                        && !wParses("{\"code\":\"x\",\"files\":\"\"}")
                        && !wParses("{\"code\":7}"));
        check("W07 生产前缀不收本机地址（测试改前缀才收，两条都得证明）",
                !wParses(pw(P, 7, "http://127.0.0.1:8/app/web/7/a.js|00000000|10", "")));

        // 到这里才把前缀指到本机假服务器，跑真正的下载→校验→换目录
        try {
            com.sun.net.httpserver.HttpServer srv =
                    com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 8);
            srv.createContext("/", ex -> {
                try {
                    byte[] b = SERVED.get(ex.getRequestURI().getPath());
                    if (b == null) {
                        ex.sendResponseHeaders(404, -1);
                    } else {
                        ex.sendResponseHeaders(200, b.length);
                        ex.getResponseBody().write(b);
                    }
                    ex.close();
                } catch (Exception e) {
                    ex.close();
                }
            });
            srv.start();
            String base = "http://127.0.0.1:" + srv.getAddress().getPort() + "/app/web/";
            WebInfo.BASE = base;
            webRoot = Files.createTempDirectory("at-web-content").toFile();
            File content = new File(webRoot, "content");
            try {
                wPipeline(base, content);
            } finally {
                srv.stop(0);
                WebInfo.BASE = prod;
                delete(webRoot);
            }
        } catch (Exception e) {
            fail("W08~W12 假发布服起不来", String.valueOf(e));
        }
    }

    static void wPipeline(String base, File content) throws Exception {
        put(base, 8, "index.html", "<html>AT_VERSION 新内容</html>");
        put(base, 8, "vendor/cloudbase.full.js", "SDK-BYTES");
        put(base, 8, "tracker-version.json", "{\"version\":\"2.14.0\"}");
        WebInfo ok = WebInfo.parse(webManifest(8, base, "index.html", "vendor/cloudbase.full.js",
                "tracker-version.json"));
        File dir = WebUpdater.install(ok, content);
        check("W08 整包下得来：按 code 建目录、子目录照建、字节一字不差",
                dir.getName().equals("8")
                        && read(dir, "index.html").contains("新内容")
                        && read(dir, "vendor/cloudbase.full.js").equals("SDK-BYTES"), dir.getPath());

        put(base, 9, "tracker-version.json", "{\"version\":\"2.14.0\"}");
        WebInfo noIndex = WebInfo.parse(webManifest(9, base, "tracker-version.json"));
        check("W09 缺 index.html 的内容包一律不收（宁可留在旧版）",
                fails(noIndex) && !new File(content, "9").exists());

        put(base, 10, "index.html", "<html>x</html>");
        String badSha = webManifest(10, base, "index.html").replace(
                sha8(SERVED.get(key(base + "10/index.html"))), "00000000");
        File before = new File(content, "8");
        check("W10 校验不上的包整包作废：不留目录、不覆盖在用的那份",
                fails(WebInfo.parse(badSha)) && !new File(content, "10").exists()
                        && before.isDirectory() && staged(content).isEmpty(), staged(content).toString());

        WebInfo miss = WebInfo.parse("{\"code\":11,\"files\":\"" + base + "11/nope.js|00000000|12\"}");
        check("W11 云端少给一个文件 → 整包失败，暂存清干净（半套绝不上线）",
                fails(miss) && !new File(content, "11").exists() && staged(content).isEmpty(),
                staged(content).toString());

        File stale = new File(content, "3");
        Files.createDirectories(stale.toPath());
        Files.createFile(new File(stale, "index.html").toPath());
        WebUpdater.prune(content, dir);
        check("W12 换版后清扫：只留在用的那份，旧 code 与半截暂存一律删掉",
                !stale.exists() && dir.isDirectory(), java.util.Arrays.toString(content.list()));

        WebUpdater.resetForTest();
        Context ctx = new Context(webRoot.getPath() + "/no-assets", webRoot.getPath());
        ctx.getSharedPreferences("shell", 0).edit().putInt("web_code", 8).putInt("web_apk", 5).apply();
        check("W13 热更指针要有 APK 代次配对：换代前那份指针不作数（退回内置）",
                WebUpdater.currentRoot(ctx) == null);
        ctx.setVersionCode(5);
        // W13 那一眼已经把指针清掉了（换代就得清），所以要重新写一遍才能验「对上时认哪份」
        ctx.getSharedPreferences("shell", 0).edit().putInt("web_code", 8).putInt("web_apk", 5).apply();
        WebUpdater.resetForTest();
        File hit = WebUpdater.currentRoot(ctx);
        check("W14 代次对上时认的就是内容包里那份目录（下次开 App 走它）",
                hit != null && hit.getName().equals("8"), hit == null ? "null" : hit.getName());
        ctx.getSharedPreferences("shell", 0).edit().putInt("web_code", 999).apply();
        WebUpdater.resetForTest();
        check("W15 指针指向已不存在的 code → 退回 APK 内置那份，不是白屏",
                WebUpdater.currentRoot(ctx) == null);
        // 指针还是当年下载那代（5）写的，人现在装上了新 App（6）—— 这时候必须回到内置那份新的
        ctx.getSharedPreferences("shell", 0).edit().putInt("web_code", 8).putInt("web_apk", 5).apply();
        ctx.setVersionCode(6);
        WebUpdater.resetForTest();
        check("W16 装了新版 App 就必须回到内置那份新内容（旧热更不能盖着它）",
                WebUpdater.currentRoot(ctx) == null
                        && ctx.getSharedPreferences("shell", 0).getInt("web_code", -1) == -1);
    }

    /** 解析+大小写归一+总量+新旧判定；字段错一个就别想通过。 */
    static boolean w01(String p) {
        try {
            WebInfo w = WebInfo.parse(pw(p, 7,
                    p + "7/index.html|0a1b2c3d|120; " + p + "7/vendor/x.js|deadbeef|3400000", "换季数据"));
            return w.code == 7 && w.files.size() == 2 && "换季数据".equals(w.notes)
                    && w.files.get(1)[0].equals("vendor/x.js") && "deadbeef".equals(w.files.get(1)[1])
                    && w.totalBytes() == 3400120 && w.totalKb() == 3320
                    && w.isNewerThan(6) && !w.isNewerThan(7);
        } catch (Exception e) {
            return false;
        }
    }

    static boolean wRejections(String p) {
        return !wParses(pw(p, 7, p + "7/a.js|000000|10", ""))          // 校验只有 6 位
                && !wParses(pw(p, 7, p + "7/a.js|0000000z|10", ""))    // 非十六进制
                && !wParses(pw(p, 7, p + "7/a.js|00000000|0", ""))     // 零字节
                && !wParses(pw(p, 7, p + "7/a.js|00000000", ""))       // 缺第三段
                && !wParses(pw(p, 7, p + "7//a.js|00000000|10", ""));  // 路径开口不对
    }

    static boolean wParses(String text) {
        try {
            WebInfo.parse(text);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static String pw(String p, int code, String files, String notes) {
        return "{\"code\":" + code + ",\"notes\":\"" + notes + "\",\"files\":\"" + files + "\"}";
    }

    /** 真实内容版清单：校验前缀与字节数都是从 SERVED 里那份字节算出来的，不是手填的。 */
    static String webManifest(int code, String base, String... rels) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < rels.length; i++) {
            byte[] raw = SERVED.get(key(base + code + "/" + rels[i]));
            if (b.length() > 0) b.append(';');
            b.append(base).append(code).append('/').append(rels[i]).append('|')
                    .append(sha8(raw)).append('|').append(raw.length);
        }
        return "{\"code\":" + code + ",\"notes\":\"门禁\",\"files\":\"" + b + "\"}";
    }

    static boolean fails(WebInfo info) {
        try {
            WebUpdater.install(info, new File(webRoot, "content"));
            return false;
        } catch (Exception e) {
            return true;
        }
    }

    /** 本机假服按路径发货，SERVED 也一律以路径为键（同一条 URL 别存成两种键）。 */
    static String key(String url) {
        int i = url.indexOf("//");
        if (i < 0) return url;
        int p = url.indexOf('/', i + 2);
        return p < 0 ? url : url.substring(p);
    }

    static void put(String base, int code, String rel, String text) {
        SERVED.put(key(base + code + "/" + rel), text.getBytes(StandardCharsets.UTF_8));
    }

    static String sha8(byte[] raw) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(raw);
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 4; i++) s.append(String.format("%02x", d[i]));
            return s.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    static String read(File dir, String rel) throws Exception {
        return new String(Files.readAllBytes(new File(dir, rel).toPath()), StandardCharsets.UTF_8);
    }

    static List<String> staged(File content) {
        List<String> out = new ArrayList<String>();
        File[] kids = content.listFiles();
        if (kids != null) {
            for (int i = 0; i < kids.length; i++) {
                if (kids[i].getName().startsWith("stage-")) out.add(kids[i].getName());
            }
        }
        return out;
    }

    static void delete(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) {
                for (int i = 0; i < kids.length; i++) delete(kids[i]);
            }
        }
        f.delete();
    }

    static boolean escapes() {
        String m = "{\"versionCode\":5,\"versionName\":\"1.4\",\"url\":\"" + GOOD_URL
                + "\",\"size\":100,\"sha256\":\"" + SHA + "\",\"notes\":\"第一行\\n\\u201c引号\\u201d\\\\ 反斜杠\"}";
        try {
            UpdateInfo u = UpdateInfo.parse(m);
            return u.notes.equals("第一行\n\u201c引号\u201d\\ 反斜杠");
        } catch (Exception e) {
            return false;
        }
    }

    static String manifest(int code, String name, String url, long size, String sha, String notes) {
        return "{\"versionCode\":" + code + ",\"versionName\":\"" + name + "\",\"url\":\"" + url
                + "\",\"size\":" + size + ",\"sha256\":\"" + sha + "\",\"notes\":\"" + notes + "\"}";
    }

    static boolean parses(String text) {
        try {
            UpdateInfo.parse(text);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 按字段造出来的坏清单走这条，顺带证明 parse 真的是 parse。 */
    static boolean rejects(String text) {
        return !parses(text);
    }

    static boolean rejectsRaw(String text) {
        return !parses(text);
    }

    static void check(String name, boolean ok, String extra) {
        if (ok) {
            OUT.println("CASE OK " + name);
        } else {
            OUT.println("CASE FAIL " + name + (extra.length() == 0 ? "" : " [" + extra + "]"));
            BAD.add(name);
        }
        OUT.flush();
    }

    static void check(String name, boolean ok) {
        check(name, ok, "");
    }

    static void fail(String name, String extra) {
        check(name, false, extra);
    }

    static String join(List<String> xs) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < xs.size(); i++) {
            if (i > 0) b.append(" / ");
            b.append(xs.get(i));
        }
        return b.toString();
    }
}
