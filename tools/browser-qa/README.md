# Browser QA — Chrome без Chrome DevTools MCP

Самостоятельный Python CLI для работы с **Chrome DevTools Protocol (CDP)**
через **Terminal MCP**. Не нужен Chrome DevTools MCP, Selenium, Playwright,
дополнительный Node.js-сервер или доступ к пользовательским вкладкам.

Инструмент запускает отдельный headless Chrome, собственный каталог профиля,
новые изолированные BrowserContext (включая независимый localStorage),
HTTP-сервер только на `127.0.0.1` и, по запросу, отдельный Python WebSocket-мир.

## Требования

- Python 3.11+, Chrome/Chromium и Python-модуль `websockets>=13,<17`
  (он уже нужен игровому Python-серверу).
- Из корня Forest Chopper:

```bash
python3 -m pip install -r requirements.txt
python3 tools/browser-qa/browser_qa.py --help
```

Если Chrome sandbox не запускается, добавьте **`--no-sandbox`**
к `start`/`smoke`. Флаг снижает изоляцию браузера: использовать
только для доверенного локального проекта. В виртуализованном окружении
можно также включить `--software-gl`; его FPS **не отражает**
производительность настоящего GPU.

## Быстрая автономная приёмка

```bash
# Собственный Chrome, HTTP-сервер, новый изолированный offline-слот.
# После проверки всё выключается. На выходе JSON PASS/FAIL;
# screenshots и report.json остаются в уникальной директории /tmp.
python3 tools/browser-qa/browser_qa.py smoke --model male \
  --no-sandbox --software-gl

# Более тяжёлая приёмка с мобильными touch-событиями и отдельным
# Python WebSocket-сервером со своим временным save.
python3 tools/browser-qa/browser_qa.py smoke --model female \
  --mobile 390x844 --multiplayer --no-sandbox --software-gl \
  --output-dir /tmp/forest-chopper-qa-my-run
```

Smoke проверяет загрузку 3D-игры, выбранного персонажа, 1P/3P,
перемещение W+D, ошибки JS, создаёт desktop screenshot. При `--mobile`
проверяет наличие touch-кнопок и **реальный** drag джойстика, сохраняет
mobile screenshot; при `--multiplayer` — подключение браузера к отдельному
серверу и пересылку position/pose `move` независимому WebSocket-пиру.

Состояние и артефакты возвращаются в JSON. CLI завершится с **кодом 2**
при проваленном утверждении или ошибке. Отчёт содержит точный список
проверок и ошибки; скриншоты можно открыть с локального компьютера.
Headless/software-WebGL не заменяет визуальную приёмку на реальной GPU.

## Интерактивные команды — альтернатива DevTools MCP

Каждая команда — один вызов Terminal MCP; при этом Chrome и вкладки
**живут между вызовами**, пока не выполнен `stop`.

```bash
QA="python3 tools/browser-qa/browser_qa.py --session agent"

$QA start --no-sandbox --software-gl
$QA open 'index_debug.html?type=new&seed=123&force=true&performance=low&diag=true'
$QA wait '!!window.__gameDebug' --timeout 120
$QA eval 'window.__gameDebug.state()'
$QA press KeyW --duration 2
$QA mouse-move 300 200
$QA wheel 300 200 -120
$QA key-down KeyW
$QA key-down KeyD
$QA eval 'window.__gameDebug.state().position'
$QA key-up KeyW
$QA key-up KeyD
$QA eval 'window.__gameDebug.fpsStats?.() ?? null'
$QA screenshot /tmp/forest-chopper-desktop.png
$QA console
$QA errors
$QA resources --limit 20
$QA status
$QA close
$QA stop
```

Для независимого мобильного контекста:

```bash
$QA open 'index_debug.html?type=new&seed=123&force=true&performance=low&diag=true' \
  --page mobile --mobile 390x844 --dpr 2
$QA wait '!!window.__gameDebug' --page mobile --timeout 120
$QA touch start 68 617 --page mobile
$QA touch move 68 575 --page mobile
$QA eval 'window.__gameDebug.state().animation' --page mobile
$QA touch end --page mobile
$QA screenshot /tmp/forest-chopper-mobile.png --page mobile
$QA close --page mobile
```

Для сложной логики вместо многих вызовов:

```bash
$QA eval '(()=>({fps:window.__gameDebug.fpsStats(), state:window.__gameDebug.state()}))()'
$QA eval --file /tmp/my-expression.js
$QA script /tmp/my-assertions.js  # тело async-функции; допускается await/return
```

`eval` возвращает JSON-значение JavaScript expression. `script` выполняет
содержимое файла как тело `async () => {...}`. JS-исключения вызывают
ненулевой exit code; можно использовать `throw Error(...)` для assert.

`console` показывает накопленные `console.log/info/warn/error/debug`
и ошибки, ограниченные последними 200 записями на страницу. `resources`
читает Resource Timing (не полноценный HAR/Network trace).

**Важно при смене игровой сцены:** Forest Chopper намеренно блокирует
`beforeunload`. Если нужна новая игра в той же именованной тестовой вкладке,
используйте `$QA navigate 'index_debug.html?...' --fresh-context` —
только тестовый BrowserContext будет заменён (включая его localStorage),
пользовательские вкладки не затрагиваются. Обычный `navigate` сохраняет
localStorage, но может ожидать браузерного подтверждения ухода из игры.

### Несколько вкладок и общий сервер

```bash
$QA start --game-server --no-sandbox
$QA status  # выведет ws_port с отдельным миром в /tmp
$QA open index_debug.html --page player1
$QA open index_debug.html --page player2
# ... подключаем оба клиента через GUI/скрипт, используя ws_port из status
$QA stop
```

Вкладки `player1` и `player2` **не разделяют localStorage**. `close`
удаляет только выбранный test BrowserContext. `stop` проверяет командную
строку PID перед сигналом и останавливает **только** свои процессы.

## Правила и ограничения

- **Никогда не открывать offline-save пользователя** для разрушающих тестов.
  `type=new&force=true` допустим только в изолированном профиле инструмента.
- Не подключать тесты ударов/построек к публичному серверу.
  `start --game-server` и `smoke --multiplayer` создают уникальный save в
  каталоге тестовой сессии.
- CDP доступен только по loopback, с ограниченным Origin.
- После `smoke` все собственные процессы останавливаются в `finally`.
  После интерактивной сессии **не забыть `$QA stop`**.
- В недоверенных условиях лучше использовать Chrome sandbox.
- Chrome/CDP API могут меняться: после обновления браузера повторять unit/smoke.

## Тесты

```bash
python3 -m unittest discover -s tools/browser-qa -v
python3 tools/browser-qa/browser_qa.py smoke --model male --no-sandbox --software-gl
```

По умолчанию unit-тесты не запускают браузер. Реальный smoke требует
локальных GLB, загрузки Three.js из CDN и работает существенно дольше.
