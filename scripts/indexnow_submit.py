"""IndexNow 提交脚本 —— 让 Bing / Yandex 等搜索引擎即时收录（无需账号）
用法: python indexnow_submit.py
"""
import json, os, sys, urllib.request, urllib.error

BASE = r"D:\code\image-compressor"
KEY_FILE = os.path.join(BASE, ".indexnow-key")
HOST = "haixiansheng.github.io"
SITE = f"https://{HOST}/image-compressor"

URLS = [
    f"{SITE}/",
    f"{SITE}/blog/",
    f"{SITE}/blog/compress-without-quality-loss.html",
    f"{SITE}/blog/image-privacy-upload-risk.html",
    f"{SITE}/about.html",
    f"{SITE}/privacy.html",
    f"{SITE}/en/",
    f"{SITE}/en/blog/",
    f"{SITE}/en/blog/compress-without-quality-loss.html",
    f"{SITE}/en/blog/image-privacy-upload-risk.html",
    f"{SITE}/en/about.html",
    f"{SITE}/en/privacy.html",
]

ENDPOINTS = [
    "https://api.indexnow.org/indexnow",
    "https://www.bing.com/indexnow",
    "https://yandex.com/indexnow",
]


def main():
    if not os.path.exists(KEY_FILE):
        print("✗ 找不到 .indexnow-key")
        return 1
    key = open(KEY_FILE, encoding="utf-8").read().strip()
    key_location = f"{SITE}/{key}.txt"

    print(f"→ 校验 key 文件: {key_location}")
    try:
        with urllib.request.urlopen(key_location, timeout=20) as r:
            body = r.read().decode("utf-8", "ignore").strip()
        if body != key:
            print(f"  ✗ 内容不符（期望 {key}，实际 {body[:40]}）")
            return 1
        print(f"  HTTP {r.status} | 内容匹配 ✅")
    except Exception as e:
        print(f"  ✗ 无法访问: {e}（请先部署 key 文件）")
        return 1

    data = json.dumps({
        "host": HOST, "key": key,
        "keyLocation": key_location, "urlList": URLS,
    }).encode("utf-8")

    print(f"\n→ 提交 {len(URLS)} 个 URL")
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(
                ep, data=data, method="POST",
                headers={"Content-Type": "application/json; charset=utf-8"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                status = r.status
            print(f"  {'✅' if status in (200, 202) else '⚠'} {ep} → HTTP {status}")
        except urllib.error.HTTPError as e:
            print(f"  ⚠ {ep} → HTTP {e.code} {e.reason}")
        except Exception as e:
            print(f"  ✗ {ep} → {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
