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

VIDEO_DIR      = "/tmp/videos"
SCREENSHOT_DIR = "/tmp/screenshots"
JOBS_DIR       = "/tmp/jobs"
os.makedirs(VIDEO_DIR, exist_ok=True)
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(JOBS_DIR, exist_ok=True)

stealth = Stealth()

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

VIEWPORT        = {"width": 1440, "height": 900}
SCROLL_STEP_PX  = 500
SCROLL_PAUSE_MS = 600
MAX_PAGE_HEIGHT = 50000   # logical px — ~138 A4 pages
SETTLE_MS       = 1500

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
            "--disable-features=TranslateUI,BlinkGenPropertyTrees",
            "--run-all-compositor-stages-before-draw",
            "--disable-threaded-animation",
            # Allow very tall virtual viewports for full-page capture
            "--virtual-time-budget=0",
        ],
    )
    ctx_opts = dict(
        viewport=VIEWPORT,
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

    BLOCK_DOMAINS = [
        "googlesyndication.com", "doubleclick.net",
        "adservice.google.com",  "hotjar.com",
        "clarity.ms",            "facebook.net/en_US/fbevents",
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
# Overlay / sticky-element removal
# ─────────────────────────────────────────────────────

OVERLAY_CSS = """
    /* ── Cookie / GDPR / consent banners ── */
    [class*='cookie'],[id*='cookie'],
    [class*='consent'],[id*='consent'],
    [class*='gdpr'],[id*='gdpr'],
    [class*='privacy-banner'],
    [id*='privacy-banner'],
    [class*='cc-banner'],
    [id*='cc-banner'],
    /* ── Generic popups / modals ── */
    [class*='popup'],[id*='popup'],
    [class*='modal']:not([role='dialog'][aria-labelledby]),
    [class*='overlay']:not(#app):not(#root),
    /* ── Chat / support widgets ── */
    #intercom-container,
    .intercom-lightweight-app,
    #hubspot-messages-iframe-container,
    [class*='crisp'],[class*='drift'],
    div[id^='beacon-container'],
    iframe[src*='tawk.to'],
    iframe[src*='zendesk'],
    /* ── Sticky headers / navbars ── */
    header[style*='position: sticky'],
    header[style*='position:sticky'],
    nav[style*='position: sticky'],
    nav[style*='position:sticky'],
    [class*='sticky-header'],
    [class*='fixed-header'],
    [class*='navbar-fixed'],
    /* ── Notification bars ── */
    [class*='announcement-bar'],
    [class*='notice-bar'],
    [class*='top-bar'][style*='fixed']
    {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }

    /* ── Un-fix sticky/fixed elements so they appear at their natural position ── */
    /* This is the most important rule: fixed elements show at y=0 on every     */
    /* scroll-stitched tile, creating repeated headers in the screenshot.        */
    *[style*='position: fixed']:not([class*='cookie']):not([id*='cookie']):not([class*='popup']),
    *[style*='position:fixed']:not([class*='cookie']):not([id*='cookie']):not([class*='popup']) {
        position: absolute !important;
    }
"""

OVERLAY_JS = """
    () => {
        // Convert ALL fixed/sticky elements to absolute positioning
        // so they appear exactly once in the full-page screenshot.
        const els = document.querySelectorAll('*');
        for (const el of els) {
            const cs = window.getComputedStyle(el);
            if (cs.position === 'fixed') {
                el.style.setProperty('position', 'absolute', 'important');
            }
            if (cs.position === 'sticky') {
                el.style.setProperty('position', 'relative', 'important');
            }
        }
    }
"""

async def fix_fixed_elements(page: Page):
    """
    Two-pass approach:
    1. CSS injection — catches elements styled via stylesheets (fast, catches most)
    2. JS scan — catches elements with inline fixed/sticky styles (catches the rest)
    """
    try:
        await page.add_style_tag(content=OVERLAY_CSS)
    except Exception:
        pass
    try:
        await page.evaluate(OVERLAY_JS)
    except Exception:
        pass
    await page.wait_for_timeout(200)


# ─────────────────────────────────────────────────────
# Full-page screenshot engine
# ─────────────────────────────────────────────────────

async def _wait_for_fonts_and_images(page: Page):
    """Wait for web fonts and all images to fully render."""
    try:
        await page.evaluate("""
            async () => {
                // Wait for all web fonts to load
                await document.fonts.ready;

                // Wait for all images (including lazy ones) to decode
                await Promise.all(
                    [...document.images].map(img => {
                        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                        return new Promise(resolve => {
                            img.addEventListener('load',  resolve, { once: true });
                            img.addEventListener('error', resolve, { once: true });
                            // Safety timeout per image
                            setTimeout(resolve, 5000);
                        });
                    })
                );
            }
        """)
    except Exception:
        pass


async def _raf_flush(page: Page, frames: int = 3):
    """Wait for N requestAnimationFrame ticks — ensures the compositor has painted."""
    try:
        await page.evaluate(f"""
            () => new Promise(resolve => {{
                let f = 0;
                function tick() {{ if (++f >= {frames}) resolve(); else requestAnimationFrame(tick); }}
                requestAnimationFrame(tick);
            }})
        """)
    except Exception:
        pass


async def _measure_true_height(page: Page) -> int:
    """
    Measure the real content height using every method available.
    Takes the maximum across all measurements to avoid missing content
    hidden in overflow containers.
    """
    height = await page.evaluate("""
        () => {
            // Method 1: standard scroll/offset heights
            const standard = Math.max(
                document.body.scrollHeight    || 0,
                document.body.offsetHeight    || 0,
                document.body.clientHeight    || 0,
                document.documentElement.scrollHeight || 0,
                document.documentElement.offsetHeight || 0,
                document.documentElement.clientHeight || 0
            );

            // Method 2: bounding box of all elements
            // Catches elements positioned below the normal document flow
            let maxBottom = 0;
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT,
                null
            );
            let node;
            while ((node = walker.nextNode())) {
                try {
                    const rect = node.getBoundingClientRect();
                    const absBottom = rect.bottom + window.scrollY;
                    if (absBottom > maxBottom && absBottom < 100000) {
                        maxBottom = absBottom;
                    }
                } catch(e) {}
            }

            return Math.max(standard, maxBottom);
        }
    """)
    return min(int(height), MAX_PAGE_HEIGHT)


async def _scroll_to_load_everything(page: Page):
    """
    Scroll top → bottom in steps, waiting at each step for:
    - Lazy images to decode
    - IntersectionObserver callbacks to fire (used by React/Vue lazy components)
    - New content injected by infinite scroll
    """
    prev_height = 0
    current_y   = 0

    while True:
        total_h = await page.evaluate("document.body.scrollHeight")
        if current_y >= min(total_h, MAX_PAGE_HEIGHT):
            break

        current_y = min(current_y + SCROLL_STEP_PX, total_h)
        await page.evaluate(f"window.scrollTo({{ top: {current_y}, behavior: 'instant' }})")
        await page.wait_for_timeout(SCROLL_PAUSE_MS)

        # Wait for any newly-visible images at this scroll position
        await _wait_for_fonts_and_images(page)
        await _raf_flush(page, 2)

        # Detect infinite scroll — page grew, keep going
        new_h = await page.evaluate("document.body.scrollHeight")
        if new_h > total_h:
            total_h = new_h

        # Safety: stop if we're not making progress (avoids infinite loop)
        if new_h == prev_height and current_y >= total_h:
            break
        prev_height = new_h

    # Scroll back to very top
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
    await page.wait_for_timeout(300)


async def _stitch_screenshot(page: Page, content_h: int) -> bytes:
    """
    Tile-based screenshot stitching using Pillow.
    Takes overlapping viewport-sized snapshots as we scroll,
    then stitches them into one tall PNG. This is the most
    reliable method for pages taller than ~16,000px.
    """
    try:
        from PIL import Image
    except ImportError:
        # Pillow not installed — fall back to single-shot
        return None

    tile_h    = VIEWPORT["height"]
    overlap   = 60      # px overlap between tiles to detect/remove seams
    tiles     = []
    positions = []
    y         = 0

    while y < content_h:
        await page.evaluate(f"window.scrollTo({{ top: {y}, behavior: 'instant' }})")
        await _raf_flush(page, 2)
        await page.wait_for_timeout(150)

        tile_bytes = await page.screenshot(
            type="png",
            full_page=False,   # just this viewport
            animations="disabled",
            caret="hide",
        )
        tiles.append(tile_bytes)
        positions.append(y)

        y += tile_h - overlap
        if y >= content_h:
            break

    # Scroll back to top
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")

    # Stitch tiles
    imgs = [Image.open(io.BytesIO(t)) for t in tiles]
    tile_w = imgs[0].width

    full_img = Image.new("RGB", (tile_w, content_h), (255, 255, 255))
    for img, pos in zip(imgs, positions):
        full_img.paste(img, (0, pos))

    out = io.BytesIO()
    full_img.save(out, format="PNG", optimize=False)
    out.seek(0)
    return out.read()


async def capture_full_page(page: Page) -> bytes:
    """
    Master capture function — tries three methods in order of reliability:

    Method A: Viewport-resize then single shot
              Best for: most normal pages under ~15k px tall
    Method B: Tile-stitch with Pillow
              Best for: very tall pages, pages with overflow:hidden on body
    Method C: Playwright full_page=True
              Fallback: simplest but can miss fixed elements and create seams
    """

    content_h = await _measure_true_height(page)

    # ── Method A: resize viewport to full content height ─────────────────────
    try:
        # Set viewport to full content height
        await page.set_viewport_size({"width": VIEWPORT["width"], "height": content_h})
        await _raf_flush(page, 4)
        await page.wait_for_timeout(500)

        # Re-run font/image wait after resize (resize can trigger reflows)
        await _wait_for_fonts_and_images(page)

        img_bytes = await page.screenshot(
            full_page=False,      # viewport IS the page — no stitching needed
            type="png",
            animations="disabled",
            caret="hide",
            clip={
                "x": 0,
                "y": 0,
                "width": VIEWPORT["width"],
                "height": content_h,
            },
        )

        # Sanity check — reject if screenshot is suspiciously small
        if len(img_bytes) > 5000:
            return img_bytes
    except Exception:
        pass

    # ── Method B: tile-stitch ─────────────────────────────────────────────────
    try:
        # Reset to normal viewport first
        await page.set_viewport_size(VIEWPORT)
        await _raf_flush(page, 2)

        stitched = await _stitch_screenshot(page, content_h)
        if stitched and len(stitched) > 5000:
            return stitched
    except Exception:
        pass

    # ── Method C: playwright full_page=True (last resort) ────────────────────
    try:
        await page.set_viewport_size(VIEWPORT)
        img_bytes = await page.screenshot(
            full_page=True,
            type="png",
            animations="disabled",
            caret="hide",
        )
        return img_bytes
    except Exception as e:
        raise RuntimeError(f"All screenshot methods failed: {e}")


# ─────────────────────────────────────────────────────
# Smart page loader
# ─────────────────────────────────────────────────────

async def load_page_fully(page: Page, url: str, timeout: int = 60_000):
    """
    Six-stage load pipeline that ensures every pixel is rendered
    before we hand off to the screenshot engine.
    """

    # ── Stage 1: Navigate ────────────────────────────────────────────────────
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"Navigation failed: {e}")

    # ── Stage 2: Wait for JS framework to render ─────────────────────────────
    # "body *" — at least one real element inside body (catches blank React roots)
    try:
        await page.wait_for_selector("body *", timeout=15_000)
    except Exception:
        pass

    # Double rAF — browser has committed at least one rendered frame
    await _raf_flush(page, 2)
    await page.wait_for_timeout(800)

    # ── Stage 3: Wait for fonts + initial images ──────────────────────────────
    await _wait_for_fonts_and_images(page)

    # ── Stage 4: Scroll to trigger all lazy content ───────────────────────────
    await _scroll_to_load_everything(page)

    # ── Stage 5: Fix fixed/sticky elements ───────────────────────────────────
    await fix_fixed_elements(page)

    # ── Stage 6: Final rAF flush + settle ────────────────────────────────────
    await _raf_flush(page, 4)
    await page.wait_for_timeout(SETTLE_MS)

    # One more font+image check — lazy scroll may have revealed new images
    await _wait_for_fonts_and_images(page)


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
    queue   = [start_url]
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

                    meta["title"]  = await page.title()
                    meta["status"] = await page.evaluate(
                        "() => window.performance?.getEntriesByType('navigation')[0]?.responseStatus || 200"
                    )

                    if request.screenshot_each:
                        img      = await capture_full_page(page)
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
                    # Reset viewport before closing so next page starts clean
                    try:
                        await page.set_viewport_size(VIEWPORT)
                    except Exception:
                        pass
                    await page.close()

                visited[url] = meta
                update_job(job_id,
                    progress=len(visited),
                    total=min(len(visited) + len(queue), request.max_pages),
                    pages=list(visited.values()))

            await browser.close()

        zip_path = os.path.join(SCREENSHOT_DIR, f"crawl_{job_id}.zip")
        report   = {"start_url": start_url, "pages_visited": len(visited),
                    "pages": list(visited.values())}
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("crawl_report.json", json.dumps(report, indent=2))
            for m in visited.values():
                if m.get("screenshot"):
                    ip = os.path.join(out_dir, m["screenshot"])
                    if os.path.exists(ip):
                        zf.write(ip, f"screenshots/{m['screenshot']}")

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
            img_bytes = await capture_full_page(page)
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
    jobs[job_id] = {"job_id": job_id, "status": "queued",
                    "start_url": request.url, "progress": 0,
                    "total": request.max_pages, "pages": [],
                    "zip_path": None, "error": None}
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
        raise HTTPException(status_code=400, detail=f"Job is {j['status']}, not ready")
    zp = j.get("zip_path")
    if not zp or not os.path.exists(zp):
        raise HTTPException(status_code=404, detail="ZIP not found")
    return FileResponse(zp, media_type="application/zip", filename=f"crawl_{job_id}.zip")


@app.delete("/crawl/job/{job_id}")
async def delete_job(job_id: str):
    j  = jobs.pop(job_id, None)
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