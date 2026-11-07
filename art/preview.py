#!/home/prometheus/work/venv-bench/bin/python
"""preview.png for the bazaar: real SiYuan (kernel on :6806 with the plugin), real messages pushed through
SiYuan's /api/notification endpoints, history window open. Usage: preview.py OUT.png [zh]"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright
L = os.path.expanduser("~/.local/chromelibs/usr/lib/aarch64-linux-gnu") + ":" + os.path.expanduser("~/.local/fxlibs/usr/lib/aarch64-linux-gnu")
def api(path, body):
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:6806" + path, data=json.dumps(body).encode(), method="POST"), timeout=10)
MSGS = [("pushMsg", "Exported 12 documents to Markdown"), ("pushMsg", "Data snapshot created"),
        ("pushErrMsg", "Sync failed: the cloud storage is full"), ("pushMsg", "Image compressed: 2.4 MB → 380 KB"),
        ("pushMsg", "Indexed references of 248 documents"), ("pushMsg", "Indexed references of 248 documents"),
        ("pushMsg", "Daily note created: 2026-11-07")]
with sync_playwright() as p:
    b = p.chromium.launch(env=dict(os.environ, LD_LIBRARY_PATH=L))
    pg = b.new_page(viewport={"width": 1024, "height": 768}, device_scale_factor=1)
    pg.goto("http://127.0.0.1:6806"); pg.wait_for_selector(".nh-status", timeout=30000); pg.wait_for_timeout(1500)
    pg.evaluate("document.querySelectorAll('.b3-dialog--open .b3-dialog__close, #message .b3-snackbar__close').forEach(e=>e.click())")
    pg.evaluate("""() => { for (const el of document.querySelectorAll('body *')) { if (el.children.length < 8 && /Welcome to SiYuan/.test(el.textContent || '')) { const x = el.querySelector('svg, .b3-tooltips, [class*=close]'); } }
        document.querySelectorAll('svg').forEach(s => { const r = s.getBoundingClientRect(); if (Math.abs(r.x + r.width/2 - 1194) < 12 && Math.abs(r.y + r.height/2 - 593) < 12) s.dispatchEvent(new MouseEvent('click', {bubbles: true})); }); }""")
    pg.mouse.click(975, 500) if pg.locator("text=Welcome to SiYuan").count() and pg.locator("text=Welcome to SiYuan").is_visible() else None
    pg.wait_for_timeout(500)
    pg.click(".nh-status"); pg.wait_for_selector(".nh-dialog"); pg.click('[data-action="clear"]'); pg.keyboard.press("Escape")
    for kind, m in MSGS:
        api(f"/api/notification/{kind}", {"msg": m, "timeout": 2500}); time.sleep(0.6)
    pg.wait_for_timeout(3500)
    pg.click(".nh-status"); pg.wait_for_selector(".nh-row"); pg.wait_for_timeout(1200)
    pg.mouse.move(5, 400)
    pg.screenshot(path=sys.argv[1]); b.close()
