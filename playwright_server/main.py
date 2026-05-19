from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.background import BackgroundTasks
from pydantic import BaseModel
from playwright.async_api import async_playwright, Page
from playwright_stealth import Stealth
import uvicorn
import os
import io
import uuid
import zipfile
import json
from urllib.parse import urljoin, urlparse

app = FastAPI()

VIDEO_DIR = "/tmp/videos"
SCREENSHOT_DIR = "/tmp/screenshots"
JOBS_DIR = "/tmp/jobs"
os.makedirs(VIDEO_DIR, exist_ok=True)
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(JOBS_DIR, exist_ok=True)

stealth = Stealth()

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

VIEWPORT         = {"width": 1440, "height": 900}
SCROLL_PAUSE_MS  = 500    # pause between scroll steps for lazy images
SCROLL_STEP_PX   = 600    # px per scroll increment
MAX_PAGE_HEIGHT  = 12000  # logical px cap before screenshot
SETTLE_MS        = 1200   # final paint-settle wait after scroll-back-to-top

jobs: dict[str, dict] = {}


# ─────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    url: str

class DeepCrawlRequest(BaseModel):
    url: str
    max_pages: int = 10
    same_domain_only: bool = True
    screenshot_each: bool = True


# ─────────────────────────────────────────────────────
# URL helpers
# ─────────────────────────────────────────────────────

def normalize_url(url: str) -> str:
    return urlparse(url)._replace(fragment="").geturl().rstrip("/")

def is_same_domain(base: str, target: str) -> bool:
    return urlparse(base).netloc == urlparse(target).netloc

def is_crawlable(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    skip = {".pdf",".png",".jpg",".jpeg",".gif",".svg",".webp",
            ".zip",".tar",".gz",".mp4",".webm",".mp3",".wav",
            ".ico",".xml",".json",".csv",".xls",".xlsx",".doc",".docx"}
    return not any(parsed.path.lower().endswith(e) for e in skip)

async def extract_links(page: Page, base_url: str) -> list[str]:
    hrefs = await page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
    links = []
    for href in hrefs:
        n = normalize_url(urljoin(base_url, href))
        if is_crawlable(n):
            links.append(n)
    return list(set(links))


# ─────────────────────────────────────────────────────
# Browser / context factory
# NOTE: device_scale_factor intentionally omitted —
#       2× scale causes blank-repaint race on many sites.
#       We capture at 1440px logical width which is already
#       high-fidelity for screenshots.
# ─────────────────────────────────────────────────────

async def make_browser_context(p, record_video=False, video_dir=None):
    browser = await p.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--font-render-hinting=none",
            "--force-color-profile=srgb",
            # Disable blink features that sometimes cause blank first-paint
            "--disable-features=TranslateUI,BlinkGenPropertyTrees",
            "--run-all-compositor-stages-before-draw",
            "--disable-threaded-animation",
        ],
    )
    ctx_opts = dict(
        viewport=VIEWPORT,
        # ✅ NO device_scale_factor — it triggers repaint races on JS-heavy SPAs
        user_agent=UA,
        locale="en-US",
        timezone_id="America/New_York",
        java_script_enabled=True,
        color_scheme="light",
        extra_http_headers={
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        },
    )
    if record_video and video_dir:
        ctx_opts["record_video_dir"] = video_dir
        ctx_opts["record_video_size"] = {"width": 1440, "height": 900}

    context = await browser.new_context(**ctx_opts)

    # ✅ Block only pure tracking pixels — NOT analytics.js or tag managers
    #    that some sites bundle with their main bundle on the same domain.
    BLOCK_DOMAINS = [
        "googlesyndication.com",
        "doubleclick.net",
        "adservice.google.com",
        "hotjar.com",
        "clarity.ms",
        "facebook.net/en_US/fbevents",
        "connect.facebook.net",
    ]
    async def _route(route, request):
        if any(d in request.url for d in BLOCK_DOMAINS):
            await route.abort()
        else:
            await route.continue_()

    await context.route("**/*", _route)
    return browser, context


