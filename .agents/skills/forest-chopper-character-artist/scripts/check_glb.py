#!/usr/bin/env python3
"""Inspect a character .glb without extra dependencies.

Examples:
  python3 check_glb.py lumberjack/lumberjack.glb --profile lumberjack
  python3 check_glb.py characters/hero/hero.glb --profile generic --max-tris 25000
  python3 check_glb.py characters/statue/statue.glb --profile static

Exit 0 = structural checks passed (possibly with warnings).
Exit 1 = failed checks or malformed GLB.
This does NOT assess aesthetics, mesh intersections, the weapon grip, or looping quality.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import struct
import sys

EXPECTED_LUMBERJACK_CLIPS = (
    "Idle", "Walk", "Run", "Death", "Jump",
    "Chop2", "Chop", "StrafeLeft", "StrafeRight",
)
EXPECTED_LUMBERJACK_JOINTS = (
    "Root", "Hips", "Spine", "Head",
    "UpperArm.L", "Forearm.L", "UpperArm.R",
    "Forearm.R", "Hand.R", "Thigh.L", "Shin.L",
    "Thigh.R", "Shin.R",
)
LOCOMOTION = ("Walk", "Run", "StrafeLeft", "StrafeRight")
COMPONENT_FORMAT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
ELEMENT_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def parse_glb(data: bytes) -> tuple[dict, bytes]:
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("Not a binary glTF (.glb) file")
    version, length = struct.unpack_from("<II", data, 4)
    if version != 2 or length != len(data):
        raise ValueError(f"Invalid GLB version/size: version={version}, declared={length}, real={len(data)}")
    offset = 12
    doc = None
    binary = b""
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated GLB chunk header")
        size, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + size > len(data):
            raise ValueError("Truncated GLB chunk data")
        block = data[offset:offset + size]
        offset += size
        if chunk_type == 0x4E4F534A:
            doc = json.loads(block.decode("utf-8").rstrip("\x00 \t\r\n"))
        elif chunk_type == 0x004E4942:
            binary = block
    if doc is None or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("No valid glTF 2.0 JSON chunk")
    return doc, binary


def accessor_vector(doc: dict, binary: bytes, accessor_index: int, element_index: int) -> tuple[float, ...]:
    acc = doc["accessors"][accessor_index]
    if acc.get("sparse"):
        raise ValueError("Sparse accessor unsupported for QA sampling")
    view = doc["bufferViews"][acc["bufferView"]]
    fmt = COMPONENT_FORMAT[acc["componentType"]]
    count = ELEMENT_COUNT[acc["type"]]
    element_size = struct.calcsize("<" + fmt * count)
    stride = view.get("byteStride", element_size)
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0) + element_index * stride
    if element_index < 0 or element_index >= acc["count"] or offset + element_size > len(binary):
        raise ValueError("Animation accessor outside GLB buffer")
    return struct.unpack_from("<" + fmt * count, binary, offset)


def root_distance(doc: dict, binary: bytes, anim: dict) -> float | None:
    nodes = doc.get("nodes", [])
    for channel in anim.get("channels", []):
        target = channel.get("target", {})
        node_index = target.get("node", -1)
        if (node_index < 0 or node_index >= len(nodes)
                or nodes[node_index].get("name", "").replace("_", "").lower() != "root"
                or target.get("path") != "translation"):
            continue
        sampler = anim["samplers"][channel["sampler"]]
        out_idx = sampler["output"]
        accessor = doc["accessors"][out_idx]
        count = accessor["count"]
        if count < 2:
            return 0.0
        if sampler.get("interpolation") == "CUBICSPLINE":
            first_index, last_index = 1, count - 2
        else:
            first_index, last_index = 0, count - 1
        p0 = accessor_vector(doc, binary, out_idx, first_index)
        p1 = accessor_vector(doc, binary, out_idx, last_index)
        # glTF / Three.js space after import: horizontal X and Z.
        return math.hypot(p1[0] - p0[0], p1[2] - p0[2])
    return None


def inspect(doc: dict, binary: bytes, *, profile: str = "lumberjack",
            max_tris: int = 35000, max_materials: int = 12,
            max_bytes: int = 5 * 1024 * 1024, file_size: int = 0,
            enforce_budgets: bool = False) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    nodes = doc.get("nodes", [])
    skins = doc.get("skins", [])
    animations = doc.get("animations", [])
    materials = doc.get("materials", [])
    meshes = doc.get("meshes", [])

    tris = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            accessor_idx = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
            if accessor_idx is None:
                warnings.append("Mesh primitive with no POSITION/indices accessor")
                continue
            count = doc["accessors"][accessor_idx]["count"]
            mode = primitive.get("mode", 4)
            if mode == 4:
                tris += count // 3
            elif mode in (5, 6):
                tris += max(0, count - 2)
            else:
                warnings.append(f"Non-triangle primitive mode {mode}")

    joint_indices = set()
    for skin in skins:
        joint_indices.update(skin.get("joints", []))
    joints = [nodes[i].get("name", f"node#{i}") for i in sorted(joint_indices) if 0 <= i < len(nodes)]
    skinned = [n.get("name", f"node#{i}") for i, n in enumerate(nodes) if "mesh" in n and "skin" in n]
    names = [a.get("name", "") for a in animations]
    root_travels: dict[str, float | None] = {}

    if not meshes:
        errors.append("No meshes")
    if profile != "static":
        if not skins:
            errors.append("No skin / armature")
        if not skinned:
            errors.append("No nodes with both mesh and skin")
        if not animations:
            errors.append("No animation clips")
    if len(skins) > 1 and profile == "lumberjack":
        errors.append(f"Expected one skin, found {len(skins)}")
    if len(names) != len(set(names)):
        errors.append("Duplicate animation clip names")

    if profile == "lumberjack":
        for clip in EXPECTED_LUMBERJACK_CLIPS:
            if clip not in names:
                errors.append(f"Missing animation: {clip}")
        for bone in EXPECTED_LUMBERJACK_JOINTS:
            if bone not in joints:
                errors.append(f"Missing required skin joint: {bone}")
        for name in LOCOMOTION:
            if name not in names:
                continue
            try:
                root_travels[name] = root_distance(doc, binary, animations[names.index(name)])
                if root_travels[name] is None:
                    errors.append(f"{name}: missing Root translation channel")
                elif root_travels[name] < 0.03:
                    errors.append(f"{name}: negligible Root horizontal motion ({root_travels[name]:.4f}m)")
            except (ValueError, IndexError, KeyError, struct.error) as exc:
                errors.append(f"{name}: unable to sample Root motion ({exc})")

    for animation in animations:
        name = animation.get("name", "")
        targets = set()
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            node_idx, path = target.get("node"), target.get("path")
            if node_idx is None or node_idx >= len(nodes) or node_idx < 0:
                errors.append(f"{name}: invalid target node")
                continue
            key = (node_idx, path)
            if key in targets:
                warnings.append(f"{name}: duplicate channel target {nodes[node_idx].get('name')}:{path}")
            targets.add(key)
            if profile == "lumberjack" and node_idx not in joint_indices:
                errors.append(f"{name}: animates non-skeleton node {nodes[node_idx].get('name', node_idx)}")

    for value, limit, label in ((tris, max_tris, "Triangles"),
                                (len(materials), max_materials, "Materials"),
                                (file_size, max_bytes, "GLB size (bytes)")):
        if limit is not None and value > limit:
            message = f"{label}: {value} exceeds budget {limit}"
            (errors if enforce_budgets else warnings).append(message)

    return {
        "ok": not errors,
        "profile": profile,
        "stats": {"triangles": tris, "meshes": len(meshes), "materials": len(materials),
                  "skins": len(skins), "skinned_nodes": len(skinned),
                  "bones": len(joints), "animations": len(names), "bytes": file_size},
        "clips": names, "joints": joints, "skinned_nodes": skinned,
        "root_motion_m": {k: None if v is None else round(v, 4) for k, v in root_travels.items()},
        "errors": errors, "warnings": warnings,
        "notice": "Structural QA only: visual, rig deformation, loop seams and Three.js behavior still require manual inspection.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--profile", choices=("lumberjack", "generic", "static"), default="lumberjack")
    parser.add_argument("--max-tris", type=int, default=35000)
    parser.add_argument("--max-materials", type=int, default=12)
    parser.add_argument("--max-mib", type=float, default=5)
    parser.add_argument("--enforce-budgets", action="store_true", help="Treat budget overruns as errors")
    args = parser.parse_args(argv)
    try:
        content = args.path.read_bytes()
        doc, binary = parse_glb(content)
        report = inspect(doc, binary, profile=args.profile, max_tris=args.max_tris,
                         max_materials=args.max_materials,
                         max_bytes=int(args.max_mib * 1024 * 1024),
                         file_size=len(content), enforce_budgets=args.enforce_budgets)
    except (OSError, ValueError, KeyError, IndexError, TypeError, struct.error, json.JSONDecodeError) as exc:
        report = {"ok": False, "path": str(args.path), "errors": [f"Invalid GLB: {exc}"], "warnings": []}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
