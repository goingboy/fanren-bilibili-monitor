"""
哔哩哔哩 API 封装模块
实现 WBI 签名、番剧信息获取、实时观看人数查询
"""
import hashlib
import time
import urllib.parse
from functools import lru_cache
import requests

# WBI 混淆密钥表
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

# 凡人修仙传 season_id = 28747（包含全部 272 集）
FANREN_SEASONS = [
    {"season_id": 28747, "title": "凡人修仙传", "alias": "凡人修仙传"},
]


def get_mixin_key(orig: str) -> str:
    """从 img_key + sub_key 生成 mixin_key"""
    return "".join([orig[i] for i in MIXIN_KEY_ENC_TAB])[:32]


class BilibiliAPI:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self._img_key = ""
        self._sub_key = ""
        self._mixin_key = ""
        self._key_update_time = 0

    def _update_wbi_keys(self):
        """获取并更新 WBI 密钥（每 30 分钟刷新一次）"""
        now = time.time()
        if now - self._key_update_time < 1800 and self._mixin_key:
            return
        try:
            resp = self.session.get(
                "https://api.bilibili.com/x/web-interface/nav",
                timeout=10
            )
            data = resp.json().get("data", {})
            wbi_img = data.get("wbi_img", {})
            img_url = wbi_img.get("img_url", "")
            sub_url = wbi_img.get("sub_url", "")
            self._img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
            self._sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
            self._mixin_key = get_mixin_key(self._img_key + self._sub_key)
            self._key_update_time = now
        except Exception as e:
            print(f"[WBI] 获取密钥失败: {e}")

    def _sign_params(self, params: dict) -> dict:
        """对参数进行 WBI 签名"""
        self._update_wbi_keys()
        wts = str(int(time.time()))
        params["wts"] = wts
        # 按 key 排序
        query = urllib.parse.urlencode(sorted(params.items()))
        w_rid = hashlib.md5((query + self._mixin_key).encode()).hexdigest()
        params["w_rid"] = w_rid
        return params

    def get_season_info(self, season_id: int) -> dict:
        """获取番剧季度信息和集数列表"""
        try:
            resp = self.session.get(
                "https://api.bilibili.com/pgc/view/web/season",
                params={"season_id": season_id},
                timeout=10
            )
            return resp.json()
        except Exception as e:
            print(f"[API] 获取季度信息失败: {e}")
            return {"code": -1, "message": str(e)}

    def get_episode_stat(self, aid: int) -> dict:
        """获取单集详细统计（播放、弹幕、投币等）"""
        try:
            resp = self.session.get(
                "https://api.bilibili.com/x/web-interface/view",
                params={"aid": aid},
                timeout=10
            )
            data = resp.json()
            if data.get("code") == 0:
                return data["data"].get("stat", {})
            return {}
        except Exception as e:
            print(f"[API] 获取集统计失败 aid={aid}: {e}")
            return {}

    def get_realtime_online(self, aid: int, cid: int) -> dict:
        """获取指定视频的实时在线观看人数"""
        try:
            resp = self.session.get(
                "https://api.bilibili.com/x/player/online/total",
                params={"aid": aid, "cid": cid},
                timeout=10
            )
            return resp.json()
        except Exception as e:
            print(f"[API] 获取实时人数失败: {e}")
            return {"code": -1, "message": str(e)}

    def get_all_episodes(self) -> list:
        """获取凡人修仙传所有季的全部集信息"""
        all_episodes = []
        for season in FANREN_SEASONS:
            data = self.get_season_info(season["season_id"])
            if data.get("code") != 0:
                continue
            result = data.get("result", {})
            episodes = result.get("episodes", [])
            for ep in episodes:
                ep["season_title"] = season["title"]
                ep["season_alias"] = season["alias"]
                ep["season_id"] = season["season_id"]
            all_episodes.extend(episodes)
        return all_episodes

    def get_overview(self) -> list:
        """获取总览数据（季节级别的汇总统计）"""
        overview_list = []
        for season in FANREN_SEASONS:
            data = self.get_season_info(season["season_id"])
            if data.get("code") != 0:
                continue
            result = data.get("result", {})
            raw_stat = result.get("stat", {})
            # 将复数字段名映射为前端使用的单数字段名
            normalized_stat = {
                "view": raw_stat.get("views", 0),
                "danmaku": raw_stat.get("danmakus", 0),
                "coin": raw_stat.get("coins", 0),
                "like": raw_stat.get("likes", 0),
                "favorite": raw_stat.get("favorites", 0),
                "reply": raw_stat.get("reply", 0),
                "share": raw_stat.get("share", 0),
            }
            overview_list.append({
                "season_id": season["season_id"],
                "title": season["title"],
                "alias": season["alias"],
                "cover": result.get("cover", ""),
                "total": len(result.get("episodes", [])),
                "new_ep": result.get("new_ep", {}),
                "rating": result.get("rating", {}),
                "stat": normalized_stat,
            })
        return overview_list


# 全局单例
api = BilibiliAPI()
