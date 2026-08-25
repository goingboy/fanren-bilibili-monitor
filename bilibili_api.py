"""哔哩哔哩 API 封装：WBI 签名、番剧信息、单集统计、实时人数、并发批量"""
import hashlib
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import requests

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
}

# 凡人修仙传 season_id = 28747
FANREN_SEASONS = [
    {"season_id": 28747, "title": "凡人修仙传", "alias": "凡人修仙传"},
]

# season stat 复数 -> 单数映射；未列出的字段原样透传（如 follow）
_STAT_MAP = {
    "views": "view", "danmakus": "danmaku", "coins": "coin",
    "likes": "like", "favorites": "favorite", "reply": "reply",
    "share": "share",
}


def get_mixin_key(orig: str) -> str:
    return "".join([orig[i] for i in MIXIN_KEY_ENC_TAB])[:32]


class BilibiliAPI:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self._key_lock = threading.Lock()
        self._mixin_key = ""
        self._key_update_time = 0

    # ---- WBI ----
    def _update_wbi_keys(self):
        now = time.time()
        with self._key_lock:
            if self._mixin_key and now - self._key_update_time < 1800:
                return
            try:
                resp = self.session.get(
                    "https://api.bilibili.com/x/web-interface/nav", timeout=10)
                wbi_img = resp.json().get("data", {}).get("wbi_img", {})
                img_url = wbi_img.get("img_url", "")
                sub_url = wbi_img.get("sub_url", "")
                if img_url and sub_url:
                    img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
                    sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
                    self._mixin_key = get_mixin_key(img_key + sub_key)
                    self._key_update_time = now
            except Exception as e:
                print(f"[WBI] 获取密钥失败: {e}")

    def _sign_params(self, params: dict) -> dict:
        self._update_wbi_keys()
        params["wts"] = str(int(time.time()))
        query = urllib.parse.urlencode(sorted(params.items()))
        params["w_rid"] = hashlib.md5(
            (query + self._mixin_key).encode()).hexdigest()
        return params

    # ---- 基础接口 ----
    def _get_json(self, url, params=None):
        try:
            resp = self.session.get(url, params=params, timeout=10)
            return resp.json()
        except Exception as e:
            print(f"[API] {url} 失败: {e}")
            return {"code": -1, "message": str(e)}

    def get_season_info(self, season_id: int) -> dict:
        return self._get_json(
            "https://api.bilibili.com/pgc/view/web/season",
            {"season_id": season_id})

    def get_episode_stat(self, aid: int) -> dict:
        data = self._get_json(
            "https://api.bilibili.com/x/web-interface/view", {"aid": aid})
        if data.get("code") == 0:
            return data.get("data", {}).get("stat", {}) or {}
        return {}

    def get_realtime_online(self, aid: int, cid: int) -> dict:
        return self._get_json(
            "https://api.bilibili.com/x/player/online/total",
            {"aid": aid, "cid": cid})

    @staticmethod
    def _is_preview(ep: dict) -> bool:
        """预告/预览集不算正片（badge_type=1 或文字含'预告'）"""
        if ep.get("badge_type") == 1:
            return True
        text = str(ep.get("badge", "")) + str(ep.get("long_title", "")) + str(ep.get("title", ""))
        return "预告" in text

    def get_all_episodes(self) -> list:
        all_episodes = []
        for season in FANREN_SEASONS:
            data = self.get_season_info(season["season_id"])
            if data.get("code") != 0:
                continue
            result = data.get("result", {})
            for ep in result.get("episodes", []):
                if self._is_preview(ep):
                    continue
                ep["season_title"] = season["title"]
                ep["season_alias"] = season["alias"]
                ep["season_id"] = season["season_id"]
                all_episodes.append(ep)
        return all_episodes

    def get_overview(self) -> list:
        """季节级汇总。stat 做复数->单数归一，未知字段原样保留。"""
        overview_list = []
        for season in FANREN_SEASONS:
            data = self.get_season_info(season["season_id"])
            if data.get("code") != 0:
                continue
            result = data.get("result", {})
            raw_stat = result.get("stat", {})
            normalized_stat = {}
            for src, dst in _STAT_MAP.items():
                if src in raw_stat:
                    normalized_stat[dst] = raw_stat[src]
            for key, val in raw_stat.items():
                if key not in _STAT_MAP and key not in normalized_stat \
                        and not isinstance(val, (dict, list)):
                    normalized_stat[key] = val
            overview_list.append({
                "season_id": season["season_id"],
                "title": season["title"],
                "alias": season["alias"],
                "cover": result.get("cover", ""),
                "total": len([e for e in result.get("episodes", [])
                              if not self._is_preview(e)]),
                "new_ep": result.get("new_ep", {}),
                "rating": result.get("rating", {}),
                "stat": normalized_stat,
            })
        return overview_list

    # ---- 并发批量统计 ----
    def get_episode_stats_concurrent(self, aids, workers=6) -> dict:
        """返回 {str(aid): stat_dict|None}，失败为 None"""
        def _one(aid):
            try:
                return aid, self.get_episode_stat(aid)
            except Exception:
                return aid, {}

        results = {}
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            for aid, stat in ex.map(_one, aids):
                results[str(aid)] = stat or None
        return results


api = BilibiliAPI()
