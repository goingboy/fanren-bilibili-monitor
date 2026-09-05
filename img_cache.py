"""B站图片代理磁盘缓存：URL md5 为文件名，命中直接回源磁盘"""
import hashlib
import os

import requests

from config import IMG_CACHE_DIR, IMG_CACHE_MAX_BYTES, IMG_CLEANUP_EVERY

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bilibili.com",
}
_EXT_BY_MIME = {
    "image/jpeg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
}
_MIME_BY_EXT = {v: k for k, v in _EXT_BY_MIME.items()}

_miss_count = 0


def _cleanup():
    """按 atime LRU 清理至 80% 容量"""
    try:
        entries = []
        total = 0
        for name in os.listdir(IMG_CACHE_DIR):
            p = os.path.join(IMG_CACHE_DIR, name)
            if os.path.isfile(p):
                st = os.stat(p)
                entries.append((st.st_atime, st.st_size, p))
                total += st.st_size
        if total <= IMG_CACHE_MAX_BYTES:
            return
        entries.sort()
        removed = 0
        target = int(IMG_CACHE_MAX_BYTES * 0.8)
        for _, size, p in entries:
            if total - removed <= target:
                break
            os.remove(p)
            removed += size
    except OSError as e:
        print(f"[图片缓存] 清理失败: {e}")


def fetch_cached(url, timeout=10):
    """返回 (bytes, mime) 或 None。命中磁盘直接返回，未命中下载后原子落盘。"""
    global _miss_count
    os.makedirs(IMG_CACHE_DIR, exist_ok=True)
    digest = hashlib.md5(url.encode("utf-8")).hexdigest()

    for ext in (".jpg", ".png", ".webp", ".gif"):
        path = os.path.join(IMG_CACHE_DIR, digest + ext)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            try:
                os.utime(path, None)
            except OSError:
                pass
            with open(path, "rb") as f:
                return f.read(), _MIME_BY_EXT[ext]

    try:
        resp = requests.get(url, headers=_HEADERS, timeout=timeout)
        resp.raise_for_status()
    except Exception as e:
        print(f"[图片缓存] 下载失败 {url}: {e}")
        return None

    content = resp.content
    mime = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip().lower()
    ext = _EXT_BY_MIME.get(mime, ".jpg")
    path = os.path.join(IMG_CACHE_DIR, digest + ext)
    try:
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(content)
        os.replace(tmp, path)
    except OSError as e:
        print(f"[图片缓存] 写盘失败: {e}")

    _miss_count += 1
    if _miss_count % IMG_CLEANUP_EVERY == 0:
        _cleanup()
    return content, mime if mime.startswith("image/") else "image/jpeg"
