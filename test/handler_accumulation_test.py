"""
Extra test: check whether the mousemove handler accumulates after
navigating between pages multiple times (SPA double-registration bug).
We do this by:
  - Injecting a counter that increments each time .milo .milo-look is updated
  - Moving the mouse once, reading the counter
  - Navigating to /@milo and back multiple times via clicks
  - Moving the mouse once more, reading the counter again
If the counter is > 1 per mouse-move, the handler fires multiple times.
"""

import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:8799/"
MILO_URL = "http://localhost:8799/@milo"

INJECT_COUNTER = """
    window.__miloLookUpdateCount = 0;
    const origSetAttr = SVGElement.prototype.setAttribute;
    SVGElement.prototype.setAttribute = function(name, value) {
        if (name === 'transform' && this.classList && this.classList.contains('milo-look')) {
            window.__miloLookUpdateCount++;
        }
        return origSetAttr.call(this, name, value);
    };
    console.log('Counter injected');
"""

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        console_msgs = []
        page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))

        print("=== Handler Accumulation Test ===\n")

        # Load landing
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.evaluate(INJECT_COUNTER)

        # One mouse move — expect count=1
        await page.mouse.move(300, 200)
        await page.wait_for_timeout(150)
        count1 = await page.evaluate("window.__miloLookUpdateCount")
        transform1 = await page.evaluate("document.querySelector('.milo .milo-look')?.getAttribute('transform')")
        print(f"After 1 mouse move on landing page:")
        print(f"  Handler fire count: {count1}  (expect 1)")
        print(f"  Transform: {transform1}")

        # Navigate to /@milo via click
        print("\nNavigating to /@milo via .brand-milo click...")
        await page.click(".brand-milo")
        await page.wait_for_timeout(400)
        print(f"  URL: {page.url}")

        # Re-inject counter on /@milo (it resets on navigation)
        await page.evaluate(INJECT_COUNTER)

        await page.mouse.move(400, 300)
        await page.wait_for_timeout(150)
        count2 = await page.evaluate("window.__miloLookUpdateCount")
        transform2 = await page.evaluate("document.querySelector('.milo .milo-look')?.getAttribute('transform')")
        print(f"After 1 mouse move on /@milo page:")
        print(f"  Handler fire count: {count2}  (expect 1)")
        print(f"  Transform: {transform2}")

        # Navigate back to /
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.evaluate(INJECT_COUNTER)
        print(f"\nBack on landing ({page.url}), re-injected counter.")

        # Navigate to /@milo AGAIN via click (second navigation cycle)
        await page.click(".brand-milo")
        await page.wait_for_timeout(400)
        print(f"Navigated to /@milo second time: {page.url}")

        await page.evaluate(INJECT_COUNTER)
        await page.mouse.move(200, 100)
        await page.wait_for_timeout(150)
        count3 = await page.evaluate("window.__miloLookUpdateCount")
        transform3 = await page.evaluate("document.querySelector('.milo .milo-look')?.getAttribute('transform')")
        print(f"After 1 mouse move on /@milo (2nd visit):")
        print(f"  Handler fire count: {count3}  (expect 1)")
        print(f"  Transform: {transform3}")

        # Navigate back to / AGAIN, click again (third cycle)
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.evaluate(INJECT_COUNTER)
        await page.click(".brand-milo")
        await page.wait_for_timeout(400)
        print(f"\nNavigated to /@milo third time: {page.url}")

        await page.evaluate(INJECT_COUNTER)
        await page.mouse.move(900, 600)
        await page.wait_for_timeout(150)
        count4 = await page.evaluate("window.__miloLookUpdateCount")
        transform4 = await page.evaluate("document.querySelector('.milo .milo-look')?.getAttribute('transform')")
        print(f"After 1 mouse move on /@milo (3rd visit):")
        print(f"  Handler fire count: {count4}  (expect 1, but > 1 means accumulation bug)")
        print(f"  Transform: {transform4}")

        print("\n--- Accumulation Summary ---")
        print(f"  Visit 1 (/):      count={count1}")
        print(f"  Visit 1 (/@milo): count={count2}")
        print(f"  Visit 2 (/@milo): count={count3}")
        print(f"  Visit 3 (/@milo): count={count4}")

        if any(c > 1 for c in [count1, count2, count3, count4]):
            print("\n  *** ACCUMULATION BUG DETECTED: handler fires more than once per mouse move ***")
        else:
            print("\n  No accumulation bug: handler fires exactly once per mouse move each visit.")

        print("\nConsole messages:")
        for m in console_msgs:
            print(f"  {m}")

        await browser.close()

asyncio.run(run())
