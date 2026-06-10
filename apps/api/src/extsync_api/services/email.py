"""Email sending (SMTP). Dev uses Mailpit (localhost:1025, no TLS).

Templates are intentionally simple, plain Hebrew text + an HTML variant. We send
via smtplib in a worker thread to avoid blocking the event loop, and we never log
the message body or any token.
"""
from __future__ import annotations

import asyncio
import json
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage

from ..config import settings
from ..logging import get_logger

logger = get_logger("extsync.email")


def _send_via_resend_http(to: str, subject: str, text_body: str, html_body: str | None) -> None:
    """Send through Resend's HTTPS API (port 443) — bypasses SMTP port blocks."""
    payload: dict = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
            # Cloudflare (in front of api.resend.com) returns 403/1010 for the default
            # "Python-urllib" UA, so send an explicit one.
            "User-Agent": "ExtSync/1.0 (+https://extsync.com)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status >= 300:
                raise RuntimeError(f"resend api returned status {resp.status}")
    except urllib.error.HTTPError as e:  # surface the API error body for diagnosis
        raise RuntimeError(f"resend api error {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from e


def _send_sync(msg: EmailMessage) -> None:
    # Port 465 = implicit TLS (SMTP_SSL); 587/others = plaintext + optional STARTTLS.
    if settings.smtp_port == 465:
        smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
        if settings.smtp_use_tls:
            smtp.starttls()
    with smtp:
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    try:
        if settings.resend_api_key:
            await asyncio.to_thread(_send_via_resend_http, to, subject, text_body, html_body)
        else:
            await asyncio.to_thread(_send_sync, msg)
        logger.info("email sent to=%s subject=%s", to, subject)
    except Exception:
        # Never crash the request because email failed; surface in logs + retry later.
        logger.exception("failed to send email to=%s subject=%s", to, subject)
        raise


def _layout(title: str, body_html: str) -> str:
    return (
        f'<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;max-width:520px;'
        f'margin:0 auto;color:#1f2937">'
        f'<h2 style="color:#111827">{title}</h2>{body_html}'
        f'<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">'
        f'<p style="font-size:12px;color:#6b7280">ExtSync — ניהול תוספי Chrome פרטיים</p></div>'
    )


async def send_verification_email(to: str, verify_url: str) -> None:
    text = (
        f"ברוכים הבאים ל-ExtSync!\n\n"
        f"כדי לאמת את כתובת האימייל, פתחו את הקישור הבא:\n{verify_url}\n\n"
        f"הקישור תקף ל-24 שעות. אם לא נרשמתם, אפשר להתעלם מההודעה."
    )
    html = _layout(
        "אימות כתובת האימייל",
        f'<p>תודה שנרשמתם. כדי להפעיל את החשבון, אשרו את כתובת האימייל:</p>'
        f'<p><a href="{verify_url}" style="background:#2563eb;color:#fff;padding:10px 18px;'
        f'border-radius:8px;text-decoration:none">אימות האימייל</a></p>'
        f'<p style="font-size:13px;color:#6b7280">הקישור תקף ל-24 שעות.</p>',
    )
    await send_email(to, "אימות כתובת האימייל ב-ExtSync", text, html)


async def send_password_reset_email(to: str, reset_url: str) -> None:
    text = (
        f"קיבלנו בקשה לאיפוס סיסמה.\n\n"
        f"לאיפוס הסיסמה פתחו את הקישור:\n{reset_url}\n\n"
        f"הקישור תקף לשעה. אם לא ביקשתם איפוס, אפשר להתעלם."
    )
    html = _layout(
        "איפוס סיסמה",
        f'<p>לאיפוס הסיסמה לחצו על הכפתור:</p>'
        f'<p><a href="{reset_url}" style="background:#2563eb;color:#fff;padding:10px 18px;'
        f'border-radius:8px;text-decoration:none">איפוס סיסמה</a></p>'
        f'<p style="font-size:13px;color:#6b7280">הקישור תקף לשעה אחת.</p>',
    )
    await send_email(to, "איפוס סיסמה ב-ExtSync", text, html)
