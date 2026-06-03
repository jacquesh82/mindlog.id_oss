"""
Browser test for mindlog · id at http://localhost:8799/
Tests:
1. Click behavior of .brand-milo logo (should navigate to /@milo)
2. Eye tracking: .milo-look transform changes with mouse position
"""

import asyncio
import json
from playwright.async_api import async_playwright


BASE_URL = "http://localhost:8799/"
MILO_URL = "http://localhost:8799/@milo"


async def collect_console_errors(page):
    errors = []
    page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
    page.on("pageerror", lambda exc: errors.append(f"[pageerror] {exc}"))
    return errors


async def get_milo_look_transform(page):
    return await page.evaluate(
        "document.querySelector('.milo .milo-look') ? document.querySelector('.milo .milo-look').getAttribute('transform') : 'ELEMENT_NOT_FOUND'"
    )


async def simulate_mouse_and_read_transform(page, x, y, label):
    await page.mouse.move(x, y)
    await page.wait_for_timeout(150)  # let the handler fire
    transform = await get_milo_look_transform(page)
    print(f"  Mouse at {label} ({x},{y}) -> transform: {transform}")
    return transform


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})

        # -----------------------------------------------------------------------
        # PART 1: CLICK BEHAVIOR — multiple clicks on .brand-milo
        # -----------------------------------------------------------------------
        print("\n=== PART 1: CLICK BEHAVIOR ===\n")

        # --- Click #1: from landing page ---
        page = await context.new_page()
        console_errors_1 = []
        page.on("console", lambda msg: console_errors_1.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda exc: console_errors_1.append(f"[pageerror] {exc}"))

        print("Step 1a: Load http://localhost:8799/")
        await page.goto(BASE_URL, wait_until="networkidle")
        url_before = page.url
        print(f"  URL after load: {url_before}")

        # Check element exists
        brand_milo = await page.query_selector(".brand-milo")
        if brand_milo is None:
            print("  ERROR: .brand-milo element NOT FOUND on landing page!")
        else:
            print("  .brand-milo found on landing page.")

        # Read the anchor href
        href = await page.evaluate(
            "document.querySelector('a.brand') ? document.querySelector('a.brand').getAttribute('href') : 'NOT FOUND'"
        )
        print(f"  a.brand href attribute: {href}")

        # Click brand-milo
        print("\nStep 1b: Click .brand-milo on landing page")
        await page.click(".brand-milo")
        await page.wait_for_timeout(500)
        url_after_click1 = page.url
        print(f"  URL after click #1: {url_after_click1}")
        await page.screenshot(path="/home/jacques/Documents/DEV/Perso/id.mindlog.today/test/screenshot_after_click1.png")
        print("  Screenshot saved: test/screenshot_after_click1.png")

        # --- Click #2: navigate back to landing, click again ---
        print("\nStep 1c: Navigate back to http://localhost:8799/")
        await page.goto(BASE_URL, wait_until="networkidle")
        url_back = page.url
        print(f"  URL after navigate back: {url_back}")

        print("\nStep 1d: Click .brand-milo AGAIN on landing page")
        await page.click(".brand-milo")
        await page.wait_for_timeout(500)
        url_after_click2 = page.url
        print(f"  URL after click #2: {url_after_click2}")
        await page.screenshot(path="/home/jacques/Documents/DEV/Perso/id.mindlog.today/test/screenshot_after_click2.png")
        print("  Screenshot saved: test/screenshot_after_click2.png")

        # --- Click #3: from /@milo page, click brand-milo ---
        print("\nStep 1e: Now on /@milo page — click .brand-milo in its header")
        current_url_before_3 = page.url
        print(f"  Current URL before click #3: {current_url_before_3}")

        brand_milo_on_milo = await page.query_selector(".brand-milo")
        if brand_milo_on_milo is None:
            print("  ERROR: .brand-milo element NOT FOUND on /@milo page!")
        else:
            print("  .brand-milo found on /@milo page.")

        await page.click(".brand-milo")
        await page.wait_for_timeout(500)
        url_after_click3 = page.url
        print(f"  URL after click #3 (from /@milo): {url_after_click3}")
        await page.screenshot(path="/home/jacques/Documents/DEV/Perso/id.mindlog.today/test/screenshot_after_click3.png")
        print("  Screenshot saved: test/screenshot_after_click3.png")

        # --- Summary ---
        print("\n--- Click Behavior Summary ---")
        print(f"  Click #1 (from /):      {url_after_click1}")
        print(f"  Click #2 (from /):      {url_after_click2}")
        print(f"  Click #3 (from /@milo): {url_after_click3}")

        if console_errors_1:
            print("\n  JS Console errors/warnings (Part 1):")
            for e in console_errors_1:
                print(f"    {e}")
        else:
            print("\n  No JS console errors/warnings in Part 1.")

        # -----------------------------------------------------------------------
        # PART 2: EYE TRACKING — .milo-look transform changes with mouse
        # -----------------------------------------------------------------------
        print("\n=== PART 2: EYE TRACKING ===\n")

        console_errors_2 = []

        # --- 2a: Landing page ---
        print("Step 2a: Load landing page and test eye tracking")
        await page.goto(BASE_URL, wait_until="networkidle")
        page.on("console", lambda msg: console_errors_2.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda exc: console_errors_2.append(f"[pageerror] {exc}"))

        milo_look_el = await page.query_selector(".milo .milo-look")
        if milo_look_el is None:
            print("  ERROR: .milo .milo-look NOT FOUND on landing page!")
        else:
            print("  .milo .milo-look found on landing page.")

        # Initial transform (no mouse yet)
        transform_initial = await get_milo_look_transform(page)
        print(f"  Initial transform (no mouse): {transform_initial}")

        # Move mouse to several positions
        transforms_landing = {}
        transforms_landing["top-left(50,50)"] = await simulate_mouse_and_read_transform(page, 50, 50, "top-left")
        transforms_landing["top-right(1230,50)"] = await simulate_mouse_and_read_transform(page, 1230, 50, "top-right")
        transforms_landing["center(640,400)"] = await simulate_mouse_and_read_transform(page, 640, 400, "center")
        transforms_landing["bottom-left(50,750)"] = await simulate_mouse_and_read_transform(page, 50, 750, "bottom-left")
        transforms_landing["bottom-right(1230,750)"] = await simulate_mouse_and_read_transform(page, 1230, 750, "bottom-right")

        unique_transforms_landing = set(transforms_landing.values())
        print(f"\n  Unique transform values on landing: {len(unique_transforms_landing)}")
        eye_tracking_works_landing = len(unique_transforms_landing) > 1
        print(f"  Eye tracking working on landing page: {eye_tracking_works_landing}")

        await page.screenshot(path="/home/jacques/Documents/DEV/Perso/id.mindlog.today/test/screenshot_eye_landing.png")
        print("  Screenshot saved: test/screenshot_eye_landing.png")

        # --- 2b: /@milo page ---
        print("\nStep 2b: Navigate to /@milo and test eye tracking")
        await page.goto(MILO_URL, wait_until="networkidle")
        await page.wait_for_timeout(300)

        milo_look_el2 = await page.query_selector(".milo .milo-look")
        if milo_look_el2 is None:
            print("  ERROR: .milo .milo-look NOT FOUND on /@milo page!")
        else:
            print("  .milo .milo-look found on /@milo page.")

        transform_initial_milo = await get_milo_look_transform(page)
        print(f"  Initial transform (no mouse): {transform_initial_milo}")

        transforms_milo = {}
        transforms_milo["top-left(50,50)"] = await simulate_mouse_and_read_transform(page, 50, 50, "top-left")
        transforms_milo["top-right(1230,50)"] = await simulate_mouse_and_read_transform(page, 1230, 50, "top-right")
        transforms_milo["center(640,400)"] = await simulate_mouse_and_read_transform(page, 640, 400, "center")
        transforms_milo["bottom-left(50,750)"] = await simulate_mouse_and_read_transform(page, 50, 750, "bottom-left")
        transforms_milo["bottom-right(1230,750)"] = await simulate_mouse_and_read_transform(page, 1230, 750, "bottom-right")

        unique_transforms_milo = set(transforms_milo.values())
        print(f"\n  Unique transform values on /@milo: {len(unique_transforms_milo)}")
        eye_tracking_works_milo = len(unique_transforms_milo) > 1
        print(f"  Eye tracking working on /@milo page: {eye_tracking_works_milo}")

        await page.screenshot(path="/home/jacques/Documents/DEV/Perso/id.mindlog.today/test/screenshot_eye_milo.png")
        print("  Screenshot saved: test/screenshot_eye_milo.png")

        # Final console error summary
        if console_errors_2:
            print("\n  JS Console errors/warnings (Part 2):")
            for e in console_errors_2:
                print(f"    {e}")
        else:
            print("\n  No JS console errors/warnings in Part 2.")

        # -----------------------------------------------------------------------
        # EXTRA: Check how the mousemove listener is registered (listener count)
        # -----------------------------------------------------------------------
        print("\n=== EXTRA: Handler registration check ===\n")
        await page.goto(BASE_URL, wait_until="networkidle")

        # Check if mousemove is on window/document and whether it accumulates
        listener_info = await page.evaluate("""
            () => {
                // We can't directly count listeners in most browsers, but we can
                // test if the handler fires multiple times by patching it temporarily
                let count = 0;
                const orig = window.onmousemove;
                const info = {
                    window_onmousemove: typeof window.onmousemove,
                    document_onmousemove: typeof document.onmousemove,
                };
                return info;
            }
        """)
        print(f"  window.onmousemove type: {listener_info['window_onmousemove']}")
        print(f"  document.onmousemove type: {listener_info['document_onmousemove']}")

        # Navigate to /@milo and check again
        await page.goto(MILO_URL, wait_until="networkidle")
        listener_info2 = await page.evaluate("""
            () => {
                return {
                    window_onmousemove: typeof window.onmousemove,
                    document_onmousemove: typeof document.onmousemove,
                };
            }
        """)
        print(f"  (on /@milo) window.onmousemove type: {listener_info2['window_onmousemove']}")
        print(f"  (on /@milo) document.onmousemove type: {listener_info2['document_onmousemove']}")

        await browser.close()
        print("\n=== TEST COMPLETE ===")


asyncio.run(run())