# ─────────────────────────────────────────────────────
# Smart page loader — the key fix for white screenshots
# ─────────────────────────────────────────────────────

async def load_page_fully(page: Page, url: str, timeout: int = 60_000):
    """
    Multi-stage load that waits for the page to be truly painted:

    Stage 1 — Navigate (domcontentloaded only — networkidle hangs SPAs)
    Stage 2 — Wait for an actual DOM element, not just the HTML shell
    Stage 3 — Wait for all <img> tags to finish decoding
    Stage 4 — Lazy-scroll top→bottom to trigger lazy images / infinite scroll
    Stage 5 — Scroll back to top, flush the paint queue via rAF loop
    Stage 6 — Hide cookie / chat overlays
    """

    # ── Stage 1: navigate ────────────────────────────────────────────────────
    # Use domcontentloaded — it's reliable. We do our own "ready" detection below.
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"Navigation failed for {url}: {e}")

    # ── Stage 2: wait for JS framework to render at least one real child ─────
    # "body *" means at least one element inside body — catches blank React roots.
    try:
        await page.wait_for_selector("body *", timeout=15_000)
    except Exception:
        pass  # static HTML pages may not need this

    # Give JS frameworks (React, Vue, Angular, Next.js) time to hydrate.
    # We use a JS-side rAF poll instead of a fixed sleep — faster and more accurate.
    await page.evaluate("""
        () => new Promise(resolve => {
            // Wait until requestAnimationFrame fires twice — means the browser
            // has committed at least one rendered frame to the screen.
            let frames = 0;
            function tick() {
                frames++;
                if (frames >= 2) resolve();
                else requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        })
    """)

    # Extra settle for heavy SPA frameworks (Next.js, Nuxt, Angular Universal)
    await page.wait_for_timeout(800)

    # ── Stage 3: wait for all visible images to decode ───────────────────────
    try:
        await page.evaluate("""
            () => Promise.all(
                [...document.images].map(img =>
                    img.complete
                        ? Promise.resolve()
                        : new Promise(r => { img.onload = r; img.onerror = r; })
                )
            )
        """)
    except Exception:
        pass

    # ── Stage 4: lazy-scroll top → bottom ────────────────────────────────────
    await _scroll_to_bottom(page)

    # ── Stage 5: scroll back to top + flush paint queue ──────────────────────
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")

    # rAF flush — wait for 3 frames after scroll-to-top to let sticky headers
    # and parallax layers reposition before we capture.
    await page.evaluate("""
        () => new Promise(resolve => {
            let f = 0;
            function tick() { if (++f >= 3) resolve(); else requestAnimationFrame(tick); }
            requestAnimationFrame(tick);
        })
    """)
    await page.wait_for_timeout(SETTLE_MS)

    # ── Stage 6: hide overlays that block content ─────────────────────────────
    await _dismiss_overlays(page)


async def _scroll_to_bottom(page: Page):
    """Scroll incrementally, pausing to let lazy content load.
    Re-measures page height on each step to handle infinite-scroll pages."""
    viewport_h = VIEWPORT["height"]
    current_y = 0

    while True:
        total_h = await page.evaluate("document.body.scrollHeight")
        if current_y >= total_h:
            break
        current_y = min(current_y + SCROLL_STEP_PX, total_h)
        await page.evaluate(f"window.scrollTo({{ top: {current_y}, behavior: 'instant' }})")
        await page.wait_for_timeout(SCROLL_PAUSE_MS)

        # Wait for any newly-triggered images to decode
        try:
            await page.evaluate("""
                () => Promise.all(
                    [...document.images]
                        .filter(i => !i.complete)
                        .map(i => new Promise(r => { i.onload = r; i.onerror = r; }))
                )
            """)
        except Exception:
            pass


