"""Stop previously qualified Linux processes through pidfds, never numeric signals."""
import errno
import json
import os
import signal
import sys


def process_state(pid):
    with open(f"/proc/{pid}/stat", encoding="utf-8") as source:
        raw = source.read()
    fields = raw[raw.rfind(")") + 2:].split()
    return {"pid": pid, "pgid": int(fields[2]), "sessionId": int(fields[3]),
            "startTicks": fields[19]}


def stop_processes(value):
    pgid = value["pgid"]
    members = value["members"]
    if type(pgid) is not int or pgid <= 1 or not isinstance(members, dict) or len(members) > 4096:
        raise ValueError("invalid owned process group witness")
    handles = []
    result = {"mechanism": "pidfd", "signaled": [], "alreadyExited": []}
    try:
        # Validate every kernel handle before sending any signal. A stale witness must fail closed.
        for key, witness in members.items():
            pid = witness["pid"]
            if type(pid) is not int or pid <= 1 or str(pid) != key or witness["pgid"] != pgid or witness["sessionId"] != pgid:
                raise ValueError("invalid owned process identity")
            try:
                descriptor = os.pidfd_open(pid, 0)
            except ProcessLookupError:
                result["alreadyExited"].append(pid)
                continue
            handles.append((pid, descriptor))
            try:
                current = process_state(pid)
            except FileNotFoundError:
                result["alreadyExited"].append(pid)
                continue
            if current != {name: witness[name] for name in current}:
                raise ValueError("process identity changed after pidfd capture; refusing signal")
        for pid, descriptor in handles:
            try:
                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                result["signaled"].append(pid)
            except OSError as error:
                if error.errno != errno.ESRCH:
                    raise
                if pid not in result["alreadyExited"]:
                    result["alreadyExited"].append(pid)
        return result
    finally:
        for _, descriptor in handles:
            os.close(descriptor)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("Python and Linux must support pidfd cleanup; no numeric-signal fallback")
        descriptor = os.pidfd_open(os.getpid(), 0)
        try:
            signal.pidfd_send_signal(descriptor, 0)  # Check the kernel API without stopping any process.
        finally:
            os.close(descriptor)
        print(json.dumps({"pidfdSupported": True, "executable": os.path.realpath(sys.executable)}))
    elif len(sys.argv) == 2:
        print(json.dumps(stop_processes(json.loads(sys.argv[1]))))
    else:
        raise ValueError("expected exactly one owned process witness JSON argument")
