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


def resolve_inside(root, *parts):
    """The real path of ``parts`` joined under ``root``, or None when it
    resolves (symlinks and ``..`` included) to somewhere outside ``root``.

    ``root`` itself is a legitimate answer. Use it wherever a path is built
    from a request or from a name read out of a file."""
    base = os.path.realpath(root)
    target = os.path.realpath(os.path.join(base, *parts))
    try:
        if os.path.commonpath([base, target]) != base:
            return None
    except ValueError:  # different drives on Windows
        return None
    return target
