"""Two small guards every module shares: what may go on a log line, and
whether a path stays inside the folder it was meant for.

Both are leaf code (stdlib only) so the lean zimi-mcp package carries them
too. CodeQL recognises the ``.replace("\\n", ...)`` in ``loggable`` as the
line-break sanitiser, so a value passed through it is clean at the call site.
"""

import os
import re

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]")


def loggable(value):
    """``value`` as text that is safe on one log line: line breaks and other
    control characters from a client- or file-given name are shown escaped,
    never acted on."""
    text = str(value).replace("\r", "\\r").replace("\n", "\\n")
    return _CONTROL_RE.sub(lambda m: "\\x%02x" % ord(m.group()) if ord(m.group()) < 256 else "\\u%04x" % ord(m.group()), text)


def header_value(value):
    """``value`` as one HTTP header line: CR and LF dropped, so a name or an
    address from a request or a ZIM cannot end the header and start another."""
    return str(value).replace("\r", "").replace("\n", "")


def _inside(base, target):
    """``target`` when it is ``base`` or below it, else None. The startswith
    on an already-normalised path is the shape CodeQL treats as a containment
    check, so the value returned is clean at the call site."""
    if target.startswith(base.rstrip(os.sep) + os.sep):
        return target
    if target == base:
        return base
    return None


def join_inside(root, *parts):
    """``parts`` joined under ``root`` and normalised, or None when ``..`` or
    an absolute part leads out of ``root``. Lexical: symlinks are not
    resolved, for callers that check (and skip) links themselves."""
    base = os.path.normpath(root)
    return _inside(base, os.path.normpath(os.path.join(base, *parts)))


def resolve_inside(root, *parts):
    """The real path of ``parts`` joined under ``root``, or None when it
    resolves (symlinks and ``..`` included) to somewhere outside ``root``.

    ``root`` itself is a legitimate answer. Use it wherever a path is built
    from a request or from a name read out of a file."""
    base = os.path.realpath(root)
    return _inside(base, os.path.realpath(os.path.join(base, *parts)))
