from __future__ import annotations

import json

from playwright.sync_api import sync_playwright


ROUTES = [
    "/dashboard",
    "/mice",
    "/mice/new",
    "/mice/bulk-create",
    "/cages",
    "/cages/new",
    "/breeding",
    "/breeding/new",
    "/experiments",
    "/experiments/new",
    "/records",
    "/records/weights/quick",
    "/tasks",
    "/tasks/new",
    "/data",
    "/settings",
]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    inventory = []

    page.goto("http://127.0.0.1:5173/data")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="示例数据").click()
    page.get_by_role("button", name="生成一组示例数据").click()
    page.get_by_text("示例批次", exact=False).wait_for()

    for route in ROUTES:
        page.goto(f"http://127.0.0.1:5173{route}")
        page.wait_for_load_state("networkidle")
        inventory.append(
            {
                "route": route,
                "title": page.title(),
                "headings": [
                    text.strip()
                    for text in page.locator("h1, h2, h3").all_text_contents()
                    if text.strip()
                ],
                "links": [
                    text.strip()
                    for text in page.get_by_role("link").all_text_contents()
                    if text.strip()
                ],
                "hrefs": sorted(
                    {
                        href
                        for item in page.locator("a[href]").all()
                        if (href := item.get_attribute("href"))
                        and href.startswith("/")
                    }
                ),
                "buttons": [
                    text.strip()
                    for text in page.get_by_role("button").all_text_contents()
                    if text.strip()
                ],
                "inputs": [
                    {
                        "type": item.get_attribute("type"),
                        "name": item.get_attribute("name"),
                        "label": item.get_attribute("aria-label"),
                        "placeholder": item.get_attribute("placeholder"),
                    }
                    for item in page.locator("input, textarea, select").all()
                ],
            }
        )

    print(json.dumps({"routes": inventory, "consoleErrors": console_errors}, ensure_ascii=False, indent=2))
    browser.close()
