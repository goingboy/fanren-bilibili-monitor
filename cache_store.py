"""线程安全内存缓存 + 磁盘持久化（趋势与单集统计）"""
import json
import os
import threading
import time

from config import DATA_DIR, STAT_FAIL_TTL, STAT_OK_TTL, TREND_MAX


class CacheStore:
    def __init__(self, data_dir=DATA_DIR):
        self._dir = data_dir
        self._lock = threading.Lock()
        self._kv = {}     # key -> {"v": val, "t": 过期时间戳}
        self._stat = {}   # aid(str) -> {"v": stat|None, "t": 过期时间戳}
        self._trend = {}  # aid(str) -> [{"count","time"}]

    # ---- 通用 KV ----
    def get(self, key):
        with self._lock:
            item = self._kv.get(key)
            if not item or item["t"] < time.time():
                return None, False
            return item["v"], True

    def set(self, key, value, ttl):
        with self._lock:
            self._kv[key] = {"v": value, "t": time.time() + ttl}

    # ---- 单集统计：成功长缓存、失败短缓存且存 None ----
    def get_stat(self, aid):
        with self._lock:
            item = self._stat.get(str(aid))
            if not item or item["t"] < time.time():
                return None, False
            return item["v"], True

    def set_stat(self, aid, stat):
        ok = bool(stat and stat.get("view") is not None)
        ttl = STAT_OK_TTL if ok else STAT_FAIL_TTL
        with self._lock:
            self._stat[str(aid)] = {"v": stat if ok else None,
                                    "t": time.time() + ttl}

    # ---- 趋势 ----
    def append_trend(self, aid, count):
        with self._lock:
            lst = self._trend.setdefault(str(aid), [])
            lst.append({"count": int(count), "time": int(time.time())})
            if len(lst) > TREND_MAX:
                del lst[: len(lst) - TREND_MAX]

    def get_trend(self, aid):
        with self._lock:
            return list(self._trend.get(str(aid), []))

    # ---- 持久化 ----
    def load(self):
        path = os.path.join(self._dir, "store.json")
        legacy = os.path.join(self._dir, "trend.json")
        source = path if os.path.exists(path) else (
            legacy if os.path.exists(legacy) else None)
        if not source:
            return
        try:
            with open(source, "r", encoding="utf-8") as f:
                raw = json.load(f)
            trend = raw.get("trend", raw if source == legacy else {})
            stats = raw.get("stats", {}) if source == path else {}
            now = time.time()
            with self._lock:
                for k, v in trend.items():
                    if isinstance(v, list):
                        self._trend[str(k)] = [p for p in v
                                               if isinstance(p, dict)][-TREND_MAX:]
                for k, item in stats.items():
                    if (isinstance(item, dict) and item.get("t", 0) > now):
                        self._stat[str(k)] = item
            print(f"[存储] 已载入 {source}：趋势 {len(self._trend)} 组")
        except Exception as e:
            print(f"[存储] 载入失败: {e}")

    def save(self):
        with self._lock:
            snapshot = {
                "trend": self._trend,
                "stats": {k: v for k, v in self._stat.items()
                          if v.get("t", 0) > time.time()},
            }
        try:
            os.makedirs(self._dir, exist_ok=True)
            tmp = os.path.join(self._dir, "store.json.tmp")
            final = os.path.join(self._dir, "store.json")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, ensure_ascii=False)
            os.replace(tmp, final)
        except Exception as e:
            print(f"[存储] 保存失败: {e}")
