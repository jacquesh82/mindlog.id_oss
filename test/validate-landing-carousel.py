"""
Validation script: landing carousel fitLandingColumns
Tests overflow and scale at 1280x800 and 1100x620
"""

import json
import time
import os
from playwright.sync_api import sync_playwright

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "validation-screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

MEASURE_JS = """(() => {
  const cols=[...document.querySelectorAll('#deck .col')];
  const i=cols.findIndex(c=>c.classList.contains('active'));
  const c=cols[i]; const inner=c?.firstElementChild;
  return JSON.stringify({active:i, colClientH:c?.clientHeight, colScrollH:c?.scrollHeight, overflow:(c?.scrollHeight>c?.clientHeight+1), innerTransform:inner?inner.style.transform:null, label:document.getElementById('deck-title')?.textContent});
})()"""

GLOBAL_JS = """JSON.stringify({bodyOverflowY:getComputedStyle(document.body).overflowY, docScrollH:document.documentElement.scrollHeight, docClientH:document.documentElement.clientHeight})"""

VIEWPORTS = [
    {"name": "desktop-1280x800", "width": 1280, "height": 800},
    {"name": "compact-1100x620", "width": 1100, "height": 620},
]

SLIDE_COUNT = 6


def validate_viewport(browser, vp):
    print(f"\n{'='*60}")
    print(f"Viewport: {vp['name']} ({vp['width']}x{vp['height']})")
    print('='*60)

    context = browser.new_context(
        viewport={"width": vp["width"], "height": vp["height"]},
        device_scale_factor=1,
    )
    page = context.new_page()

    page.goto("http://localhost:8787/", wait_until="networkidle", timeout=15000)

    # Wait for app to be ready
    page.wait_for_selector("#app[data-view='landing']", timeout=10000)
    # Extra wait for JS fitLandingColumns to execute
    page.wait_for_timeout(2500)

    # Global overflow check
    global_data = json.loads(page.evaluate(GLOBAL_JS))
    page_overflow = global_data["docScrollH"] > global_data["docClientH"] + 1
    print(f"\nGlobal: bodyOverflowY={global_data['bodyOverflowY']}, "
          f"docScrollH={global_data['docScrollH']}, "
          f"docClientH={global_data['docClientH']}, "
          f"pageOverflow={'YES (BAD)' if page_overflow else 'none (good)'}")

    results = []

    for slide_idx in range(SLIDE_COUNT):
        # Navigate to next slide
        if slide_idx > 0:
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(700)

        # Measure
        data = json.loads(page.evaluate(MEASURE_JS))
        results.append(data)

        overflow_str = "!! OVERFLOW" if data["overflow"] else "ok"
        scale = data["innerTransform"] or "(none)"
        label = data.get("label") or ""
        print(f"  Slide {slide_idx + 1}: [{overflow_str}] "
              f'label="{label}" '
              f"scrollH={data['colScrollH']} "
              f"clientH={data['colClientH']} "
              f'scale="{scale}"')

        # Screenshot
        fname = f"{vp['name']}-slide-{slide_idx + 1}.png"
        fpath = os.path.join(SCREENSHOTS_DIR, fname)
        page.screenshot(path=fpath, full_page=False)
        print(f"    -> {fpath}")

    context.close()
    return {"viewport": vp["name"], "global": global_data, "results": results}


def main():
    all_results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for vp in VIEWPORTS:
            r = validate_viewport(browser, vp)
            all_results.append(r)

        browser.close()

    # Summary
    print("\n\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    for r in all_results:
        page_overflow = r["global"]["docScrollH"] > r["global"]["docClientH"] + 1
        print(f"\n[{r['viewport']}]")
        print(f"  Page overflow: {'YES (BAD)' if page_overflow else 'none (good)'}")
        print(f"  bodyOverflowY: {r['global']['bodyOverflowY']}")
        for s in r["results"]:
            status = "!! OVERFLOW" if s["overflow"] else "ok"
            scale = s["innerTransform"] or "(no transform)"
            label = s.get("label") or ""
            print(f"  Slide {s['active'] + 1} \"{label}\": {status} | "
                  f"scrollH={s['colScrollH']} clientH={s['colClientH']} | {scale}")

    # Save JSON
    json_path = os.path.join(SCREENSHOTS_DIR, "results.json")
    with open(json_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults JSON: {json_path}")
    print(f"Screenshots: {SCREENSHOTS_DIR}")


if __name__ == "__main__":
    main()
