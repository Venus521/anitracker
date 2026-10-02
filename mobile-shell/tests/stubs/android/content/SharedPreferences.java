package android.content;

import java.util.HashMap;
import java.util.Map;

/** 桌面测试替身：内存版偏好，够 WebUpdater 存内容包指针。 */
public class SharedPreferences {
    private final Map<String, Object> vals = new HashMap<String, Object>();

    public String getString(String key, String def) {
        Object v = vals.get(key);
        return v instanceof String ? (String) v : def;
    }

    public int getInt(String key, int def) {
        Object v = vals.get(key);
        return v instanceof Integer ? (Integer) v : def;
    }

    public Editor edit() {
        return new Editor();
    }

    public class Editor {
        public Editor putString(String key, String v) {
            vals.put(key, v);
            return this;
        }

        public Editor putInt(String key, int v) {
            vals.put(key, v);
            return this;
        }

        public Editor remove(String key) {
            vals.remove(key);
            return this;
        }

        public void apply() {
        }
    }
}
