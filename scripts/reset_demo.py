import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def call(base, method, path, params=None, payload=None):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read()[:200].decode(errors="replace")
        raise SystemExit(f"{method} {path} failed: HTTP {e.code} {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"cannot reach {base}: {e.reason}")


def main():
    ap = argparse.ArgumentParser(description="Reset the Khipu demo data to its seeded state.")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--keep-conversations", action="store_true")
    ap.add_argument("--stage-governance", action="store_true")
    args = ap.parse_args()

    base = args.base_url
    tree = call(base, "GET", "/org/tree")
    people = [p["id"] for p in tree.get("people", [])]
    admins = [p["id"] for p in tree.get("people", []) if p.get("admin")]
    if not admins:
        raise SystemExit("no admin profile found in /org/tree")
    admin = admins[0]

    print(f"target   : {base}")
    print(f"profiles : {len(people)}  admin: {admin}")

    if args.keep_conversations:
        print("chats    : skipped")
    else:
        removed = 0
        for pid in people:
            items = call(base, "GET", "/conversations", {"profile_id": pid}).get("items", [])
            for c in items:
                call(base, "DELETE", f"/conversations/{c['id']}", {"profile_id": pid})
                removed += 1
        print(f"chats    : {removed} deleted")

    seeded = call(base, "POST", "/admin/seed", {"profile_id": admin, "force": "true"})

    if args.stage_governance:
        facts = [
            (
                "The user prefers to send pricing proposals in the morning, before 10am.",
                "preference",
                None,
                None,
            ),
            (
                "The Sales team must attach written VP approval to deal notes before "
                "offering discounts above 20 percent.",
                "procedural",
                "team",
                "sales",
            ),
            (
                "Company-wide, the maximum discount for new clients must never exceed "
                "30 percent.",
                "semantic",
                "org",
                None,
            ),
        ]
        for content, mtype, propose_to, team in facts:
            body = {"content": content, "actor_id": "ana", "mtype": mtype}
            if propose_to:
                body["propose_to"] = propose_to
            if team:
                body["team"] = team
            call(base, "POST", "/memory/save", payload=body)
        print(f"staged   : {len(facts)} facts written as ana")

    count = len(call(base, "GET", "/memory", {"profile_id": admin}).get("items", []))
    pending = len(call(base, "GET", "/promotions", {"profile_id": admin}).get("items", []))

    print(f"memories : {seeded.get('seeded')} seeded, {count} visible to {admin}")
    print(f"pending  : {pending} promotion(s)")
    print("done. hard-refresh the browser (Ctrl+Shift+R) so the UI drops its cache.")


if __name__ == "__main__":
    sys.exit(main())
