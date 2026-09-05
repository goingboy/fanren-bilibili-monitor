"""后台采样线程：周期执行回调，驱动趋势数据离线积累"""
import threading
import time


def start(sample_once, interval, name="sampler"):
    """
    sample_once(): 每个周期执行一次；内部自行容错并记录趋势。
    返回 daemon 线程。
    """
    def _loop():
        while True:
            try:
                sample_once()
            except Exception as e:
                print(f"[{name}] 异常: {e}")
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name=name)
    t.start()
    return t
