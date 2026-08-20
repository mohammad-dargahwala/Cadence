"""Headless render + persistence checks against a live server."""
import json
import os
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

# Resolve the project from this file rather than a hardcoded home directory, so
# the suite runs from a clone anywhere. CADENCE_CHROME overrides the browser.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get(
    "CADENCE_CHROME",
    "/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome",
)
PORT = 3999
BASE = f"http://127.0.0.1:{PORT}"

# The account under test. A login now replaces the old ?w= share link as the
# way a second device reaches the same workspace.
USER = "Testerly"
PASS = "focus-passphrase"
NAME_FIELD = "input[placeholder='What should we call you?']"
PASS_FIELD = "input[placeholder='At least four characters']"

passed, failed = 0, 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


server = subprocess.Popen(
    ["node", "server/index.js"],
    cwd=ROOT,
    env={"PORT": str(PORT), "PATH": "/usr/bin:/bin:/usr/local/bin", "DATA_DIR": "/tmp/cadence-browser-data"},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.PIPE,
)
time.sleep(2)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

        # ---------- session 1: first visit ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(1500)

        print("\nsign-in gate")
        check("no unresolved bindings", "{{" not in page.content())
        check("no runtime placeholder errors", page.locator(".sc-logic-error").count() == 0)
        check("login screen shown first", "Welcome back" in page.inner_text("body"))
        check("timer withheld until signed in", "ready when you are" not in page.inner_text("body"))
        check(
            "no workspace provisioned while signed out",
            page.evaluate("() => window.CadenceStore.workspaceId") is None,
        )

        # Wrong credentials must not open the app.
        page.fill(NAME_FIELD, USER)
        page.fill(PASS_FIELD, "not-the-passphrase")
        page.get_by_role("button", name="Sign in", exact=True).click()
        page.wait_for_timeout(1200)
        check("unknown account refused", "No account with that name." in page.inner_text("body"))

        page.get_by_role("button", name="Create one", exact=True).click()
        page.wait_for_timeout(300)
        page.fill(NAME_FIELD, USER)
        page.fill(PASS_FIELD, PASS)
        page.get_by_role("button", name="Create account", exact=True).click()
        page.wait_for_timeout(2500)

        print("\nrender")
        real = [e for e in errors if "403" not in e and "fonts.g" not in e]
        check("no page errors", not real, str(real[:2]))
        check("timer face rendered", page.locator("text=/^\\d{2}:\\d{2}$/").count() > 0)
        check("wave canvas present", page.locator("#waveCanvas").count() == 1)
        check("no unresolved bindings", "{{" not in page.content())
        check("no runtime placeholder errors", page.locator(".sc-logic-error").count() == 0)
        check("seeded task stack matches the design", "Draft Q3 positioning memo" in page.inner_text("body"))

        ws = page.evaluate("() => window.CadenceStore && window.CadenceStore.workspaceId")
        check("workspace provisioned on registration", bool(ws), str(ws))

        # ---------- log sessions through the real store ----------
        print("\npersistence")
        page.evaluate(
            """() => {
                const s = window.CadenceStore;
                const now = Date.now();
                const d = new Date();
                const p = n => String(n).padStart(2, '0');
                const key = off => {
                    const x = new Date(d.getTime() - off * 86400000);
                    return x.getFullYear() + '-' + p(x.getMonth()+1) + '-' + p(x.getDate());
                };
                // two today, one yesterday -> streak of 2
                s.logSession({mode:'focus', seconds:1500, planned:1500, category:'DEEP WORK', endedAt: now});
                s.logSession({mode:'focus', seconds:1500, planned:1500, category:'DESIGN',   endedAt: now});
                const st = s.getState();
                st.sessions.push({id: crypto.randomUUID(), mode:'focus', seconds:3600, planned:3600,
                    completed:true, category:'ADMIN', startedAt: now-86400000, endedAt: now-86400000,
                    localDate: key(1), deviceId: s.deviceId});
                return s.forceSync();
            }"""
        )
        page.wait_for_timeout(1500)

        page.click("text=Analytics")
        page.wait_for_timeout(800)

        body = page.inner_text("body")
        check("focus today reflects logged work", "50m" in body, body[:200])
        check("session count shown", re.search(r"SESSIONS\s*\n\s*2", body) is not None)
        check("streak counted across days", re.search(r"STREAK\s*\n\s*2d", body) is not None)
        check("category ring shows the real top category", "ADMIN" in body and "55%" in body, repr(body[:400]))
        check("week total computed", "1.8H TOTAL" in body, repr(body[:400]))

        ctx.close()

        # ---------- session 2: fresh browser, same account ----------
        print("\ncross-device")
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 900})
        page2 = ctx2.new_page()
        page2.goto(BASE + "/", wait_until="networkidle")
        page2.wait_for_timeout(1200)
        page2.fill(NAME_FIELD, USER)
        page2.fill(PASS_FIELD, PASS)
        page2.get_by_role("button", name="Sign in", exact=True).click()
        page2.wait_for_timeout(2500)

        check("no credential in the address bar", "?" not in page2.url, page2.url)
        page2.click("text=Analytics")
        page2.wait_for_timeout(800)
        body2 = page2.inner_text("body")
        check("analytics followed to the new browser", "50m" in body2, body2[:200])
        check("streak followed too", "2d" in body2)

        adopted = page2.evaluate("() => window.CadenceStore.workspaceId")
        check("workspace id adopted", adopted == ws, f"{adopted} != {ws}")

        # ---------- session 3: reload keeps state, offline still works ----------
        print("\ndurability")
        page2.reload(wait_until="networkidle")
        page2.wait_for_timeout(2000)
        page2.click("text=Analytics")
        page2.wait_for_timeout(600)
        check("survives reload", "50m" in page2.inner_text("body"))

        # Simulate a dead backend, not a dead network: static assets must still
        # load so we are testing the local cache rather than Playwright's
        # offline flag blocking localhost entirely.
        page2.route("**/api/**", lambda route: route.abort())
        page2.reload(wait_until="domcontentloaded")
        page2.wait_for_timeout(3000)
        page2.click("text=Analytics")
        page2.wait_for_timeout(600)
        off = page2.inner_text("body")
        check("works offline from local cache", "50m" in off, off[:200])
        page2.unroute("**/api/**")

        # ---------- tasks ----------
        print("\ntasks")
        page2.click("text=Tasks")
        page2.wait_for_timeout(600)
        page2.fill("input[placeholder='Add a focus goal…']", "Ship the backend")
        page2.click("text=Add")
        page2.wait_for_timeout(1500)
        check("task appears", "Ship the backend" in page2.inner_text("body"))

        page2.reload(wait_until="networkidle")
        page2.wait_for_timeout(2500)
        page2.click("text=Tasks")
        page2.wait_for_timeout(600)
        check("task survives reload", "Ship the backend" in page2.inner_text("body"))

        # ---------- sign out ----------
        print("\nsign out")
        page2.get_by_role("button", name="Settings", exact=True).click()
        page2.wait_for_timeout(600)
        check("account shown in settings", "SIGNED IN AS" in page2.inner_text("body"))
        page2.get_by_role("button", name="Sign out", exact=True).click()
        page2.wait_for_timeout(1200)
        check("returns to the login screen", "Welcome back" in page2.inner_text("body"))
        check("workspace released", page2.evaluate("() => window.CadenceStore.workspaceId") is None)
        page2.reload(wait_until="networkidle")
        page2.wait_for_timeout(1500)
        check("stays signed out across reload", "Welcome back" in page2.inner_text("body"))

        # Signing back in on the same device restores everything.
        page2.fill(NAME_FIELD, USER)
        page2.fill(PASS_FIELD, PASS)
        page2.get_by_role("button", name="Sign in", exact=True).click()
        page2.wait_for_timeout(2500)
        page2.click("text=Tasks")
        page2.wait_for_timeout(600)
        check("task returns after signing back in", "Ship the backend" in page2.inner_text("body"))

        page2.screenshot(path="/tmp/cadence-timer.png")
        page2.click("text=Analytics")
        page2.wait_for_timeout(900)
        page2.screenshot(path="/tmp/cadence-analytics.png")

        browser.close()
finally:
    server.terminate()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
