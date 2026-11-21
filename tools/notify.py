"""排程與部署失敗告警通知工具：支援通用 Webhook（Discord / Slack）與 Telegram Bot。"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import socket
import sys
import urllib.error
import urllib.request


def build_alert_payload(title: str, message: str, host: str | None = None) -> dict[str, str]:
    """組裝同時相容 Discord (`content`) 與 Slack / 一般 Webhook (`text`) 的 JSON 負載。"""
    node = host or socket.gethostname()
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    body = f'[{node} · {stamp}] {title}\n{message}'.strip()
    return {'title': title, 'content': body, 'text': body}


def _post_json(url: str, payload: dict[str, object], timeout: float = 8.0) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'ExitPulse-Notify/1.4'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read()


def send_alert(title: str, message: str, timeout: float = 8.0) -> bool:
    """依據環境變數發送告警；未設定或失敗時回傳 False，絕不拋錯遮蔽主程序。"""
    webhook = os.environ.get('EXITPULSE_ALERT_WEBHOOK', '').strip()
    tg_token = os.environ.get('EXITPULSE_TELEGRAM_BOT_TOKEN', '').strip()
    tg_chat = os.environ.get('EXITPULSE_TELEGRAM_CHAT_ID', '').strip()
    if not webhook and not (tg_token and tg_chat):
        return False

    payload = build_alert_payload(title, message)
    sent = False
    if webhook:
        try:
            _post_json(webhook, payload, timeout=timeout)
            sent = True
        except (urllib.error.URLError, OSError) as exc:
            print(f'[notify] webhook failed: {exc}', file=sys.stderr)

    if tg_token and tg_chat:
        try:
            tg_url = f'https://api.telegram.org/bot{tg_token}/sendMessage'
            _post_json(tg_url, {'chat_id': tg_chat, 'text': payload['text']}, timeout=timeout)
            sent = True
        except (urllib.error.URLError, OSError) as exc:
            print(f'[notify] telegram failed: {exc}', file=sys.stderr)

    return sent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Send ExitPulse operational alert notification')
    parser.add_argument('--title', required=True, help='Alert summary title')
    parser.add_argument('--message', default='', help='Detailed failure message')
    args = parser.parse_args(argv)
    send_alert(args.title, args.message)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
