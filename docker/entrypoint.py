#!/usr/bin/env python3
"""Container entrypoint: take ownership of a fresh data folder, then run as `zimi`.

Docker creates a bind-mounted folder that does not exist yet as root:root, and
the server runs as the unprivileged `zimi` user (uid 1000), which then cannot
write its own state and refuses to start. Platforms that create the folder for
you (Project NOMAD's custom apps, Portainer, Unraid templates) hit this on the
first run. So the image starts as root for the length of one chown and drops
privileges before Zimi's code runs.

What it touches, and what it never does:

* Only the data folder (--data-dir, else ZIMI_DATA_DIR). Never the ZIM folder
  and never an extra or read-only library folder: those are somebody's files.
* Only when the folder is owned by root and `zimi` cannot already write to it.
  A folder some other user owns is left alone and the error says how to fix it.
* Started with --user (or runAsUser), the process is not root, so nothing is
  attempted: a data folder it cannot write is named on stderr and the server's
  own check then stops with its message.

Standard library only, and it must not import `zimi` (that package binds paths
at import time, and this runs as root).
"""

import os
import pwd
import sys

RUN_AS = "zimi"


def data_dir_from(argv, environ):
    """The data folder the server will use, or None when it derives its own."""
    for i, arg in enumerate(argv):
        if arg == "--data-dir" and i + 1 < len(argv):
            return argv[i + 1]
        if arg.startswith("--data-dir="):
            return arg.split("=", 1)[1]
    return environ.get("ZIMI_DATA_DIR") or None


def _writable_by(uid, gid, path):
    """Whether (uid, gid) can create files in path, tested by being that user."""
    saved = (os.geteuid(), os.getegid())
    try:
        os.setegid(gid)
        os.seteuid(uid)
        # effective_ids: plain access() asks about the REAL uid, still root here
        return os.access(path, os.W_OK | os.X_OK, effective_ids=True)
    finally:
        os.seteuid(saved[0])
        os.setegid(saved[1])


def _chown_tree(root, uid, gid):
    """chown -R without following symlinks (a link must not reach elsewhere)."""
    os.lchown(root, uid, gid)
    for here, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            try:
                os.lchown(os.path.join(here, name), uid, gid)
            except FileNotFoundError:
                pass


def take_ownership(path, uid, gid):
    """Make the data folder usable by uid. Returns a message when it could not."""
    if not os.path.isdir(path):
        try:
            os.makedirs(path, exist_ok=True)
            os.lchown(path, uid, gid)
        except OSError as e:
            return f"could not create {path} ({e.strerror})"
        return None
    if _writable_by(uid, gid, path):
        return None
    owner = os.stat(path).st_uid
    if owner != 0:
        return (
            f"{path} is owned by uid {owner} and not writable by {RUN_AS} (uid {uid}); "
            f"run `chown -R {uid}:{gid} <the host folder>` or start the container with "
            f"--user {owner}:{os.stat(path).st_gid}"
        )
    try:
        _chown_tree(path, uid, gid)
    except OSError as e:
        return f"could not take ownership of {path} ({e.strerror})"
    return None


def drop_privileges(user):
    """Become `user` for good, and prove the way back is closed."""
    os.initgroups(user.pw_name, user.pw_gid)
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
    try:
        os.setuid(0)
    except PermissionError:
        pass
    else:  # pragma: no cover - would mean the drop did nothing
        raise RuntimeError("could not drop root")
    os.environ["HOME"] = user.pw_dir
    os.environ["USER"] = os.environ["LOGNAME"] = user.pw_name


def warn_if_unwritable(path):
    """Not root: nothing can be fixed from here, so say what is wrong."""
    target = path
    while target and not os.path.exists(target):
        target = os.path.dirname(target)
    if target and not os.access(target, os.W_OK | os.X_OK):
        print(
            f"zimi: the data folder {path} is not writable by uid {os.geteuid()}. "
            f"Give that user the host folder (chown {os.geteuid()}:{os.getegid()} <folder>) "
            "or run the container without --user so it can take ownership itself.",
            file=sys.stderr,
            flush=True,
        )


def main(argv=None, environ=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    environ = os.environ if environ is None else environ
    if not argv:
        argv = ["python3", "-m", "zimi", "serve", "--port", "8899"]
    path = data_dir_from(argv, environ)
    if os.geteuid() == 0:
        user = pwd.getpwnam(RUN_AS)
        if path:
            problem = take_ownership(path, user.pw_uid, user.pw_gid)
            if problem:
                print(f"zimi: {problem}", file=sys.stderr, flush=True)
        drop_privileges(user)
    elif path:
        warn_if_unwritable(path)
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    main()