async def _dismiss_overlays(page: Page):
    """Inject CSS to hide cookie banners, GDPR popups, and chat widgets."""
    selectors = [
        "[class*='cookie']","[id*='cookie']",
        "[class*='consent']","[id*='consent']",
        "[class*='gdpr']","[id*='gdpr']",
        "[class*='banner']",
        "[class*='popup']","[id*='popup']",
        "[class*='modal'][style*='position: fixed']",
        "#intercom-container",".intercom-lightweight-app",
        "#hubspot-messages-iframe-container",
        "[class*='crisp']","[class*='drift']",
        "div[id^='beacon-container']",
    ]
    css = ",".join(selectors) + "{ display:none!important; visibility:hidden!important; }"
    try:
        await page.add_style_tag(content=css)
        await page.wait_for_timeout(150)
    except Exception:
        pass


# ─────────────────────────────────────────────────────
# High-quality screenshot
# ─────────────────────────────────────────────────────

async def capture_screenshot(page: Page) -> bytes:
    """
    Capture at the page's real content height, capped at MAX_PAGE_HEIGHT.
    Sets viewport to content height BEFORE screenshotting so nothing is clipped.
    Uses full_page=False after resizing — more reliable than full_page=True
    on sites that use overflow:hidden on body.
    """
    # Measure true content height
    content_h = await page.evaluate("""
        () => Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.offsetHeight
        )
    """)
    content_h = min(int(content_h), MAX_PAGE_HEIGHT)

    # Resize viewport to full content height so everything is in the "viewport"
    await page.set_viewport_size({"width": VIEWPORT["width"], "height": content_h})

    # Another rAF flush after viewport resize — avoids blank-on-resize bug
    await page.evaluate("""
        () => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    """)
    await page.wait_for_timeout(400)

    img_bytes = await page.screenshot(
        full_page=False,      # ✅ viewport IS the full page now — avoids scroll-stitch bugs
        type="png",
        animations="disabled",
        caret="hide",
    )
    return img_bytes


# ─────────────────────────────────────────────────────
# Job persistence
# ─────────────────────────────────────────────────────

def update_job(job_id: str, **kwargs):
    jobs[job_id].update(kwargs)
    slim = {k: v for k, v in jobs[job_id].items() if k != "pages"}
    with open(os.path.join(JOBS_DIR, f"{job_id}.json"), "w") as f:
        json.dump(slim, f, indent=2)


# ─────────────────────────────────────────────────────
# Crawl worker
# ─────────────────────────────────────────────────────

async def run_crawl_job(job_id: str, request: DeepCrawlRequest):
    start_url = normalize_url(request.url)
    visited: dict[str, dict] = {}
    queue: list[str] = [start_url]
    out_dir = os.path.join(SCREENSHOT_DIR, job_id)
    os.makedirs(out_dir, exist_ok=True)
    update_job(job_id, status="running", progress=0, total=1, pages=[])

    try:
        async with async_playwright() as p:
            browser, context = await make_browser_context(p)

            while queue and len(visited) < request.max_pages:
                url = queue.pop(0)
                if url in visited:
                    continue

                slug = (url.replace("://","_").replace("/","_")
                           .replace("?","_").replace("&","_")
                           .replace("=","_").replace(".","_")[:80])
                meta = {"url": url, "status": None, "title": None,
                        "links_found": [], "screenshot": None, "error": None}

                page = await context.new_page()
                try:
                    await stealth.apply_stealth_async(page)
                    await load_page_fully(page, url)

                    meta["title"] = await page.title()
                    meta["status"] = await page.evaluate(
                        "() => window.performance?.getEntriesByType('navigation')[0]?.responseStatus || 200"
                    )

                    if request.screenshot_each:
                        img = await capture_screenshot(page)
                        img_path = os.path.join(out_dir, f"{slug}.png")
                        with open(img_path, "wb") as f:
                            f.write(img)
                        meta["screenshot"] = f"{slug}.png"

                    links = await extract_links(page, url)
                    meta["links_found"] = links
                    for link in links:
                        if link not in visited and link not in queue:
                            if request.same_domain_only and not is_same_domain(start_url, link):
                                continue
                            queue.append(link)

                except Exception as e:
                    meta["error"] = str(e)
                finally:
                    await page.close()

                visited[url] = meta
                update_job(job_id,
                    progress=len(visited),
                    total=min(len(visited) + len(queue), request.max_pages),
                    pages=list(visited.values()))

            await browser.close()

        zip_path = os.path.join(SCREENSHOT_DIR, f"crawl_{job_id}.zip")
        report = {"start_url": start_url, "pages_visited": len(visited),
                  "pages": list(visited.values())}
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("crawl_report.json", json.dumps(report, indent=2))
            for m in visited.values():
                if m.get("screenshot"):
                    p = os.path.join(out_dir, m["screenshot"])
                    if os.path.exists(p):
                        zf.write(p, f"screenshots/{m['screenshot']}")

        update_job(job_id, status="done", progress=len(visited),
                   total=len(visited), zip_path=zip_path,
                   pages=list(visited.values()))
    except Exception as e:
        update_job(job_id, status="error", error=str(e))


