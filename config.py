"""全局配置（环境变量可覆盖）"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
IMG_CACHE_DIR = os.path.join(DATA_DIR, "img_cache")

HOST = os.environ.get("FM_HOST", "127.0.0.1")
PORT = int(os.environ.get("FM_PORT", "5000"))
DEBUG = os.environ.get("FM_DEBUG", "0") == "1"

EPISODES_TTL = 300       # 集列表缓存（秒）
OVERVIEW_TTL = 300       # 总览缓存（秒）
REALTIME_TTL = 20        # 实时人数缓存（秒）
STAT_OK_TTL = 600        # 统计成功缓存（秒）
STAT_FAIL_TTL = 60       # 统计失败缓存（秒，避免失败结果长期污染）
TREND_MAX = 200          # 每集趋势点上限
SAMPLER_INTERVAL = 60    # 后台采样间隔（秒）
BATCH_WORKERS = 6        # 批量统计并发线程数
BATCH_AID_LIMIT = 400    # 单次批量请求 aid 数上限

IMG_CACHE_MAX_BYTES = 200 * 1024 * 1024   # 图片磁盘缓存上限
IMG_CLEANUP_EVERY = 50                    # 每N次未命中清理一次

STATIC_MAX_AGE = 0 if DEBUG else 86400    # 开发时不缓存静态文件
