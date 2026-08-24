"""
凡人修仙传 B站实时数据监控 - Flask 后端
"""
import json
import os
import time
import threading
from flask import Flask, render_template, jsonify, request, Response
from flask_cors import CORS
from bilibili_api import api, FANREN_SEASONS
import requests as req

app = Flask(__name__)
CORS(app)

# 数据缓存
_cache = {
    "episodes": None,
    "episodes_time": 0,
    "overview": None,
    "overview_time": 0,
    "realtime": {},       # {aid: {"count": N, "time": T}}
    "trend": {},          # {aid: [{"count": N, "time": T}, ...]}
    "ep_stat": {},        # {aid: {stat_dict}}
    "ep_stat_time": {},   # {aid: timestamp}
}

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")
TREND_FILE = os.path.join(CACHE_DIR, "trend.json")
HISTORY_TREND_MAX = 200

def load_trend_data():
    if os.path.exists(TREND_FILE):
        try:
            with open(TREND_FILE, "r", encoding="utf-8") as f:
                _cache["trend"] = json.load(f)
        except Exception:
            _cache["trend"] = {}

def save_trend_data():
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(TREND_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache["trend"], f, ensure_ascii=False)
    except Exception as e:
        print(f"[存储] 保存趋势数据失败: {e}")

load_trend_data()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/wiki")
def wiki():
    return render_template("wiki.html")


@app.route("/api/seasons")
def get_seasons():
    return jsonify({"code": 0, "data": FANREN_SEASONS})


@app.route("/api/episodes")
def get_episodes():
    """获取所有集信息（缓存 5 分钟）"""
    now = time.time()
    if _cache["episodes"] and now - _cache["episodes_time"] < 300:
        return jsonify({"code": 0, "data": _cache["episodes"]})

    episodes = api.get_all_episodes()
    _cache["episodes"] = episodes
    _cache["episodes_time"] = now
    return jsonify({"code": 0, "data": episodes})


@app.route("/api/realtime")
def get_realtime():
    """获取指定集的实时观看人数"""
    aid = request.args.get("aid", type=int)
    cid = request.args.get("cid", type=int)
    if not aid or not cid:
        return jsonify({"code": -1, "message": "缺少 aid 或 cid 参数"})

    cache_key = str(aid)
    now = time.time()
    if cache_key in _cache["realtime"] and now - _cache["realtime"][cache_key]["time"] < 20:
        count = _cache["realtime"][cache_key]["count"]
    else:
        result = api.get_realtime_online(aid, cid)
        if result.get("code") != 0:
            return jsonify({"code": -1, "message": result.get("message", "获取失败")})
        data = result.get("data", {})
        count = int(data.get("total", 0))
        _cache["realtime"][cache_key] = {"count": count, "time": now}

        if cache_key not in _cache["trend"]:
            _cache["trend"][cache_key] = []
        trend_list = _cache["trend"][cache_key]
        trend_list.append({"count": count, "time": int(now)})
        if len(trend_list) > HISTORY_TREND_MAX:
            trend_list.pop(0)
        threading.Thread(target=save_trend_data, daemon=True).start()

    return jsonify({"code": 0, "data": {"aid": aid, "cid": cid, "count": count}})


@app.route("/api/overview")
def get_overview():
    """获取总览数据（缓存 5 分钟）"""
    now = time.time()
    if _cache["overview"] and now - _cache["overview_time"] < 300:
        return jsonify({"code": 0, "data": _cache["overview"]})

    overview = api.get_overview()
    _cache["overview"] = overview
    _cache["overview_time"] = now
    return jsonify({"code": 0, "data": overview})


@app.route("/api/trend")
def get_trend():
    aid = request.args.get("aid", "")
    trend_data = _cache["trend"].get(aid, [])
    return jsonify({"code": 0, "data": trend_data})


@app.route("/api/episode_stat")
def get_episode_stat():
    """获取单集详细统计（缓存 10 分钟）"""
    aid = request.args.get("aid", type=int)
    if not aid:
        return jsonify({"code": -1, "message": "缺少 aid 参数"})

    now = time.time()
    cache_key = str(aid)
    if cache_key in _cache["ep_stat"] and now - _cache["ep_stat_time"].get(cache_key, 0) < 600:
        return jsonify({"code": 0, "data": _cache["ep_stat"][cache_key]})

    stat = api.get_episode_stat(aid)
    _cache["ep_stat"][cache_key] = stat
    _cache["ep_stat_time"][cache_key] = now
    return jsonify({"code": 0, "data": stat})


@app.route("/api/episode_stats_batch")
def get_episode_stats_batch():
    """批量获取多集统计（缓存 10 分钟，带重试）"""
    aids = request.args.get("aids", "")
    if not aids:
        return jsonify({"code": -1, "message": "缺少 aids 参数"})

    aid_list = [int(x) for x in aids.split(",") if x.strip()]
    now = time.time()
    results = {}
    to_fetch = []

    for aid in aid_list:
        cache_key = str(aid)
        if cache_key in _cache["ep_stat"] and now - _cache["ep_stat_time"].get(cache_key, 0) < 600:
            results[aid] = _cache["ep_stat"][cache_key]
        else:
            to_fetch.append(aid)

    # 带重试的逐个获取
    for aid in to_fetch:
        for attempt in range(2):
            stat = api.get_episode_stat(aid)
            if stat and stat.get("view") is not None:
                break
            time.sleep(0.1)
        _cache["ep_stat"][str(aid)] = stat
        _cache["ep_stat_time"][str(aid)] = now
        results[aid] = stat

    return jsonify({"code": 0, "data": results})


# ===== 图片代理（解决 B站防盗链） =====
@app.route("/img_proxy")
def img_proxy():
    """代理 B站图片，解决浏览器防盗链问题"""
    url = request.args.get("url", "")
    if not url or "hdslb.com" not in url:
        return Response("Invalid URL", status=400)

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.bilibili.com",
        }
        resp = req.get(url, headers=headers, timeout=10, stream=True)
        return Response(
            resp.content,
            content_type=resp.headers.get("Content-Type", "image/jpeg"),
            headers={"Cache-Control": "public, max-age=86400"}
        )
    except Exception as e:
        print(f"[IMG_PROXY] 代理失败: {e}")
        return Response("Proxy error", status=502)


if __name__ == "__main__":
    print("=" * 50)
    print("  凡人修仙传 · B站实时数据监控")
    print("  访问 http://localhost:5000")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=True)
