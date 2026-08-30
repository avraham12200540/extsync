"""Static scan for network-control and filter-bypass capability.

WHAT THIS IS FOR
ExtSync distributes extensions to a filtered network, so the question a reviewer
actually needs answered is narrower and more specific than "is this malware":

    can this extension move traffic somewhere the filter cannot see it?

That is what this module looks for - proxy configuration, tunnelling protocols,
request interception and redirection, encrypted DNS, and native code that leaves
the browser sandbox entirely.

WHAT THIS IS NOT
It is NOT a gate, and it must never become one. Signals are advisory input to a
human decision:

  * A false positive must not block a legitimate extension. Plenty of honest
    extensions use webRequest or declarativeNetRequest, and `proxy` appears in
    perfectly innocent code.
  * A clean scan must never be read as "safe to approve". Static analysis loses
    to obfuscation, remote configuration and staged payloads. Silence here means
    "nothing matched these patterns", nothing more.

So nothing in this module returns a verdict. It returns evidence, with the file
and a short excerpt, so a person can look at the actual code and decide. That is
also why signals are kept out of ValidationResult.findings: findings with
severity=error REJECT a build automatically, and "this extension can configure a
proxy" is not something to auto-reject.

PATTERN DISCIPLINE
Patterns are written to be specific rather than broad, because a scanner that
cries wolf gets ignored, and an ignored scanner is worse than none:

  * `chrome.proxy`, not bare "proxy" (JS has a builtin `Proxy`, and "proxy"
    appears constantly in ordinary code).
  * `.filter(` is one of the most common calls in JavaScript, so filtering
    terminology is only ever reported at `info`, with an excerpt.
  * Protocol names (`vmess`, `shadowsocks`) are matched on word boundaries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Ordered strongest-first; a reviewer reads the top of the list.
CRITICAL = "critical"   # direct traffic redirection capability
HIGH = "high"           # can intercept/rewrite requests, or leave the sandbox
MEDIUM = "medium"       # worth a look in context
INFO = "info"           # noted, very often benign

_LEVEL_ORDER = {CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3}

#: Bumped whenever the patterns or the calibration change, so a stored report
#: can be told apart from one produced by an older scanner - and from one
#: produced before the scanner existed at all.
SCANNER_VERSION = 2


@dataclass
class RiskSignal:
    code: str
    level: str
    title: str          # Hebrew, shown to the administrator
    detail: str         # why this matters for a filtered network
    file: str | None = None
    evidence: str | None = None   # short excerpt of the actual match

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code, "level": self.level, "title": self.title,
            "detail": self.detail, "file": self.file, "evidence": self.evidence,
        }


# --------------------------------------------------------------------------- manifest

#: Permissions that hand an extension real control over network traffic.
#: value = (level, Hebrew title, why it matters)
_PERMISSION_SIGNALS: dict[str, tuple[str, str, str]] = {
    "proxy": (CRITICAL, "הרשאת proxy",
              "מאפשרת לתוסף להגדיר שרת proxy לדפדפן ולנתב דרכו את כל התעבורה."),
    "webRequestBlocking": (HIGH, "חסימת ושינוי בקשות רשת",
                           "מאפשרת ליירט בקשות רשת ולשנות או לחסום אותן לפני שנשלחות."),
    "declarativeNetRequest": (HIGH, "שינוי בקשות רשת (DNR)",
                              "מאפשרת להגדיר כללים שמפנים או חוסמים בקשות רשת."),
    "declarativeNetRequestWithHostAccess": (
        HIGH, "שינוי בקשות רשת עם גישה לדומיינים",
        "כמו DNR, עם גישה רחבה יותר לדומיינים."),
    "webRequest": (MEDIUM, "צפייה בבקשות רשת",
                   "מאפשרת לראות את כל בקשות הרשת של המשתמש."),
    "debugger": (HIGH, "הרשאת debugger",
                 "גישה לפרוטוקול הניפוי של Chrome - שליטה כמעט מלאה בדפדפן."),
    "dns": (MEDIUM, "גישת DNS", "מאפשרת שאילתות DNS ישירות."),
    "privacy": (MEDIUM, "שינוי הגדרות פרטיות",
                "מאפשרת לשנות הגדרות רשת ופרטיות של הדפדפן."),
    "management": (MEDIUM, "ניהול תוספים אחרים",
                   "מאפשרת להשבית או להסיר תוספים אחרים, כולל תוספי אבטחה."),
}

_BROAD_HOSTS = {"<all_urls>", "*://*/*", "http://*/*", "https://*/*", "*://*"}


def scan_manifest(permissions: Any, manifest: dict, *,
                  bridge_injected: bool = False) -> list[RiskSignal]:
    """Signals derivable from the manifest alone.

    `bridge_injected` says ExtSync's own auto-update bridge is present. That
    matters because ExtSync ADDS `nativeMessaging` to every extension it
    packages, so reporting it would mean flagging the platform's own mechanism
    on essentially the entire store. Measured before this exemption: 45 of 46
    live releases came out `high`, all on this one permission. A scanner that
    fires on everything is one nobody reads.
    """
    out: list[RiskSignal] = []

    declared = set(getattr(permissions, "permissions", []) or [])
    optional = set(getattr(permissions, "optional_permissions", []) or [])
    for perm in sorted(declared | optional):
        sig = _PERMISSION_SIGNALS.get(perm)
        if sig is None:
            continue
        level, title, detail = sig
        # An OPTIONAL permission is requested at runtime, which is quieter for the
        # user and therefore not less interesting - just noted as such.
        suffix = "" if perm in declared else " (הרשאה אופציונלית, מתבקשת בזמן ריצה)"
        out.append(RiskSignal(
            code=f"PERM_{perm.upper()}", level=level, title=title + suffix,
            detail=detail, evidence=f"permissions: {perm}",
        ))

    if not bridge_injected and (
        "nativeMessaging" in declared or "nativeMessaging" in optional
    ):
        out.append(RiskSignal(
            code="PERM_NATIVEMESSAGING", level=HIGH,
            title="הרצת תוכנה מחוץ לדפדפן",
            detail="מאפשרת לתקשר עם תוכנה מותקנת במחשב, מחוץ לארגז החול של הדפדפן ומחוץ למגבלות שלו.",
            evidence="permissions: nativeMessaging",
        ))

    hosts = list(getattr(permissions, "host_permissions", []) or [])
    broad = [h for h in hosts if h in _BROAD_HOSTS]
    if broad:
        out.append(RiskSignal(
            code="HOST_ALL_URLS", level=HIGH, title="גישה לכל האתרים",
            detail="התוסף מבקש גישה לכל כתובת שהמשתמש גולש אליה.",
            evidence=", ".join(broad[:5]),
        ))

    matches = list(getattr(permissions, "content_scripts_matches", []) or [])
    broad_cs = [m for m in matches if m in _BROAD_HOSTS]
    if broad_cs:
        out.append(RiskSignal(
            code="CONTENT_SCRIPT_ALL_URLS", level=MEDIUM,
            title="סקריפט תוכן בכל האתרים",
            detail="התוסף מריץ קוד בכל דף שהמשתמש פותח.",
            evidence=", ".join(broad_cs[:5]),
        ))

    ext_conn = getattr(permissions, "externally_connectable", None)
    if isinstance(ext_conn, dict):
        ids = [str(x) for x in (ext_conn.get("ids") or [])]
        ext_matches = [str(x) for x in (ext_conn.get("matches") or [])]
        wild = [x for x in ids + ext_matches if "*" in x]
        if wild:
            out.append(RiskSignal(
                code="EXTERNALLY_CONNECTABLE_WILDCARD", level=MEDIUM,
                title="ניתן לשליטה מאתרים חיצוניים",
                detail="אתרים חיצוניים יכולים לשלוח הודעות לתוסף ולהפעיל אותו.",
                evidence=", ".join(wild[:5]),
            ))

    war = list(getattr(permissions, "web_accessible_resources", []) or [])
    if war:
        out.append(RiskSignal(
            code="WEB_ACCESSIBLE_RESOURCES", level=INFO,
            title="קבצים נגישים לדפי אינטרנט",
            detail="קבצים מתוך התוסף נגישים לדפים חיצוניים.",
            evidence=", ".join(war[:5]),
        ))

    if manifest.get("declarative_net_request"):
        rules = manifest["declarative_net_request"].get("rule_resources") or []
        out.append(RiskSignal(
            code="DNR_STATIC_RULES", level=MEDIUM,
            title="כללי הפניה קבועים (DNR)",
            detail="התוסף מגיע עם קובצי כללים שמשנים או מפנים בקשות רשת. "
                   "יש לבדוק את תוכן קובצי הכללים עצמם.",
            evidence=", ".join(str(r.get("path", "")) for r in rules[:5]),
        ))

    return out


# ------------------------------------------------------------------------------ code

# Each entry: (code, level, compiled pattern, Hebrew title, why it matters).
# Patterns are deliberately narrow - see the module docstring on false positives.
_CODE_PATTERNS: list[tuple[str, str, re.Pattern[str], str, str]] = [
    ("CODE_PROXY_API", CRITICAL,
     re.compile(r"\b(?:chrome|browser)\.proxy\b"),
     "שימוש ב-API של proxy",
     "הקוד מגדיר או משנה את הגדרות ה-proxy של הדפדפן."),
    ("CODE_PAC_SCRIPT", CRITICAL,
     re.compile(r"\b(?:pacScript|FindProxyForURL)\b"),
     "סקריפט PAC",
     "סקריפט PAC קובע דינמית דרך איזה שרת תעבור כל בקשה."),
    ("CODE_PROXY_MODE", CRITICAL,
     re.compile(r"""['"](?:fixed_servers|pac_script)['"]"""),
     "הגדרת מצב proxy",
     "ערכי תצורה של ניתוב תעבורה דרך שרת proxy."),
    ("CODE_SOCKS", CRITICAL,
     re.compile(r"\bsocks[45]?://|\bsocks[45]\b", re.IGNORECASE),
     "פרוטוקול SOCKS",
     "SOCKS משמש להעברת תעבורה דרך שרת מתווך."),
    ("CODE_VPN_PROTOCOL", CRITICAL,
     re.compile(r"\b(?:wireguard|openvpn|shadowsocks|v2ray|vmess|vless|trojan-go|outline-?vpn)\b",
                re.IGNORECASE),
     "פרוטוקול VPN/מנהור",
     "שמות של פרוטוקולי VPN או מנהור תעבורה."),
    ("CODE_TUNNEL_URI", CRITICAL,
     re.compile(r"\b(?:vmess|vless|trojan|ss)://"),
     "כתובת שרת מנהור",
     "מזהה חיבור לשרת VPN/proxy מוטמע בקוד."),
    ("CODE_DOH", HIGH,
     re.compile(r"dns-query|/resolve\?name=|cloudflare-dns\.com|dns\.google", re.IGNORECASE),
     "DNS מוצפן (DoH)",
     "פניות DNS מוצפנות עוקפות פתרון שמות מקומי ואת הסינון שמסתמך עליו."),
    ("CODE_DNR_DYNAMIC", HIGH,
     re.compile(r"\bupdate(?:Dynamic|Session)Rules\b"),
     "כללי הפניה דינמיים",
     "התוסף משנה כללי הפניה של בקשות רשת בזמן ריצה, כך שהם לא נראים בקוד הסטטי."),
    ("CODE_WEBREQUEST_REDIRECT", HIGH,
     re.compile(r"redirectUrl|onBeforeRequest"),
     "הפניית בקשות רשת",
     "הקוד מיירט בקשות ויכול להפנות אותן ליעד אחר."),
    ("CODE_WEBRTC_DATACHANNEL", MEDIUM,
     re.compile(r"\bRTCPeerConnection\b[\s\S]{0,400}?\bcreateDataChannel\b"),
     "ערוץ נתונים WebRTC",
     "ערוץ נתונים ישיר בין עמיתים יכול לשמש להעברת תעבורה מחוץ למסלול הרגיל."),
    ("CODE_BYPASS_TERMS", INFO,
     re.compile(r"\b(?:unblock|censorship|anti-?filter|geo-?restrict)\b"
                r"|עוקף|עקיפת|לעקוף|חסימה|סינון|נטפרי|netfree", re.IGNORECASE),
     "מונחי עקיפה בטקסט",
     "מילים שקשורות לעקיפת חסימות. לעיתים קרובות זו רק מחרוזת בממשק - "
     "יש לקרוא את ההקשר."),
]

