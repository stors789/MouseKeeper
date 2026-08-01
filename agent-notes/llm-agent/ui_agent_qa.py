from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "agent-notes" / "llm-agent" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    console_errors: list[str] = []
    page_errors: list[str] = []

    desktop = browser.new_page(viewport={"width": 1440, "height": 1050})
    desktop.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    desktop.on("pageerror", lambda error: page_errors.append(str(error)))
    desktop.goto("http://127.0.0.1:4173/agent")
    desktop.wait_for_load_state("networkidle")
    desktop.get_by_role("heading", name="MouseKeeper Agent").wait_for()
    desktop.get_by_role("textbox", name="Agent 命令").fill("导出全部小鼠 CSV")
    assert desktop.get_by_role("button", name="执行命令").is_enabled()
    desktop.screenshot(path=ARTIFACTS / "agent-desktop.png", full_page=True)

    desktop.goto("http://127.0.0.1:4173/settings")
    desktop.wait_for_load_state("networkidle")
    desktop.get_by_role("heading", name="Agent 服务与模型").wait_for()
    desktop.get_by_text("浏览器密钥边界").wait_for()
    desktop.screenshot(path=ARTIFACTS / "agent-settings-desktop.png", full_page=True)

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    mobile.on("pageerror", lambda error: page_errors.append(str(error)))
    mobile.goto("http://127.0.0.1:4173/agent")
    mobile.wait_for_load_state("networkidle")
    mobile.get_by_role("heading", name="MouseKeeper Agent").wait_for()
    mobile.screenshot(path=ARTIFACTS / "agent-mobile.png", full_page=True)

    print(json.dumps({
        "desktopTitle": desktop.title(),
        "agentHeading": mobile.get_by_role("heading", name="MouseKeeper Agent").inner_text(),
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "screenshots": sorted(path.name for path in ARTIFACTS.glob("agent-*.png")),
    }, ensure_ascii=False, indent=2))
    browser.close()
