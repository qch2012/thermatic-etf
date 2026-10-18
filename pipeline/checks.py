import json
from pathlib import Path
import re

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "docs/screen.schema.json"
TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def is_type(value, name):
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, TYPES[name])


def validate(value, schema, root=None, path="$"):
    """Small JSON Schema subset: type, required, properties, items, enum, pattern, $ref ('#/a/b')."""
    root = root or schema
    if "$ref" in schema:
        node = root
        for part in schema["$ref"][2:].split("/"):
            node = node[part]
        return validate(value, node, root, path)
    types = schema.get("type", [])
    types = [types] if isinstance(types, str) else types
    if types and not any(is_type(value, t) for t in types):
        return [f"{path}: expected {' or '.join(types)}"]
    errors = []
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: not one of {schema['enum']}")
    if "pattern" in schema and isinstance(value, str) and not re.search(schema["pattern"], value):
        errors.append(f"{path}: does not match {schema['pattern']}")
    if isinstance(value, dict):
        errors += [f"{path}: missing {key}" for key in schema.get("required", []) if key not in value]
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                errors += validate(value[key], sub, root, f"{path}.{key}")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            errors += validate(item, schema["items"], root, f"{path}[{i}]")
    return errors


def check(result, previous):
    """SPEC 7 checks. Returns (errors that block publishing, notes for the run log)."""
    errors = [f"Schema: {e}" for e in validate(result, json.loads(SCHEMA_PATH.read_text()))]
    if errors:  # the later checks assume a valid shape
        return errors, []
    failed = {f["ticker"] for f in result["failed_fetches"]}
    if len(failed) / max(len(result["funds"]), 1) > 0.1:
        errors.append(f"Fewer than 90% of candidates fetched successfully ({len(failed)} of {len(result['funds'])} failed)")
    notes = []
    if previous:
        now = {t["theme"] for t in result["themes"]}
        was_eligible = {f["ticker"] for f in previous["funds"] if f["status"] == "Eligible"}
        for theme in previous["themes"]:
            lost = sorted(f["ticker"] for f in result["funds"]
                          if f["theme"] == theme["theme"] and f["ticker"] in failed and f["ticker"] in was_eligible)
            if theme["theme"] not in now and lost:
                errors.append(f"Theme {theme['theme']} lost all its eligible funds and has failed fetches: {', '.join(lost)}")
        old = {f["ticker"]: f["net_assets"] for f in previous["funds"]}
        for f in result["funds"]:
            before = old.get(f["ticker"])
            if before and f["net_assets"] is not None and abs(f["net_assets"] / before - 1) > 0.5:
                notes.append(f"Net assets of {f['ticker']} moved {f['net_assets'] / before - 1:+.0%} ({before:,.0f} to {f['net_assets']:,.0f})")
    return errors, notes