#: ExtSync's own native host. Every extension the platform packages talks to
#: it - that is the auto-update bridge, not a finding.
_EXTSYNC_NATIVE_HOST = "com.extsync.agent"

_NATIVE_CALL_RE = re.compile(r"\b(?:connectNative|sendNativeMessage)\s*\(")
#: Native host ids are reverse-DNS with at least three segments
#: (com.extsync.agent). Requiring three keeps ordinary strings like
#: "style.css" out.
_NATIVE_HOST_RE = re.compile(r"""['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,})['"]""")

_MAX_EVIDENCE = 160

#: Hosts that appear in almost every bundle and mean nothing about where an
#: extension sends data - XML namespaces, spec URLs, framework error pages. They
#: are still recorded, just marked, so a reviewer's eye goes to the rest.
BENIGN_HOSTS: frozenset[str] = frozenset({
    "www.w3.org", "www.w3.org.uk", "schema.org", "schemas.microsoft.com",
    "reactjs.org", "react.dev", "developer.mozilla.org", "github.com",
    "www.gnu.org", "opensource.org", "creativecommons.org", "unlicense.org",
    "example.com", "localhost", "extsync.com", "www.extsync.com",
})

#: Absolute http(s) URLs. Captures the host only - full URLs would leak query
#: strings into a stored report for no review value.
_URL_HOST_RE = re.compile(
    r"""https?://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63})""",
)

