"""
凡人修仙传 B站实时数据监控 - Flask 后端（薄路由层）
数据层见 cache_store / bilibili_api / img_cache / sampler
"""
import threading

from flask import Flask, Response, jsonify, render_template, request

import img_cache
import sampler
from bilibili_api import FANREN_SEASONS, api
from cache_store import CacheStore
from config import (BATCH_AID_LIMIT, BATCH_WORKERS, DEBUG, EPISODES_TTL,
                    HOST, OVERVIEW_TTL, PORT, REALTIME_TTL,
                    SAMPLER_INTERVAL, STATIC_MAX_AGE)

store = CacheStore()

_save_lock = threading.Lock()
_save_timer = None


def _schedule_save():
    """2 秒防抖落盘，避免高频写盘"""
    global _save_timer
    with _save_lock:
        if _save_timer is None:
            _save_timer = threading.Timer(2.0, _do_save)
            _save_timer.daemon = True
            _save_timer.start()


def _do_save():
    global _save_timer
    try:
        store.save()
    finally:
        with _save_lock:
            _save_timer = None


def ensure_episodes():
    eps, hit = store.get("episodes")
    if hit:
        return eps
    eps = api.get_all_episodes()
    if eps:
        store.set("episodes", eps, EPISODES_TTL)
    return eps


def _parse_online_total(raw):
    """上游返回 int 或 '1000+' 形式截断字符串，解析为 (数值, 显示文本)"""
    s = str(raw)
    digits = "".join(ch for ch in s if ch.isdigit())
    n = int(digits) if digits else 0
    return n, (s if s.endswith("+") else str(n))


def create_app():
    app = Flask(__name__)
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = STATIC_MAX_AGE

    @app.template_global()
    def static_v(filename):
        """静态文件 URL 带 mtime 版本号，文件变更自动破缓存"""
        import os
        from flask import url_for
        path = os.path.join(app.static_folder, filename)
        try:
            v = int(os.path.getmtime(path))
        except OSError:
            v = 0
        return url_for("static", filename=filename, v=v)

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
        eps = ensure_episodes()
        if not eps:
            return jsonify({"code": -1, "message": "上游接口不可用，请稍后重试"})
        return jsonify({"code": 0, "data": eps})

    @app.route("/api/realtime")
    def get_realtime():
        aid = request.args.get("aid", type=int)
        cid = request.args.get("cid", type=int)
        if not aid or not cid:
            return jsonify({"code": -1, "message": "缺少 aid 或 cid 参数"})
        key = f"rt:{aid}"
        cached, hit = store.get(key)
        if hit:
            c = cached if isinstance(cached, dict) else {"count": cached, "display": str(cached)}
            return jsonify({"code": 0, "data": {"aid": aid, "cid": cid,
                                                "count": c["count"], "display": c["display"]}})
        result = api.get_realtime_online(aid, cid)
        if result.get("code") != 0:
            return jsonify({"code": -1,
                            "message": result.get("message", "获取失败")})
        raw = result.get("data", {}).get("total", 0)
        count, display = _parse_online_total(raw)
        store.set(key, {"count": count, "display": display}, REALTIME_TTL)
        store.append_trend(aid, count)
        _schedule_save()
        return jsonify({"code": 0, "data": {"aid": aid, "cid": cid,
                                            "count": count, "display": display}})

    @app.route("/api/overview")
    def get_overview():
        cached, hit = store.get("overview")
        if hit:
            return jsonify({"code": 0, "data": cached})
        overview = api.get_overview()
        if not overview:
            return jsonify({"code": -1, "message": "上游接口不可用，请稍后重试"})
        store.set("overview", overview, OVERVIEW_TTL)
        return jsonify({"code": 0, "data": overview})

    @app.route("/api/trend")
    def get_trend():
        aid = request.args.get("aid", "")
        return jsonify({"code": 0, "data": store.get_trend(aid)})

    @app.route("/api/episode_stat")
    def get_episode_stat_route():
        aid = request.args.get("aid", type=int)
        if not aid:
            return jsonify({"code": -1, "message": "缺少 aid 参数"})
        stat, hit = store.get_stat(aid)
        if hit:
            if stat:
                return jsonify({"code": 0, "data": stat})
            return jsonify({"code": -1, "message": "上游暂时无数据，稍后自动重试"})
        stat = api.get_episode_stat(aid)
        store.set_stat(aid, stat)
        _schedule_save()
        if not stat:
            return jsonify({"code": -1, "message": "获取统计失败，稍后自动重试"})
        return jsonify({"code": 0, "data": stat})

    @app.route("/api/episode_stats_batch")
    def get_episode_stats_batch():
        aids_raw = request.args.get("aids", "")
        try:
            aid_list = [int(x) for x in aids_raw.split(",") if x.strip()]
        except ValueError:
            return jsonify({"code": -1, "message": "aids 参数格式错误"})
        if not aid_list:
            return jsonify({"code": -1, "message": "缺少 aids 参数"})
        aid_list = aid_list[:BATCH_AID_LIMIT]

        results = {}
        to_fetch = []
        for aid in aid_list:
            s, hit = store.get_stat(aid)
            if hit:
                results[str(aid)] = s
            else:
                to_fetch.append(aid)

        if to_fetch:
            fetched = api.get_episode_stats_concurrent(
                to_fetch, workers=BATCH_WORKERS)
            for aid_s, stat in fetched.items():
                store.set_stat(int(aid_s), stat or {})
                results[aid_s] = stat
            _schedule_save()

        return jsonify({"code": 0, "data": results})

    @app.route("/img_proxy")
    def img_proxy():
        url = request.args.get("url", "")
        if not url or "hdslb.com" not in url:
            return Response("Invalid URL", status=400)
        result = img_cache.fetch_cached(url)
        if not result:
            return Response("Proxy error", status=502)
        content, mime = result
        return Response(content, content_type=mime,
                        headers={"Cache-Control": "public, max-age=604800"})

    return app


def main():
    store.load()
    app = create_app()

    def _sample_latest():
        eps = ensure_episodes()
        if not eps:
            return
        latest = max(eps, key=lambda e: e.get("pub_time") or 0)
        res = api.get_realtime_online(latest["aid"], latest["cid"])
        if res.get("code") != 0:
            return
        raw = res.get("data", {}).get("total", 0)
        count, _ = _parse_online_total(raw)
        store.append_trend(latest["aid"], count)

    sampler.start(_sample_latest, SAMPLER_INTERVAL, name="实时采样")

    print("=" * 50)
    print(f"  凡人修仙传 · B站实时数据监控")
    print(f"  访问 http://localhost:{PORT}")
    print("=" * 50)
    app.run(host=HOST, port=PORT, debug=DEBUG, threaded=True)


if __name__ == "__main__":
    main()
