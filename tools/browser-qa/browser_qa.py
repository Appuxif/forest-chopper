#!/usr/bin/env python3
"""Isolated Chrome DevTools Protocol browser QA. No Chrome DevTools MCP required.

Requires Python 3.11+, google-chrome/Chromium and pip install -r requirements.txt.
The game and optional multiplayer server are bound to 127.0.0.1, and each
browser page lives in its own non-persistent Chromium BrowserContext.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

try:
    from websockets.sync.client import connect
except ImportError:
    connect = None

REPO = Path(__file__).resolve().parents[2]
SESSION_ROOT = Path(tempfile.gettempdir()) / f"forest-chopper-browser-qa-{os.getuid()}"
ERROR_HOOK = r"""(()=>{
  const errors=[],messages=[];
  const push=(list,item)=>{list.push(item);if(list.length>200)list.shift();};
  const record=(kind,message,extra={})=>{
    const item={kind,message:String(message),...extra,time:Date.now()};
    push(errors,item);push(messages,item);
  };
  Object.defineProperty(window,'__browserQaErrors',{value:errors,configurable:false});
  Object.defineProperty(window,'__browserQaConsole',{value:messages,configurable:false});
  window.addEventListener('error',e=>record('error',e.message,{source:e.filename,line:e.lineno}));
  window.addEventListener('unhandledrejection',e=>record('rejection',e.reason?.stack||e.reason));
  for(const kind of ['log','info','warn','error','debug']){
    const original=console[kind];
    console[kind]=(...args)=>{
      const message=args.map(x=>x?.stack||String(x)).join(' ');
      if(kind==='error')record('console',message);
      else push(messages,{kind,message,time:Date.now()});
      return original.apply(console,args);
    };
  }
})();"""


class QaError(RuntimeError):
    pass


def require_websockets():
    if connect is None:
        raise QaError("Install the dependency: python3 -m pip install -r requirements.txt")


def fresh_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def get_json(url: str, timeout: float = 2) -> dict:
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


def wait_for(check, timeout: float, label: str, interval: float = .15):
    end = time.monotonic() + timeout
    last = None
    while time.monotonic() < end:
        try:
            value = check()
            if value:
                return value
        except (URLError, OSError, ValueError, QaError) as error:
            last = error
        time.sleep(interval)
    raise QaError(f"Timeout waiting for {label} ({timeout:.1f}s): {last or 'not ready'}")


def browser_binary(override: str | None = None) -> str:
    if override:
        path = shutil.which(override)
        if path:
            return path
        if Path(override).is_file():
            return override
        raise QaError(f"Chrome binary not found: {override}")
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if path := shutil.which(name):
            return path
    raise QaError("Chrome/Chromium not found; specify --chrome PATH")


def own_path(name: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,55}", name):
        raise QaError("Session name must contain only letters, digits, '_' or '-' (1–56 chars)")
    return SESSION_ROOT / name


def write_json(path: Path, obj: dict):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def read_session(path: Path) -> dict:
    if not (path / ".browser-qa-owned").exists():
        raise QaError(f"Browser QA session does not exist: {path}. Run 'start' first.")
    try:
        return json.loads((path / "session.json").read_text())
    except (OSError, ValueError) as error:
        raise QaError(f"Invalid session data: {error}") from error


def owned_pid(pid: int, marker: str) -> bool:
    try:
        content = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        return bool(marker and marker in content)
    except OSError:
        return False


def stop_pid(pid: int, marker: str):
    # Don't kill an unrelated process if the original PID has been recycled.
    if not owned_pid(pid, marker):
        return False
    with contextlib.suppress(ProcessLookupError):
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    end = time.monotonic() + 4
    while time.monotonic() < end:
        if not owned_pid(pid, marker):
            return True
        time.sleep(.10)
    if owned_pid(pid, marker):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(pid), signal.SIGKILL)
    return True


class CDP:
    def __init__(self, port: int):
        require_websockets()
        info = get_json(f"http://127.0.0.1:{port}/json/version")
        self._connection = connect(info["webSocketDebuggerUrl"], origin="http://localhost",
                                   open_timeout=10, max_size=50 * 1024 * 1024)
        self.ws = self._connection.__enter__()
        self.id = 0
        self.sessions = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._connection.__exit__(*args)

    def call(self, method: str, params: dict | None = None,
             session_id: str | None = None, timeout: float = 35) -> dict:
        self.id += 1
        request = {"id": self.id, "method": method, "params": params or {}}
        if session_id:
            request["sessionId"] = session_id
        self.ws.send(json.dumps(request))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                event = json.loads(self.ws.recv(timeout=max(.01, deadline - time.monotonic())))
            except TimeoutError:
                break
            if event.get("id") != self.id:
                continue  # CDP events are unsolicited and may precede the response
            if error := event.get("error"):
                raise QaError(f"CDP {method}: {error}")
            return event.get("result", {})
        raise QaError(f"CDP command timed out: {method}")

    def attach(self, target_id: str) -> str:
        if target_id not in self.sessions:
            self.sessions[target_id] = self.call(
                "Target.attachToTarget", {"targetId": target_id, "flatten": True}
            )["sessionId"]
        return self.sessions[target_id]

    def evaluate(self, target_id: str, expression: str, timeout: float = 35):
        session = self.attach(target_id)
        result = self.call("Runtime.evaluate", {
            "expression": expression, "awaitPromise": True,
            "returnByValue": True, "timeout": int(timeout * 1000),
            "userGesture": True
        }, session, timeout=timeout + 2)
        if "exceptionDetails" in result:
            info = result["exceptionDetails"]
            raise QaError(info.get("exception", {}).get("description")
                          or info.get("text", "JavaScript exception"))
        value = result.get("result", {})
        if value.get("subtype") == "undefined":
            return None
        if "value" in value:
            return value["value"]
        if value.get("type") == "object":
            return {"description": value.get("description", "non-serializable object")}
        return value.get("description")

    def new_page(self, url: str, mobile: tuple[int, int] | None = None,
                 dpr: float = 1):
        context = self.call("Target.createBrowserContext", {"disposeOnDetach": False})["browserContextId"]
        try:
            target = self.call("Target.createTarget", {
                "url": "about:blank", "browserContextId": context,
                "width": (mobile or (1280, 800))[0],
                "height": (mobile or (1280, 800))[1]
            })["targetId"]
            session = self.attach(target)
            self.call("Page.enable", session_id=session)
            self.call("Runtime.enable", session_id=session)
            self.call("Page.addScriptToEvaluateOnNewDocument", {"source": ERROR_HOOK}, session)
            if mobile:
                w, h = mobile
                self.call("Emulation.setDeviceMetricsOverride", {
                    "width": w, "height": h, "deviceScaleFactor": dpr,
                    "mobile": True, "screenWidth": w, "screenHeight": h
                }, session)
                self.call("Emulation.setTouchEmulationEnabled", {
                    "enabled": True, "maxTouchPoints": 5
                }, session)
            self.call("Page.navigate", {"url": url}, session)
            return {"target": target, "context": context, "url": url,
                    "mobile": list(mobile) if mobile else None, "dpr": dpr}
        except BaseException:
            with contextlib.suppress(Exception):
                self.call("Target.disposeBrowserContext", {"browserContextId": context})
            raise

    def navigate(self, target: str, url: str):
        session = self.attach(target)
        return self.call("Page.navigate", {"url": url}, session)

    def screenshot(self, target: str, filename: Path):
        session = self.attach(target)
        self.call("Page.enable", session_id=session)
        encoded = self.call("Page.captureScreenshot", {
            "format": "png", "captureBeyondViewport": False
        }, session, timeout=30)["data"]
        filename.parent.mkdir(parents=True, exist_ok=True)
        filename.write_bytes(base64.b64decode(encoded))
        return {"file": str(filename), "bytes": filename.stat().st_size}

    def key(self, target: str, code: str, down: bool):
        session = self.attach(target)
        key, keycode = key_info(code)
        self.call("Input.dispatchKeyEvent", {
            "type": "rawKeyDown" if down else "keyUp",
            "code": code, "key": key,
            "windowsVirtualKeyCode": keycode, "nativeVirtualKeyCode": keycode
        }, session)
        return {"code": code, "down": down}

    def mouse_click(self, target: str, x: int, y: int):
        session = self.attach(target)
        for event in ("mousePressed", "mouseReleased"):
            self.call("Input.dispatchMouseEvent", {
                "type": event, "x": x, "y": y, "button": "left", "clickCount": 1
            }, session)
        return {"x": x, "y": y}

    def mouse_move(self, target: str, x: int, y: int):
        return self.call("Input.dispatchMouseEvent", {
            "type": "mouseMoved", "x": x, "y": y
        }, self.attach(target))

    def wheel(self, target: str, x: int, y: int, delta_y: int, delta_x: int = 0):
        return self.call("Input.dispatchMouseEvent", {
            "type": "mouseWheel", "x": x, "y": y,
            "deltaY": delta_y, "deltaX": delta_x
        }, self.attach(target))

    def touch(self, target: str, phase: str, x: int = 0, y: int = 0):
        session = self.attach(target)
        phases = {"start": "touchStart", "move": "touchMove", "end": "touchEnd"}
        if phase not in phases:
            raise QaError(f"Unknown touch phase: {phase}")
        return self.call("Input.dispatchTouchEvent", {
            "type": phases[phase],
            "touchPoints": [] if phase == "end" else [{"id": 1, "x": x, "y": y}]
        }, session)


KEY_SPECIAL = {"Space": (" ", 32), "Enter": ("Enter", 13), "Escape": ("Escape", 27),
               "ShiftLeft": ("Shift", 16), "ShiftRight": ("Shift", 16),
               "ControlLeft": ("Control", 17), "ControlRight": ("Control", 17),
               "ArrowUp": ("ArrowUp", 38), "ArrowDown": ("ArrowDown", 40),
               "ArrowLeft": ("ArrowLeft", 37), "ArrowRight": ("ArrowRight", 39)}


def key_info(code: str) -> tuple[str, int]:
    if code in KEY_SPECIAL:
        return KEY_SPECIAL[code]
    if re.fullmatch(r"Key[A-Z]", code):
        return code[-1].lower(), ord(code[-1])
    if re.fullmatch(r"Digit[0-9]", code):
        return code[-1], ord(code[-1])
    raise QaError(f"Unsupported key code: {code}. Use KeyW, ShiftLeft, Space, etc.")


def get_page(state: dict, name: str) -> dict:
    if name not in state["pages"]:
        raise QaError(f"No page '{name}'. Available: {', '.join(state['pages']) or '(none)'}")
    return state["pages"][name]


def local_url(value: str, http_port: int) -> str:
    if value.startswith(("http://", "https://", "about:", "data:")):
        return value
    if not value.startswith("/"):
        value = "/" + value
    return f"http://127.0.0.1:{http_port}{value}"


def spawn(args: list[str], logfile: Path, cwd: Path = REPO) -> int:
    with logfile.open("ab") as output:
        process = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    return process.pid


def start_session(folder: Path, chrome: str | None, software_gl: bool,
                  no_sandbox: bool, game_server: bool):
    require_websockets()
    if folder.exists():
        raise QaError(f"Session directory already exists: {folder}; stop it first")
    folder.mkdir(parents=True, mode=0o700)
    (folder / ".browser-qa-owned").touch()
    state = {"http_port": fresh_port(), "cdp_port": fresh_port(), "ws_port": None,
             "processes": {}, "pages": {}, "repo": str(REPO), "created": time.time()}
    write_json(folder / "session.json", state)
    try:
        http = [sys.executable, "-m", "http.server", str(state["http_port"]),
                "--bind", "127.0.0.1", "--directory", str(REPO)]
        state["processes"]["http"] = {
            "pid": spawn(http, folder / "http.log"), "marker": str(REPO)
        }
        wait_for(lambda: urlopen(f"http://127.0.0.1:{state['http_port']}/index.html",
                                 timeout=2).status == 200, 10, "local HTTP server")
        if game_server:
            state["ws_port"] = fresh_port()
            world = folder / "test-world.json"
            server = [sys.executable, str(REPO / "forest_server.py"),
                      "--host", "127.0.0.1", "--port", str(state["ws_port"]),
                      "--save", str(world)]
            state["processes"]["ws"] = {
                "pid": spawn(server, folder / "websocket.log"), "marker": str(world)
            }
            wait_for(lambda: socket.create_connection(
                ("127.0.0.1", state["ws_port"]), timeout=1).close() is None,
                12, "temporary multiplayer server")
        profile = folder / "chrome-profile"
        binary = browser_binary(chrome)
        flags = [binary, "--headless=new", "--no-first-run", "--no-default-browser-check",
                 "--disable-dev-shm-usage", "--remote-debugging-address=127.0.0.1",
                 f"--remote-debugging-port={state['cdp_port']}",
                 "--remote-allow-origins=http://localhost",
                 f"--user-data-dir={profile}", "--window-size=1280,800"]
        if software_gl:
            flags += ["--enable-unsafe-swiftshader", "--use-gl=angle",
                      "--use-angle=swiftshader", "--disable-features=Vulkan"]
        if no_sandbox:
            flags.append("--no-sandbox")
        flags.append("about:blank")
        state["processes"]["chrome"] = {
            "pid": spawn(flags, folder / "chrome.log"), "marker": f"--user-data-dir={profile}"
        }
        write_json(folder / "session.json", state)
        wait_for(lambda: get_json(f"http://127.0.0.1:{state['cdp_port']}/json/version"),
                 20, "Chrome CDP")
        with CDP(state["cdp_port"]) as cdp:
            cdp.call("Browser.getVersion")
        return state
    except BaseException:
        write_json(folder / "session.json", state)
        stop_session(folder)
        raise


def stop_session(folder: Path):
    state = read_session(folder)
    # Each process is launched in its own group and validated by its exact
    # command line before signaling. Never close user's Chrome/servers.
    results = {}
    for name in ("chrome", "ws", "http"):
        if info := state["processes"].get(name):
            results[name] = stop_pid(info["pid"], info["marker"])
    shutil.rmtree(folder)
    return {"stopped": results, "session": str(folder)}


def add_page(folder: Path, state: dict, name: str, url: str,
             mobile: tuple[int, int] | None = None, dpr: float = 1):
    if name in state["pages"]:
        raise QaError(f"Page already exists: {name}")
    with CDP(state["cdp_port"]) as cdp:
        item = cdp.new_page(local_url(url, state["http_port"]), mobile, dpr)
    state["pages"][name] = item
    write_json(folder / "session.json", state)
    return {"page": name, **item}


def close_page(folder: Path, state: dict, name: str):
    page = get_page(state, name)
    with CDP(state["cdp_port"]) as cdp:
        cdp.call("Target.disposeBrowserContext", {"browserContextId": page["context"]})
    state["pages"].pop(name)
    write_json(folder / "session.json", state)
    return {"closed": name}


def page_command(state: dict, name: str, callback):
    page = get_page(state, name)
    with CDP(state["cdp_port"]) as cdp:
        return callback(cdp, page["target"])


def state_command(folder: Path, args) -> dict | list | str | bool | int | float | None:
    state = read_session(folder)
    name = getattr(args, "page", "main")
    if args.action == "status":
        return {
            "session": str(folder), "http_url": f"http://127.0.0.1:{state['http_port']}",
            "cdp_port": state["cdp_port"], "ws_port": state["ws_port"],
            "processes": {k: {
                "pid": v["pid"], "alive": owned_pid(v["pid"], v["marker"])
            } for k, v in state["processes"].items()},
            "pages": state["pages"]
        }
    if args.action == "open":
        return add_page(folder, state, name, args.url, parse_mobile(args.mobile), args.dpr)
    if args.action == "close":
        return close_page(folder, state, name)
    if args.action == "navigate":
        url = local_url(args.url, state["http_port"])
        if args.fresh_context:
            page = get_page(state, name)
            with CDP(state["cdp_port"]) as cdp:
                cdp.call("Target.disposeBrowserContext",
                         {"browserContextId": page["context"]})
                state["pages"].pop(name)
                write_json(folder / "session.json", state)
                replacement = cdp.new_page(url, tuple(page["mobile"]) if page["mobile"] else None,
                                           page["dpr"])
            state["pages"][name] = replacement
            write_json(folder / "session.json", state)
            return {"page": name, "url": url, "fresh_context": True}
        value = page_command(state, name, lambda c, t: c.navigate(t, url))
        state["pages"][name]["url"] = url
        write_json(folder / "session.json", state)
        return {"page": name, "url": url, "navigation": value}
    if args.action == "eval":
        expression = Path(args.file).read_text() if args.file else args.expression
        if not expression:
            raise QaError("Specify a JavaScript expression or --file")
        return page_command(state, name, lambda c, t: c.evaluate(t, expression))
    if args.action == "script":
        body = Path(args.file).read_text()
        expression = "(async()=>{" + body + "\n})()"
        return page_command(state, name, lambda c, t: c.evaluate(t, expression,
                                                                    timeout=args.timeout))
    if args.action == "wait":
        with CDP(state["cdp_port"]) as cdp:
            target = get_page(state, name)["target"]
            value = wait_for(lambda: cdp.evaluate(target, args.expression),
                             args.timeout, args.expression, interval=args.interval)
            return {"page": name, "value": value}
    if args.action == "screenshot":
        return page_command(state, name, lambda c, t: c.screenshot(t, Path(args.file).expanduser()))
    if args.action == "console":
        expression = "window.__browserQaConsole?.slice(-" + str(args.limit) + ") ?? []"
        return page_command(state, name, lambda c, t: c.evaluate(t, expression))
    if args.action == "errors":
        expression = "window.__browserQaErrors?.slice(-" + str(args.limit) + ") ?? []"
        return page_command(state, name, lambda c, t: c.evaluate(t, expression))
    if args.action == "resources":
        return page_command(state, name, lambda c, t: c.evaluate(t,
            "()=>performance.getEntriesByType('resource').slice(-" + str(args.limit) +
            ").map(x=>({name:x.name,duration:x.duration,bytes:x.transferSize,status:x.responseStatus}))"
            "()" ))
    if args.action in ("key-down", "key-up", "press"):
        def run(c, t):
            if args.action == "press":
                c.key(t, args.code, True)
                try:
                    time.sleep(args.duration)
                finally:
                    c.key(t, args.code, False)
                return {"code": args.code, "duration": args.duration}
            return c.key(t, args.code, args.action == "key-down")
        return page_command(state, name, run)
    if args.action == "click":
        return page_command(state, name, lambda c, t: c.mouse_click(t, args.x, args.y))
    if args.action == "mouse-move":
        return page_command(state, name, lambda c, t: (
            c.mouse_move(t, args.x, args.y), {"x": args.x, "y": args.y}
        )[1])
    if args.action == "wheel":
        return page_command(state, name, lambda c, t: (
            c.wheel(t, args.x, args.y, args.dy, args.dx),
            {"x": args.x, "y": args.y, "deltaY": args.dy, "deltaX": args.dx}
        )[1])
    if args.action == "touch":
        return page_command(state, name, lambda c, t: (
            c.touch(t, args.phase, args.x or 0, args.y or 0),
            {"phase": args.phase, "x": args.x, "y": args.y}
        )[1])
    raise QaError(f"Unsupported command: {args.action}")


def parse_mobile(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    match = re.fullmatch(r"(\d{2,5})[xX](\d{2,5})", value)
    if not match:
        raise QaError("Mobile size must be WIDTHxHEIGHT, e.g. 390x844")
    size = tuple(map(int, match.groups()))
    if not all(100 <= x <= 8192 for x in size):
        raise QaError("Mobile width/height must be between 100 and 8192")
    return size


def add_result(report: dict, case: str, success: bool, detail=None):
    report["checks"].append({"name": case, "pass": bool(success), "detail": detail})
    if not success:
        raise QaError(f"Smoke check failed: {case}: {detail}")


def run_smoke(args):
    """Run a reproducible isolated browser check and always clean up services."""
    folder = own_path("smoke-" + uuid.uuid4().hex[:10])
    output = (Path(args.output_dir).expanduser().resolve() if args.output_dir
              else Path(tempfile.mkdtemp(prefix="forest-chopper-qa-report-")))
    output.mkdir(parents=True, exist_ok=True)
    report = {"version": 1, "kind": "forest-chopper-browser-smoke",
              "model": args.model, "mobile": args.mobile, "multiplayer": args.multiplayer,
              "checks": [], "artifacts": [], "errors": [], "result": "FAIL",
              "report_dir": str(output)}
    started = False
    try:
        state = start_session(folder, args.chrome, args.software_gl,
                              args.no_sandbox, args.multiplayer)
        started = True
        report["http_url"] = f"http://127.0.0.1:{state['http_port']}"
        report["cdp_port"] = state["cdp_port"]
        with CDP(state["cdp_port"]) as cdp:
            # First load the menu so we can set the avatar selection in an
            # isolated localStorage. No user's localStorage is ever accessed.
            menu = cdp.new_page(local_url("/index_debug.html", state["http_port"]))
            target = menu["target"]
            wait_for(lambda: cdp.evaluate(target, "document.readyState === 'complete'"),
                     args.timeout, "menu")
            cdp.evaluate(target, "localStorage.setItem('forest-chopper:character-model:v1',"
                         + json.dumps(args.model) + ")")
            game_url = local_url(
                f"/index_debug.html?type=new&seed={args.seed}&force=true&performance=low&diag=true",
                state["http_port"]
            )
            cdp.navigate(target, game_url)
            wait_for(lambda: cdp.evaluate(target,
                "!!window.__gameDebug && !!document.querySelector('#game') && "
                "!document.querySelector('#game').hidden"),
                args.timeout, "game debug API and 3D scene", interval=.75)
            add_result(report, "game_loaded", True, {
                "model": cdp.evaluate(target, "window.__gameDebug.player.model"),
                "url": game_url
            })
            add_result(report, "selected_character",
                       cdp.evaluate(target, "window.__gameDebug.player.model") == args.model)
            cdp.evaluate(target, "window.__gameDebug.view(false)")
            add_result(report, "first_person",
                       cdp.evaluate(target, "window.__gameDebug.state().camera.thirdPerson") is False)
            cdp.evaluate(target, "window.__gameDebug.view(true)")
            add_result(report, "third_person",
                       cdp.evaluate(target, "window.__gameDebug.state().camera.thirdPerson") is True)
            before = cdp.evaluate(target, "window.__gameDebug.state().position")
            cdp.key(target, "KeyW", True)
            cdp.key(target, "KeyD", True)
            try:
                time.sleep(args.move_seconds)
                during = cdp.evaluate(target, "window.__gameDebug.state()")
            finally:
                cdp.key(target, "KeyW", False)
                cdp.key(target, "KeyD", False)
            after = during["position"]
            delta = {"x": round(after["x"] - before["x"], 3),
                     "z": round(after["z"] - before["z"], 3)}
            add_result(report, "diagonal_movement",
                       delta["x"] > .02 and delta["z"] < -.02,
                       {"delta": delta, "animation": during.get("animation")})
            shot = cdp.screenshot(target, output / "desktop.png")
            report["artifacts"].append(shot)
            errors = cdp.evaluate(target, "window.__browserQaErrors ?? []")
            report["errors"] += [{"page": "desktop", **e} for e in errors]
            add_result(report, "desktop_no_console_errors", not errors, errors[-5:])
            if args.mobile:
                mobile = cdp.new_page(game_url, parse_mobile(args.mobile), args.dpr)
                mt = mobile["target"]
                wait_for(lambda: cdp.evaluate(mt, "!!window.__gameDebug"),
                         args.timeout, "mobile game", interval=.75)
                geometry = cdp.evaluate(mt, """(()=>{
                  const rect=selector=>{const e=document.querySelector(selector);
                    if(!e)return null;const r=e.getBoundingClientRect();
                    return {x:r.x,y:r.y,w:r.width,h:r.height};};
                  return {stick:rect('#stick'),minimap:rect('#minimappanel'),
                          jump:rect('#jump'),hit:rect('#hit'),screen:[innerWidth,innerHeight]};
                })()""")
                add_result(report, "mobile_controls_present",
                           all(geometry.get(k) and geometry[k]["w"] > 0
                               for k in ("stick", "minimap", "jump", "hit")), geometry)
                stick = geometry["stick"]
                sx = int(stick["x"] + stick["w"]/2)
                sy = int(stick["y"] + stick["h"]/2)
                mobile_before = cdp.evaluate(mt, "window.__gameDebug.state().position")
                cdp.touch(mt, "start", sx, sy)
                cdp.touch(mt, "move", sx, sy - min(42, int(stick["h"]*.45)))
                try:
                    time.sleep(args.move_seconds)
                    mobile_during = cdp.evaluate(mt, "window.__gameDebug.state()")
                finally:
                    cdp.touch(mt, "end")
                mobile_delta = mobile_during["position"]["z"] - mobile_before["z"]
                add_result(report, "mobile_touch_movement", mobile_delta < -.02,
                           {"delta_z": round(mobile_delta, 3),
                            "animation": mobile_during.get("animation")})
                shot = cdp.screenshot(mt, output / "mobile.png")
                report["artifacts"].append(shot)
                mobile_errors = cdp.evaluate(mt, "window.__browserQaErrors ?? []")
                report["errors"] += [{"page": "mobile", **e} for e in mobile_errors]
                add_result(report, "mobile_no_console_errors", not mobile_errors,
                           mobile_errors[-5:])
                # Release this resource-intensive WebGL scene before moving
                # to another game mode. Especially important on SwiftShader.
                cdp.call("Target.disposeBrowserContext",
                         {"browserContextId": mobile["context"]})
                cdp.sessions.pop(mt, None)
            if args.multiplayer:
                import urllib.parse
                ws_url = f"ws://127.0.0.1:{state['ws_port']}"
                game_ws_url = local_url("/index_debug.html?type=multiplayer&server="
                        + urllib.parse.quote(ws_url, safe="")
                        + "&name=BrowserQA&performance=low&diag=true", state["http_port"])
                # Navigating an existing WebGL scene can deadlock in software
                # GPU mode. Dispose it and start the online scene in a fresh
                # isolated context instead.
                cdp.call("Target.disposeBrowserContext",
                         {"browserContextId": menu["context"]})
                cdp.sessions.pop(target, None)
                network_page = cdp.new_page(game_ws_url)
                target = network_page["target"]
                wait_for(lambda: cdp.evaluate(target,
                    "!!window.__gameDebug && document.querySelector('#netstatus')?"
                    ".textContent?.includes('Подключено')"),
                    args.timeout, "multiplayer connected", interval=.75)
                with connect(ws_url, open_timeout=8) as peer:
                    welcome = json.loads(peer.recv(timeout=10))
                    player = next((x for x in welcome.get("players", [])
                                   if x.get("name") == "BrowserQA"), None)
                    add_result(report, "multiplayer_welcome", bool(player),
                               {"players": len(welcome.get("players", []))})
                    cdp.key(target, "KeyW", True)
                    cdp.key(target, "KeyD", True)
                    moves = []
                    try:
                        end = time.monotonic() + max(12, args.move_seconds * 6)
                        while time.monotonic() < end and len(moves) < 3:
                            try:
                                message = json.loads(peer.recv(timeout=3))
                            except TimeoutError:
                                continue
                            if message.get("type") == "move" and message.get("id") == player["id"]:
                                moves.append(message)
                    finally:
                        cdp.key(target, "KeyW", False)
                        cdp.key(target, "KeyD", False)
                    add_result(report, "multiplayer_pose_forwarded",
                               any(isinstance(x.get("torsoYaw"), (int, float))
                                   and x.get("motion") in ("Walk", "Run")
                                   for x in moves), {"moves": len(moves)})
                network_errors = cdp.evaluate(target, "window.__browserQaErrors ?? []")
                report["errors"] += [{"page": "multiplayer", **e} for e in network_errors]
                add_result(report, "multiplayer_no_console_errors", not network_errors,
                           network_errors[-5:])
                report["artifacts"].append(cdp.screenshot(target, output / "multiplayer.png"))
        report["result"] = "PASS"
    except BaseException as error:
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        if started:
            if report["result"] != "PASS":
                # Keep service logs for post-mortem debugging; a failed smoke
                # must not leave Chrome or the test world running.
                for source in ("chrome.log", "http.log", "websocket.log"):
                    if (folder / source).exists():
                        with contextlib.suppress(OSError):
                            shutil.copy2(folder / source, output / source)
                            report["artifacts"].append({"file": str(output / source)})
            with contextlib.suppress(Exception):
                stop_session(folder)
        path = output / "report.json"
        report["report_file"] = str(path)
        write_json(path, report)
    return report


def make_parser():
    p = argparse.ArgumentParser(description="Isolated Chrome CDP automation for Forest Chopper")
    p.add_argument("--session", default="default", help="Session name (default: default)")
    sub = p.add_subparsers(dest="action", required=True)
    start = sub.add_parser("start", help="Start isolated Chrome and HTTP server")
    start.add_argument("--chrome", help="Chrome/Chromium executable")
    start.add_argument("--software-gl", action="store_true", help="Use software WebGL fallback")
    start.add_argument("--no-sandbox", action="store_true",
                       help="Unsafe: disable browser sandbox (only in trusted test environment)")
    start.add_argument("--game-server", action="store_true",
                       help="Start separate WebSocket server with a temporary world")
    sub.add_parser("stop", help="Stop ONLY processes owned by this session")
    sub.add_parser("status", help="Print service status, local ports and page IDs")
    op = sub.add_parser("open", help="Open page in new isolated browser context")
    op.add_argument("url", help="Relative path or http(s) URL")
    op.add_argument("--page", default="main")
    op.add_argument("--mobile", help="Mobile viewport, e.g. 390x844")
    op.add_argument("--dpr", type=float, default=2)
    nav = sub.add_parser("navigate", help="Navigate an existing page")
    nav.add_argument("url")
    nav.add_argument("--page", default="main")
    nav.add_argument("--fresh-context", action="store_true",
                     help="Replace only the test context; bypass active game beforeunload "
                          "(resets its isolated localStorage)")
    close = sub.add_parser("close", help="Close a test page and its isolated context")
    close.add_argument("--page", default="main")
    eva = sub.add_parser("eval", help="Evaluate JavaScript expression (return JSON)")
    eva.add_argument("expression", nargs="?", default=None)
    eva.add_argument("--file", help="Read JavaScript expression from file")
    eva.add_argument("--page", default="main")
    script = sub.add_parser("script", help="Execute a JavaScript file as async function body")
    script.add_argument("file")
    script.add_argument("--timeout", type=float, default=35)
    script.add_argument("--page", default="main")
    wait = sub.add_parser("wait", help="Wait until a JavaScript expression is truthy")
    wait.add_argument("expression")
    wait.add_argument("--timeout", type=float, default=90)
    wait.add_argument("--interval", type=float, default=.5)
    wait.add_argument("--page", default="main")
    shot = sub.add_parser("screenshot", help="Write PNG screenshot")
    shot.add_argument("file")
    shot.add_argument("--page", default="main")
    for name in ("console", "errors", "resources"):
        sp = sub.add_parser(name, help="Recent page messages or ResourceTiming entries")
        sp.add_argument("--limit", type=int, default=30)
        sp.add_argument("--page", default="main")
    for name in ("key-down", "key-up", "press"):
        sp = sub.add_parser(name, help="Send keyboard input")
        sp.add_argument("code", help="e.g. KeyW, ShiftLeft, Space")
        sp.add_argument("--page", default="main")
        if name == "press":
            sp.add_argument("--duration", type=float, default=.15)
    for command in ("click", "mouse-move", "wheel"):
        mouse = sub.add_parser(command, help="Send viewport mouse input")
        mouse.add_argument("x", type=int)
        mouse.add_argument("y", type=int)
        mouse.add_argument("--page", default="main")
        if command == "wheel":
            mouse.add_argument("dy", type=int)
            mouse.add_argument("--dx", type=int, default=0)
    touch = sub.add_parser("touch", help="Touch start/move/end (keep same page)")
    touch.add_argument("phase", choices=["start", "move", "end"])
    touch.add_argument("x", type=int, nargs="?")
    touch.add_argument("y", type=int, nargs="?")
    touch.add_argument("--page", default="main")
    smoke = sub.add_parser("smoke", help="Run unattended game QA; stop everything afterwards")
    smoke.add_argument("--chrome")
    smoke.add_argument("--software-gl", action="store_true")
    smoke.add_argument("--no-sandbox", action="store_true")
    smoke.add_argument("--model", choices=["legacy", "male", "female"], default="male")
    smoke.add_argument("--seed", type=int, default=123)
    smoke.add_argument("--mobile", default=None, help="Add independent 390x844 mobile context")
    smoke.add_argument("--dpr", type=float, default=2)
    smoke.add_argument("--multiplayer", action="store_true")
    smoke.add_argument("--timeout", type=float, default=120)
    smoke.add_argument("--move-seconds", type=float, default=2)
    smoke.add_argument("--output-dir", help="Screenshots and report.json; default unique /tmp")
    return p


def main(argv=None):
    parser = make_parser()
    args = parser.parse_args(argv)
    try:
        if args.action == "smoke":
            result = run_smoke(args)
        else:
            folder = own_path(args.session)
            if args.action == "start":
                state = start_session(folder, args.chrome, args.software_gl,
                                      args.no_sandbox, args.game_server)
                result = {"session": str(folder),
                          "http_url": f"http://127.0.0.1:{state['http_port']}",
                          "cdp_port": state["cdp_port"], "ws_port": state["ws_port"]}
            elif args.action == "stop":
                result = stop_session(folder)
            else:
                result = state_command(folder, args)
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
        return 2 if isinstance(result, dict) and result.get("result") == "FAIL" else 0
    except (QaError, OSError, ValueError, TimeoutError) as error:
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False),
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
