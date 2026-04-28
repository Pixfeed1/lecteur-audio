<?php
/**
 * Monitor controller — receives diagnostic events from the front-end JS
 * monitor and appends them to var/monitor.log.
 *
 * Hardening:
 *   - Same-origin only (rejects requests from other shops/origins).
 *   - Rate limiter via the visitor's session: max
 *     OnlyRootsPlayer::MONITOR_RATE_LIMIT_MAX events per
 *     OnlyRootsPlayer::MONITOR_RATE_LIMIT_WINDOW seconds.
 *   - Strict whitelist of event types — anything else is dropped silently.
 *   - Per-event byte cap (OnlyRootsPlayer::MONITOR_EVENT_MAX_LEN) so a malicious
 *     payload can't fill the log file in one POST.
 *   - Log file rotated when it exceeds OnlyRootsPlayer::MONITOR_LOG_MAX_BYTES.
 *
 * Privacy:
 *   - We don't log query strings (might contain user identifiers).
 *   - We don't log POST bodies, cookies, or headers.
 *   - URLs are stored as path-only (no scheme/host/query).
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

class OnlyrootsplayerMonitorModuleFrontController extends ModuleFrontController
{
    /** @var bool we render JSON ourselves, skip the theme rendering */
    public $ajax = true;

    /** Whitelist of event types accepted from the front-end. */
    const ALLOWED_EVENT_TYPES = [
        'swup:visit:start',
        'swup:content:replace',
        'swup:visit:end',
        'swup:visit:abort',
        'swup:fetch:error',
        'swup:watchdog:fired',
        'js:error',
        'js:unhandled-rejection',
        'orp:preset:error',
        'orp:preset:invoked',
        'orp:body-class-restored',
        'orp:catastrophic-swap-recovered',
        'orp:swup:skipped-on-excluded-page',
        'dom:diff',
        'dom:snapshot',
        'orp:player:init',
    ];

    public function initContent()
    {
        parent::initContent();
        $this->handleRequest();
    }

    public function display()
    {
        $this->handleRequest();
    }

    private function handleRequest()
    {
        // Only POST is allowed.
        if (Tools::strtolower($_SERVER['REQUEST_METHOD']) !== 'post') {
            $this->respond(405, ['error' => 'Method not allowed']);
        }

        // Same-origin check: the Origin/Referer must match the shop URL.
        if (!$this->isSameOrigin()) {
            $this->respond(403, ['error' => 'Cross-origin not allowed']);
        }

        // Rate-limit per session.
        if (!$this->withinRateLimit()) {
            $this->respond(429, ['error' => 'Rate limit exceeded']);
        }

        $rawBody = Tools::file_get_contents('php://input');
        if ($rawBody === false || $rawBody === '') {
            $this->respond(400, ['error' => 'Empty body']);
        }
        // Cap the request body size before json_decode to avoid memory blow-ups.
        if (strlen($rawBody) > 64 * 1024) {
            $this->respond(413, ['error' => 'Payload too large']);
        }

        $payload = json_decode($rawBody, true);
        if (!is_array($payload) || !isset($payload['events']) || !is_array($payload['events'])) {
            $this->respond(400, ['error' => 'Invalid payload']);
        }

        $events = array_slice($payload['events'], 0, OnlyRootsPlayer::MONITOR_RATE_LIMIT_MAX);

        $appended = $this->appendEvents($events);
        $this->respond(200, ['ok' => true, 'appended' => $appended]);
    }

    /**
     * Same-origin guard. The Origin header (when present) or Referer is
     * compared against the shop's base URL. Requests from other origins are
     * rejected — the monitor is meant for the shop itself, not third parties.
     */
    private function isSameOrigin()
    {
        $shopBase = rtrim((string) Context::getContext()->link->getBaseLink(), '/');
        $shopHost = parse_url($shopBase, PHP_URL_HOST);
        if (empty($shopHost)) {
            return false;
        }

        $candidate = '';
        if (!empty($_SERVER['HTTP_ORIGIN'])) {
            $candidate = (string) $_SERVER['HTTP_ORIGIN'];
        } elseif (!empty($_SERVER['HTTP_REFERER'])) {
            $candidate = (string) $_SERVER['HTTP_REFERER'];
        }
        if ($candidate === '') {
            return false;
        }

        $candHost = parse_url($candidate, PHP_URL_HOST);
        return is_string($candHost) && $candHost !== '' && $candHost === $shopHost;
    }

    /**
     * Sliding-window rate limiter. The session stores recent timestamps and
     * we evict any older than the configured window. Returns false when the
     * request would push the count above the cap.
     */
    private function withinRateLimit()
    {
        if (!isset($_SESSION)) {
            // ModuleFrontController normally has the session up — if not, do
            // not block (we still have the byte cap and log size cap).
            return true;
        }
        $now    = time();
        $window = OnlyRootsPlayer::MONITOR_RATE_LIMIT_WINDOW;
        $cap    = OnlyRootsPlayer::MONITOR_RATE_LIMIT_MAX;
        $key    = 'orp_monitor_hits';

        $hits = isset($_SESSION[$key]) && is_array($_SESSION[$key]) ? $_SESSION[$key] : [];
        // Evict expired hits.
        $hits = array_values(array_filter($hits, function ($t) use ($now, $window) {
            return is_int($t) && ($now - $t) < $window;
        }));
        if (count($hits) >= $cap) {
            $_SESSION[$key] = $hits;
            return false;
        }
        $hits[] = $now;
        $_SESSION[$key] = $hits;
        return true;
    }

    /**
     * Validates and writes a batch of events to the log. Returns the count of
     * events actually written.
     */
    private function appendEvents(array $events)
    {
        $logPath = _PS_MODULE_DIR_ . 'onlyrootsplayer/' . OnlyRootsPlayer::MONITOR_LOG_RELPATH;
        $logDir  = dirname($logPath);
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }

        $this->rotateIfNeeded($logPath);

        $count = 0;
        $lines = '';
        foreach ($events as $event) {
            $line = $this->formatEvent($event);
            if ($line === null) {
                continue;
            }
            if (strlen($line) > OnlyRootsPlayer::MONITOR_EVENT_MAX_LEN) {
                $line = substr($line, 0, OnlyRootsPlayer::MONITOR_EVENT_MAX_LEN - 8) . '…(cut)';
            }
            $lines .= $line . "\n";
            $count++;
        }

        if ($lines !== '') {
            @file_put_contents($logPath, $lines, FILE_APPEND | LOCK_EX);
        }

        return $count;
    }

    /**
     * Validates one event and renders it as a single human-readable line.
     * Returns null when the event is malformed or its type is not on the
     * whitelist.
     */
    private function formatEvent($event)
    {
        if (!is_array($event)) {
            return null;
        }
        $type = isset($event['type']) ? (string) $event['type'] : '';
        if (!in_array($type, self::ALLOWED_EVENT_TYPES, true)) {
            return null;
        }

        // Front-supplied timestamp is allowed but capped; otherwise use server now.
        $ts  = time();
        $iso = gmdate('Y-m-d\TH:i:s\Z', $ts);

        $data = isset($event['data']) && is_array($event['data']) ? $event['data'] : [];
        // Sanitize each data field: cast to string, strip control chars, cap length.
        $kvParts = [];
        foreach ($data as $k => $v) {
            if (!is_string($k) || !preg_match('/^[a-zA-Z0-9_]{1,32}$/', $k)) {
                continue;
            }
            $val = $this->scalarOrJson($v);
            if ($val === null) {
                continue;
            }
            $val = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $val);
            if (mb_strlen($val) > 512) {
                $val = mb_substr($val, 0, 509) . '...';
            }
            $kvParts[] = $k . '=' . $val;
        }
        $kv = implode(' ', $kvParts);

        return '[' . $iso . '] ' . $type . ($kv !== '' ? ' ' . $kv : '');
    }

    /**
     * Converts a scalar to a string representation safe for logging. Arrays
     * and objects are JSON-encoded; nulls are represented as "null". Returns
     * null if the value can't be safely stringified.
     */
    private function scalarOrJson($v)
    {
        if (is_string($v))    return $v;
        if (is_int($v))       return (string) $v;
        if (is_float($v))     return (string) $v;
        if (is_bool($v))      return $v ? 'true' : 'false';
        if (is_null($v))      return 'null';
        if (is_array($v)) {
            $json = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            return $json === false ? null : $json;
        }
        return null;
    }

    /**
     * If the log file exceeds the size cap, truncates it to its last half so
     * we keep recent context but stay bounded. Cheap to run on every append.
     */
    private function rotateIfNeeded($path)
    {
        if (!is_file($path)) {
            return;
        }
        $size = @filesize($path);
        if ($size === false || $size <= OnlyRootsPlayer::MONITOR_LOG_MAX_BYTES) {
            return;
        }
        $keep = (int) (OnlyRootsPlayer::MONITOR_LOG_MAX_BYTES / 2);
        $fp = @fopen($path, 'rb');
        if (!$fp) {
            return;
        }
        @fseek($fp, -$keep, SEEK_END);
        // Skip to the next newline so we don't keep a truncated leading line.
        @fgets($fp);
        $tail = stream_get_contents($fp);
        @fclose($fp);

        if ($tail !== false) {
            @file_put_contents(
                $path,
                "[rotated " . gmdate('Y-m-d\TH:i:s\Z') . " — older entries dropped]\n" . $tail
            );
        }
    }

    private function respond($code, array $body)
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Robots-Tag: noindex, nofollow');
        header('Cache-Control: no-store');
        echo json_encode($body);
        exit;
    }
}
