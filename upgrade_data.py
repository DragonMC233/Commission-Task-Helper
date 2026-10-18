#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据格式升级：把所有时间字段统一成 ISO UTC

背景
----
早期版本的时间字段混着三种格式：
    2026-11-01T20:00        无时区的墙上时间
    2027-07-14              纯日期
    2026-10-18T03:16:46.472Z   ISO UTC

新版统一为 ISO UTC（带 Z），界面按访问者设备的本地时区显示。
这个脚本把旧数据一次性刷成新格式，**可以重复执行**（已经是 UTC 的会跳过）。

用法
----
    python upgrade_data.py

执行前会自动把原文件备份到 backup/ 目录。已经是 UTC 的字段会跳过，所以可以重复执行。
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Windows 终端默认可能是 GBK，中文提示会乱码
try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

INDEX_FILE = os.path.join(BASE_DIR, "index.json")
STATS_FILE = os.path.join(BASE_DIR, "Statistics.json")
PREVIEW_FILE = os.path.join(BASE_DIR, "BarView", "preview.json")
BACKUP_DIR = os.path.join(BASE_DIR, "backup")

# 历史数据是在东八区录入的，无标记的时间按这个基准换算
REFERENCE_TZ = timezone(timedelta(hours=8))

# 任务上的时间字段
TASK_TIME_FIELDS = [
    "startTime",
    "starttime",
    "deadline",
    "actualStartTime",
    "completedAt",
    "pausePreDeadline",
    "abandonedAt",
    "createdAt",
    "pausedAt",
]

# 暂停历史里的时间字段
PAUSE_TIME_FIELDS = ["pausedAt", "resumedAt"]


def is_absolute(value):
    """已经是绝对时刻（带 Z 或 ±HH:mm）"""
    return bool(re.search(r"(?:[Zz]|[+-]\d{2}:?\d{2})$", value.strip()))


def parse_to_utc(value):
    """把任意历史格式解析成 UTC；无法解析时返回 None"""
    if not isinstance(value, str) or not value.strip():
        return None
    s = value.strip()

    if is_absolute(s):
        try:
            dt = datetime.fromisoformat(s.upper().replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc)
        except ValueError:
            return None

    fmts = (
        "%Y-%m-%d",           # 纯日期
        "%Y-%m-%dT%H:%M",     # 墙上时间
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",  # 历史遗留的 MM/DD/YYYY
        "%m/%d/%Y %H:%M",
    )
    for fmt in fmts:
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=REFERENCE_TZ).astimezone(timezone.utc)
        except ValueError:
            continue

    return None


def to_iso_utc(value):
    """转成 ISO UTC 字符串；无法转换时原样返回（不破坏数据）"""
    dt = parse_to_utc(value)
    if dt is None:
        return value
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def upgrade_node(node, fields, where, changes):
    """就地改写一个对象上的时间字段"""
    if not isinstance(node, dict):
        return
    for field in fields:
        value = node.get(field)
        if not isinstance(value, str) or not value:
            continue
        new_value = to_iso_utc(value)
        if new_value != value:
            changes.append((f"{where}.{field}", value, new_value))
            node[field] = new_value


def upgrade_index(db, changes):
    """index.json：任务 + 回收站 + 暂停历史"""
    for key in ("tasks", "recycleBin"):
        for i, task in enumerate(db.get(key) or []):
            if not isinstance(task, dict):
                continue
            where = f'{key}[{i}]({task.get("name", "?")})'
            upgrade_node(task, TASK_TIME_FIELDS, where, changes)
            for j, entry in enumerate(task.get("pauseHistory") or []):
                upgrade_node(entry, PAUSE_TIME_FIELDS, f"{where}.pauseHistory[{j}]", changes)


def upgrade_statistics(stats, changes):
    """Statistics.json：样本的完成时间 + 类型的更新时间"""
    for type_id, entry in (stats.get("types") or {}).items():
        if not isinstance(entry, dict):
            continue
        for i, sample in enumerate(entry.get("samples") or []):
            upgrade_node(sample, ["completedAt"], f"types[{type_id}].samples[{i}]", changes)
        upgrade_node(entry, ["updatedAt"], f"types[{type_id}]", changes)


def upgrade_preview(preview, changes):
    """BarView/preview.json：快照基准时间"""
    if isinstance(preview.get("base"), dict):
        upgrade_node(preview["base"], ["time"], "preview.base", changes)
    for i, snap in enumerate(preview.get("snapshots") or []):
        upgrade_node(snap, ["time"], f"preview.snapshots[{i}]", changes)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    name = os.path.basename(path)
    shutil.copy2(path, os.path.join(BACKUP_DIR, name + ".bak"))
    print(f"    已备份 -> backup/{name}.bak")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    targets = []
    if os.path.exists(INDEX_FILE):
        targets.append(("index.json", INDEX_FILE, upgrade_index))
    if os.path.exists(STATS_FILE):
        targets.append(("Statistics.json", STATS_FILE, upgrade_statistics))
    if os.path.exists(PREVIEW_FILE):
        targets.append(("BarView/preview.json", PREVIEW_FILE, upgrade_preview))

    if not targets:
        print("没有找到数据文件，确认脚本放在项目根目录下。")
        return 1

    print("=" * 70)
    print("时间格式升级：统一为 ISO UTC")
    print("=" * 70)

    grand_total = 0
    for label, path, upgrader in targets:
        data = load_json(path)
        changes = []
        upgrader(data, changes)
        grand_total += len(changes)
        print(f"\n{label}: 改写 {len(changes)} 个字段")
        for where, before, after in changes[:5]:
            print(f"    {where}")
            print(f"        {before}  ->  {after}")
        if len(changes) > 5:
            print(f"    …还有 {len(changes) - 5} 处")

        if changes:
            save_json(path, data)
            print(f"    ✓ 已写入 {label}")

    print("\n" + "=" * 70)
    if grand_total == 0:
        print("所有时间字段都已经是 ISO UTC，无需升级。")
    else:
        print(f"完成：共改写 {grand_total} 个字段，原文件已备份到 backup/。")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