#: How many distinct hosts / native hosts a single build may contribute. A
#: minified bundle can embed thousands; the counts stay truthful either way.
MAX_ENDPOINTS = 120
MAX_NATIVE_HOSTS = 25
MAX_FILES_PER_ITEM = 5



def _excerpt(text: str, match: re.Match[str]) -> str:
    """A short window around the match, so the reviewer sees real context."""
    start = max(0, match.start() - 50)
    end = min(len(text), match.end() + 50)
    snippet = text[start:end].replace("\n", " ").replace("\r", " ")
    snippet = re.sub(r"\s+", " ", snippet).strip()
    if len(snippet) > _MAX_EVIDENCE:
        snippet = snippet[:_MAX_EVIDENCE] + "..."
    return ("..." if start > 0 else "") + snippet


def _scan_native_messaging(filename: str, text: str) -> RiskSignal | None:
    """Native messaging, minus ExtSync's own bridge.

    The bridge is injected as `var HOST = "com.extsync.agent"` plus a
    `connectNative(HOST)` call in the same file, so the host is matched by
    literal rather than at the call site.
    """
    if _NATIVE_CALL_RE.search(text) is None:
        return None
    hosts = set(_NATIVE_HOST_RE.findall(text))
    others = sorted(hosts - {_EXTSYNC_NATIVE_HOST})
    if others:
        return RiskSignal(
            code="CODE_NATIVE_MESSAGING", level=HIGH,
            title="תקשורת עם תוכנה במחשב",
            detail="הקוד מפעיל תוכנה מחוץ לדפדפן, שאינה כפופה למגבלות שלו.",
            file=filename, evidence="native host: " + ", ".join(others[:5]),
        )
    if hosts:
        return None  # only the ExtSync bridge
    # A call with no host literal in this file: the target is decided
    # elsewhere or at runtime, which is worth a look but is not evidence of
    # anything on its own.
    return RiskSignal(
        code="CODE_NATIVE_MESSAGING_DYNAMIC", level=MEDIUM,
        title="תקשורת עם תוכנה במחשב, יעד לא ידוע",
        detail="הקוד מתחבר לתוכנה במחשב אך שם היעד אינו מופיע בקובץ הזה.",
        file=filename,
        evidence=_excerpt(text, _NATIVE_CALL_RE.search(text)),
    )


