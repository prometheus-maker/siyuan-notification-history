#!/home/prometheus/work/venv-bench/bin/python
"""End-to-end test in real SiYuan (kernel at 127.0.0.1:6806 with this plugin installed and enabled; see
~/prometheus/tools/siyuan/kernel.sh). Messages are pushed through SiYuan's own /api/notification endpoints.
Usage: e2e.py [SHOT_DIR]"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:6806"
LIBS = os.path.expanduser("~/.local/chromelibs/usr/lib/aarch64-linux-gnu") + ":" + os.path.expanduser("~/.local/fxlibs/usr/lib/aarch64-linux-gnu")
shots = sys.argv[1] if len(sys.argv) > 1 else "/tmp/nh"
os.makedirs(shots, exist_ok=True)
results = []

def api(path, body):
    r = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method="POST")
    return json.load(urllib.request.urlopen(r, timeout=10))

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name, detail, flush=True)

def rows(pg):
    return pg.eval_on_selector_all(".nh-row", "rs => rs.map(r => [r.querySelector('.nh-text').textContent, (r.querySelector('.nh-count')||{}).textContent||'', r.classList.contains('nh-row--error')])")

with sync_playwright() as p:
    b = p.chromium.launch(env=dict(os.environ, LD_LIBRARY_PATH=LIBS))
    pg = b.new_page(viewport={"width": 1280, "height": 860})
    pg.set_default_timeout(15000)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector(".nh-status", timeout=30000)
    check("status bell present", pg.locator(".nh-status").count() == 1)
    check("top bar bell present", pg.locator('#toolbar use[*|href="#iconNhBell"], [data-type="plugin"] use[*|href="#iconNhBell"]').count() >= 1 or pg.locator('use[*|href="#iconNhBell"]').count() >= 2)
    # start clean
    pg.evaluate("1")
    tag = str(int(time.time()))
    api("/api/notification/pushMsg", {"msg": f"Export finished {tag}", "timeout": 3000})
    time.sleep(0.5)
    api("/api/notification/pushErrMsg", {"msg": f"Sync failed: network {tag}", "timeout": 3000})
    time.sleep(0.5)
    for _ in range(2):
        api("/api/notification/pushMsg", {"msg": f"Same again {tag}", "timeout": 3000}); time.sleep(0.4)
    time.sleep(1)
    badge = pg.locator(".nh-badge").text_content() if pg.locator(".nh-badge").count() else ""
    check("badge counts every notification shown (4, one repeated)", badge == "4", f"badge={badge!r}")
    pg.wait_for_timeout(4000)  # let them disappear
    check("messages gone from screen", pg.locator(f'#message .b3-snackbar:has-text("{tag}")').count() == 0)
    pg.click(".nh-status"); pg.wait_for_selector(".nh-row")
    pg.screenshot(path=f"{shots}/history.png")
    r = [x for x in rows(pg) if tag in x[0]]
    check("3 rows, newest first", [x[0].split(" " + tag)[0] for x in r] == ["Same again", "Sync failed: network", "Export finished"], str(r))
    check("repeat counted x2", r and r[0][1] == "×2", str(r[:1]))
    check("error row marked", len(r) > 1 and r[1][2] and not r[0][2], str(r))
    check("badge cleared after opening", pg.locator(".nh-badge").count() == 0)
    pg.fill(".nh-search", "sync"); pg.wait_for_timeout(300)
    r2 = [x[0] for x in rows(pg)]
    check("filter", len(r2) >= 1 and all("ync" in x for x in r2), str(r2))
    pg.fill(".nh-search", ""); pg.check(".nh-errors input"); pg.wait_for_timeout(300)
    r3 = rows(pg)
    check("errors only", r3 and all(x[2] for x in r3), str(r3))
    pg.uncheck(".nh-errors input"); pg.wait_for_timeout(300)
    # copy button: our own 'Copied' message must not be logged
    n_before = len(rows(pg))
    pg.locator(".nh-copy").first.click(); pg.wait_for_timeout(800)
    check("copy does not log itself", len(rows(pg)) == n_before, f"{n_before}->{len(rows(pg))}")
    # live update while open
    api("/api/notification/pushMsg", {"msg": f"Live {tag}", "timeout": 2000}); pg.wait_for_timeout(800)
    check("list updates while open", rows(pg)[0][0] == f"Live {tag}", str(rows(pg)[:1]))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    # persistence: reload the app, history must still be there (save is debounced 2 s)
    pg.wait_for_timeout(2500)
    pg.reload(); pg.wait_for_selector(".nh-status", timeout=30000); pg.wait_for_timeout(1000)
    pg.click(".nh-status"); pg.wait_for_selector(".nh-row")
    r4 = [x for x in rows(pg) if tag in x[0]]
    check("persists after reload", len(r4) == 4 and r4[2][2], str(r4))
    # in-place update: same id shown twice with new text (progress style)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.evaluate("""() => { const m = document.getElementById('message');
        const d = document.createElement('div'); d.className = 'b3-snackbar'; d.dataset.id = 'nh-prog';
        d.innerHTML = '<div class="b3-snackbar__content">Indexing 1/10</div>'; m.append(d);
        setTimeout(() => { d.innerHTML = '<div class="b3-snackbar__content">Indexing 10/10</div>'; }, 300);
        setTimeout(() => d.remove(), 900); }""")
    pg.wait_for_timeout(1500)
    pg.click(".nh-status"); pg.wait_for_selector(".nh-row")
    texts = [x[0] for x in rows(pg)]
    check("in-place update keeps latest text", "Indexing 10/10" in texts and "Indexing 1/10" not in texts, str(texts[:3]))
    pg.screenshot(path=f"{shots}/history2.png")
    pg.click('[data-action="clear"]'); pg.wait_for_timeout(300)
    check("clear empties list", pg.locator(".nh-row").count() == 0 and pg.locator(".nh-empty").count() == 1)
    km = pg.evaluate("JSON.stringify(window.siyuan.ws.app.plugins.find(p => p.name === 'notification-history').commands.map(c => c.langKey))")
    check("commands registered (listed in Settings > Keymap)", km and '"open"' in km and '"clear"' in km, km)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.evaluate("() => window.siyuan.ws.app.plugins.find(p => p.name === 'notification-history').openSetting()")
    pg.wait_for_selector(".b3-dialog--open .b3-switch"); pg.wait_for_timeout(800)
    pg.screenshot(path=f"{shots}/settings.png")
    labels = pg.locator(".b3-dialog--open").inner_text()
    check("settings panel shows 3 options", all(x in labels for x in ["Keep history after restart", "Notifications to keep", "Bell in the status bar"]), labels[:200])
    sw = pg.locator(".b3-dialog--open .b3-switch").nth(1); sw.uncheck(); pg.wait_for_timeout(300)
    check("status bell can be turned off", pg.locator(".nh-status").count() == 0)
    sw.check(); pg.wait_for_timeout(300)
    check("status bell back on", pg.locator(".nh-status").count() == 1)
    check("no page errors", not errs, str(errs[:3]))
    b.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