# ─────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "Visual Playwright Server Online"}


@app.post("/screenshot")
async def take_screenshot(request: CrawlRequest):
    async with async_playwright() as p:
        browser, context = await make_browser_context(p)
        page = await context.new_page()
        await stealth.apply_stealth_async(page)
        try:
            await load_page_fully(page, request.url)
            img_bytes = await capture_screenshot(page)
            await browser.close()
            return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")
        except Exception as e:
            await browser.close()
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/video")
async def record_video(request: CrawlRequest):
    async with async_playwright() as p:
        browser, context = await make_browser_context(
            p, record_video=True, video_dir=VIDEO_DIR
        )
        page = await context.new_page()
        await stealth.apply_stealth_async(page)
        try:
            await load_page_fully(page, request.url)
            await page.wait_for_timeout(8000)
            video_path = await page.video.path()
            await context.close()
            await browser.close()
            return FileResponse(video_path, media_type="video/webm", filename="recording.webm")
        except Exception as e:
            await browser.close()
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/crawl/start")
async def start_crawl(request: DeepCrawlRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"job_id": job_id, "status": "queued", "start_url": request.url,
                    "progress": 0, "total": request.max_pages,
                    "pages": [], "zip_path": None, "error": None}
    background_tasks.add_task(run_crawl_job, job_id, request)
    return {"job_id": job_id, "status": "queued", "poll": f"/crawl/status/{job_id}"}


@app.get("/crawl/status/{job_id}")
async def crawl_status(job_id: str):
    if job_id not in jobs:
        p = os.path.join(JOBS_DIR, f"{job_id}.json")
        if os.path.exists(p):
            with open(p) as f:
                jobs[job_id] = json.load(f)
        else:
            raise HTTPException(status_code=404, detail="Job not found")
    j = jobs[job_id]
    return {"job_id": job_id, "status": j["status"],
            "progress": j["progress"], "total": j["total"],
            "pages_so_far": j.get("pages", []),
            "error": j.get("error"),
            "download": f"/crawl/download/{job_id}" if j["status"] == "done" else None}


@app.get("/crawl/download/{job_id}")
async def crawl_download(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    j = jobs[job_id]
    if j["status"] != "done":
        raise HTTPException(status_code=400, detail=f"Job is {j['status']}, not ready yet")
    zp = j.get("zip_path")
    if not zp or not os.path.exists(zp):
        raise HTTPException(status_code=404, detail="ZIP not found")
    return FileResponse(zp, media_type="application/zip", filename=f"crawl_{job_id}.zip")


@app.delete("/crawl/job/{job_id}")
async def delete_job(job_id: str):
    j = jobs.pop(job_id, None)
    if j:
        zp = j.get("zip_path")
        if zp and os.path.exists(zp):
            os.remove(zp)
    jp = os.path.join(JOBS_DIR, f"{job_id}.json")
    if os.path.exists(jp):
        os.remove(jp)
    return {"deleted": job_id}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)