def scan_text(filename: str, text: str) -> list[RiskSignal]:
    """Signals from one source file. At most one signal per pattern per file."""
    out: list[RiskSignal] = []
    native = _scan_native_messaging(filename, text)
    if native is not None:
        out.append(native)
    for code, level, pattern, title, detail in _CODE_PATTERNS:
        m = pattern.search(text)
        if m is None:
            continue
        out.append(RiskSignal(
            code=code, level=level, title=title, detail=detail,
            file=filename, evidence=_excerpt(text, m),
        ))
    return out


# --------------------------------------------------------------------------- summary

@dataclass
class RiskScan:
    signals: list[RiskSignal] = field(default_factory=list)
    #: host -> files it was seen in. Observational, never a signal.
    endpoints: dict[str, list[str]] = field(default_factory=dict)
    #: native host id -> files it was seen in.
    native_hosts: dict[str, list[str]] = field(default_factory=dict)
    #: True once anything was truncated, so the report never implies completeness.
    truncated: bool = False

    def add_all(self, signals: list[RiskSignal]) -> None:
        self.signals.extend(signals)

    def observe(self, filename: str, text: str) -> None:
        """Record the hosts and native hosts this file reaches for.

        Static extraction is a FLOOR, never a complete picture: a templated URL
        (`${base}/api`), a split string or a base64 blob is invisible here. An
        empty list means "nothing was found in the source", not "contacts
        nothing", and the triage view says so.
        """
        for m in _URL_HOST_RE.finditer(text):
            host = m.group(1).lower().rstrip(".")
            if host in self.endpoints:
                files = self.endpoints[host]
                if filename not in files and len(files) < MAX_FILES_PER_ITEM:
                    files.append(filename)
            elif len(self.endpoints) < MAX_ENDPOINTS:
                self.endpoints[host] = [filename]
            else:
                self.truncated = True

        if _NATIVE_CALL_RE.search(text):
            for host in _NATIVE_HOST_RE.findall(text):
                if host in self.native_hosts:
                    files = self.native_hosts[host]
                    if filename not in files and len(files) < MAX_FILES_PER_ITEM:
                        files.append(filename)
                elif len(self.native_hosts) < MAX_NATIVE_HOSTS:
                    self.native_hosts[host] = [filename]
                else:
                    self.truncated = True

    @property
    def sorted_signals(self) -> list[RiskSignal]:
        return sorted(self.signals, key=lambda s: (_LEVEL_ORDER.get(s.level, 9), s.code))

    def counts(self) -> dict[str, int]:
        out = {CRITICAL: 0, HIGH: 0, MEDIUM: 0, INFO: 0}
        for s in self.signals:
            if s.level in out:
                out[s.level] += 1
        return out

    def endpoint_list(self) -> list[dict[str, Any]]:
        """External hosts, interesting ones first."""
        items = [
            {"host": h, "files": f, "benign": h in BENIGN_HOSTS}
            for h, f in self.endpoints.items()
        ]
        items.sort(key=lambda i: (i["benign"], i["host"]))
        return items

    def native_host_list(self) -> list[dict[str, Any]]:
        """Native hosts, with ExtSync's own bridge marked as what it is."""
        items = [
            {
                "host": h,
                "files": f,
                "isExtsyncBridge": h == _EXTSYNC_NATIVE_HOST,
            }
            for h, f in self.native_hosts.items()
        ]
        items.sort(key=lambda i: (i["isExtsyncBridge"], i["host"]))
        return items

    def to_dict(self) -> dict[str, Any]:
        counts = self.counts()
        return {
            # Capped so one obfuscated bundle matching everything cannot bloat
            # the stored report; the counts stay accurate.
            "signals": [s.to_dict() for s in self.sorted_signals[:200]],
            "counts": counts,
            "total": len(self.signals),
            "endpoints": self.endpoint_list(),
            "nativeHosts": self.native_host_list(),
            "truncated": self.truncated,
            # Which build of the scanner produced this. A report without it
            # predates the scanner entirely and must be shown as NOT SCANNED
            # rather than as a clean result.
            "scannerVersion": SCANNER_VERSION,
            # A single word for the queue list. Explicitly NOT a verdict - it says
            # what was found, not whether to approve.
            "topLevel": (
                CRITICAL if counts[CRITICAL] else
                HIGH if counts[HIGH] else
                MEDIUM if counts[MEDIUM] else
                INFO if counts[INFO] else "none"
            ),
        }
