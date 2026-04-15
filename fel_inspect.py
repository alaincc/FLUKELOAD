#!/usr/bin/env python3
"""Lightweight inspector for Fluke 3540 FC .fel session files.

This script only labels fields we can infer with high confidence:
- an initial metadata/header region
- fixed-size measurement records
- per-record start/end timestamps stored as FILETIME values
- repeated float payload groups inside each record
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


FILETIME_EPOCH = dt.datetime(1601, 1, 1, tzinfo=dt.timezone.utc)
RECORD_MAGIC = bytes.fromhex("4600e802")
STAT_SUFFIXES = ("min", "max", "avg")
PHASES = ("a", "b", "c")


@dataclass(frozen=True)
class RecordWindow:
    index: int
    offset: int
    started_at: dt.datetime
    ended_at: dt.datetime


@dataclass(frozen=True)
class FieldSpec:
    index: int
    name: str
    confidence: str
    note: str = ""


def filetime_to_datetime(value: int) -> dt.datetime:
    return FILETIME_EPOCH + dt.timedelta(microseconds=value / 10)


def read_u32_le(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def read_f32_le(data: bytes, offset: int) -> float:
    return struct.unpack_from("<f", data, offset)[0]


def extract_ascii_strings(data: bytes, min_len: int = 6) -> list[str]:
    out: list[str] = []
    buf = bytearray()
    for b in data:
        if 32 <= b <= 126:
            buf.append(b)
        else:
            if len(buf) >= min_len:
                out.append(buf.decode("ascii", errors="ignore"))
            buf.clear()
    if len(buf) >= min_len:
        out.append(buf.decode("ascii", errors="ignore"))
    return out


def extract_utf16le_strings(data: bytes, min_len: int = 4) -> list[str]:
    out: list[str] = []
    i = 0
    while i + 1 < len(data):
        chars: list[int] = []
        start = i
        while i + 1 < len(data):
            lo = data[i]
            hi = data[i + 1]
            if hi == 0 and 32 <= lo <= 126:
                chars.append(lo)
                i += 2
            else:
                break
        if len(chars) >= min_len:
            out.append(bytes(chars).decode("ascii", errors="ignore"))
        i = max(i + 2, start + 2)
    return out


def find_record_layout(data: bytes) -> tuple[int, int]:
    first = data.find(RECORD_MAGIC)
    if first == -1:
        raise ValueError("Could not find record marker 0x02e80046")

    second = data.find(RECORD_MAGIC, first + 1)
    if second == -1:
        raise ValueError("Could not find a second record marker")

    size = second - first
    if size <= 0:
        raise ValueError("Invalid record size")
    return first, size


def iter_record_windows(path: Path, start_offset: int, record_size: int) -> Iterable[RecordWindow]:
    with path.open("rb") as fh:
        fh.seek(start_offset)
        index = 0
        while True:
            offset = start_offset + index * record_size
            chunk = fh.read(record_size)
            if len(chunk) < 24 or chunk[:4] != RECORD_MAGIC:
                return

            start_ft = (read_u32_le(chunk, 4) << 32) | read_u32_le(chunk, 8)
            end_ft = (read_u32_le(chunk, 12) << 32) | read_u32_le(chunk, 16)

            yield RecordWindow(
                index=index,
                offset=offset,
                started_at=filetime_to_datetime(start_ft),
                ended_at=filetime_to_datetime(end_ft),
            )
            index += 1


def format_float(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    return f"{value:.6f}".rstrip("0").rstrip(".")


def build_field_specs() -> list[FieldSpec]:
    specs: list[FieldSpec] = [
        FieldSpec(6, "load_calc_nominal_ln_voltage_a", "high"),
        FieldSpec(7, "load_calc_nominal_ln_voltage_b", "high"),
        FieldSpec(8, "load_calc_nominal_ln_voltage_c", "high"),
        FieldSpec(15, "load_calc_nominal_ll_voltage_ab", "high"),
        FieldSpec(16, "load_calc_nominal_ll_voltage_bc", "high"),
        FieldSpec(17, "load_calc_nominal_ll_voltage_ca", "high"),
    ]

    for phase_i, phase in enumerate(PHASES):
        base = 24 + phase_i * 3
        specs.extend(
            FieldSpec(
                base + stat_i,
                f"load_calc_phase_{phase}_current_{suffix}",
                "medium",
                "Triplet behaves like min/max/avg current for the load calculation interval.",
            )
            for stat_i, suffix in enumerate(STAT_SUFFIXES)
        )

    for phase_i, phase in enumerate(PHASES):
        base = 42 + phase_i * 3
        specs.extend(
            FieldSpec(
                base + stat_i,
                f"load_calc_phase_{phase}_current_metric_{suffix}",
                "low",
                "Derived current-related metric used by the load calculation; exact meaning still unconfirmed.",
            )
            for stat_i, suffix in enumerate(STAT_SUFFIXES)
        )

    specs.extend(
        FieldSpec(51 + stat_i, f"load_calc_frequency_{suffix}", "high")
        for stat_i, suffix in enumerate(STAT_SUFFIXES)
    )

    for phase_i, phase in enumerate(PHASES):
        base = 66 + phase_i * 3
        specs.extend(
            FieldSpec(
                base + stat_i,
                f"load_calc_phase_{phase}_kw_{suffix}",
                "medium",
                "Behaves like min/max/avg phase active power and sums into total kW.",
            )
            for stat_i, suffix in enumerate(STAT_SUFFIXES)
        )

    specs.extend(
        FieldSpec(
            75 + stat_i,
            f"load_calc_total_kw_{suffix}",
            "medium",
            "Tracks the sum of the per-phase kW triplets.",
        )
        for stat_i, suffix in enumerate(STAT_SUFFIXES)
    )

    specs.extend(
        [
            FieldSpec(104, "load_calc_phase_a_kw_reference", "low", "Likely a slower-moving phase A kW reference or demand-style value."),
            FieldSpec(107, "load_calc_phase_b_kw_reference", "low", "Likely a slower-moving phase B kW reference or demand-style value."),
            FieldSpec(110, "load_calc_phase_c_kw_reference", "low", "Likely a slower-moving phase C kW reference or demand-style value."),
            FieldSpec(113, "load_calc_total_kw_reference", "low", "Likely a slower-moving total kW reference or demand-style value."),
            FieldSpec(154, "load_calc_phase_a_current_aux", "low", "Strongly correlated with phase A current; exact calculation is still unconfirmed."),
            FieldSpec(155, "load_calc_phase_b_current_aux", "low", "Strongly correlated with phase B current; exact calculation is still unconfirmed."),
            FieldSpec(156, "load_calc_phase_c_current_aux", "low", "Strongly correlated with phase C current; exact calculation is still unconfirmed."),
            FieldSpec(157, "load_calc_total_current_aux", "low", "Strongly correlated with total current reference; exact calculation is still unconfirmed."),
            FieldSpec(176, "load_calc_nominal_ln_voltage_ref_1", "high", "Constant 120 V reference used by the study."),
            FieldSpec(177, "load_calc_total_current_reference_1", "low", "Tracks total current closely; likely a reference, demand, or smoothed total current."),
            FieldSpec(178, "load_calc_nominal_ln_voltage_ref_2", "high", "Constant 120 V reference used by the study."),
            FieldSpec(179, "load_calc_nominal_ln_voltage_ref_3", "high", "Constant 120 V reference used by the study."),
            FieldSpec(180, "load_calc_nominal_ln_voltage_ref_4", "high", "Constant 120 V reference used by the study."),
            FieldSpec(181, "load_calc_phase_a_current_reference", "low", "Tracks phase A current closely; likely a reference, demand, or smoothed current."),
            FieldSpec(182, "load_calc_phase_b_current_reference", "low", "Tracks phase B current closely; likely a reference, demand, or smoothed current."),
            FieldSpec(183, "load_calc_phase_c_current_reference", "low", "Tracks phase C current closely; likely a reference, demand, or smoothed current."),
            FieldSpec(184, "load_calc_nominal_ln_voltage_ref_5", "high", "Constant 120 V reference used by the study."),
            FieldSpec(185, "load_calc_total_current_reference_2", "low", "Tracks total current closely; likely a second reference, demand, or smoothed total current."),
        ]
    )
    return specs


def read_record_floats(path: Path, start_offset: int, record_size: int, record_index: int) -> list[float]:
    with path.open("rb") as fh:
        fh.seek(start_offset + record_index * record_size)
        chunk = fh.read(record_size)

    return [read_f32_le(chunk, i * 4) for i in range(record_size // 4)]


def dump_record_payload(path: Path, start_offset: int, record_size: int, record_index: int) -> str:
    floats = read_record_floats(path, start_offset, record_size, record_index)
    lines = []
    float_count = len(floats)
    for group_start in range(0, float_count, 9):
        group = floats[group_start : group_start + 9]
        pretty = " | ".join(format_float(v) for v in group)
        lines.append(f"{group_start:03d}-{group_start + len(group) - 1:03d}: {pretty}")
    return "\n".join(lines)


def dump_named_record(path: Path, start_offset: int, record_size: int, record_index: int) -> str:
    floats = read_record_floats(path, start_offset, record_size, record_index)
    lines = []
    for spec in build_field_specs():
        value = floats[spec.index]
        rendered = format_float(value)
        suffix = f" [{spec.confidence}]"
        if spec.note:
            suffix += f" {spec.note}"
        lines.append(f"{spec.name}: {rendered}{suffix}")
    return "\n".join(lines)


def export_csv(path: Path, start_offset: int, record_size: int, output_path: Path, limit: int | None) -> int:
    specs = build_field_specs()
    exported = 0
    with path.open("rb") as src, output_path.open("w", newline="") as dst:
        writer = csv.writer(dst)
        writer.writerow(
            [
                "record_index",
                "offset",
                "started_at_utc",
                "ended_at_utc",
                *[spec.name for spec in specs],
            ]
        )
        src.seek(start_offset)
        index = 0
        while True:
            if limit is not None and exported >= limit:
                break
            offset = start_offset + index * record_size
            chunk = src.read(record_size)
            if len(chunk) < 24 or chunk[:4] != RECORD_MAGIC:
                break

            start_ft = (read_u32_le(chunk, 4) << 32) | read_u32_le(chunk, 8)
            end_ft = (read_u32_le(chunk, 12) << 32) | read_u32_le(chunk, 16)
            floats = [read_f32_le(chunk, i * 4) for i in range(record_size // 4)]

            row = [
                index,
                offset,
                filetime_to_datetime(start_ft).isoformat(),
                filetime_to_datetime(end_ft).isoformat(),
            ]
            for spec in specs:
                value = floats[spec.index]
                row.append("" if math.isnan(value) else value)
            writer.writerow(row)
            exported += 1
            index += 1
    return exported


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fel_path", type=Path, help="Path to the .fel file")
    parser.add_argument("--record", type=int, default=0, help="Record index to dump")
    parser.add_argument("--named", action="store_true", help="Show the selected record with provisional field names")
    parser.add_argument("--export-csv", type=Path, help="Export a CSV with confidently/provisionally named fields")
    parser.add_argument("--limit", type=int, help="Limit exported CSV rows")
    args = parser.parse_args()

    fel_path = args.fel_path
    data = fel_path.read_bytes()
    start_offset, record_size = find_record_layout(data)
    payload_size = len(data) - start_offset
    record_count = payload_size // record_size
    trailing_bytes = payload_size % record_size

    header = data[:start_offset]
    ascii_strings = sorted(set(extract_ascii_strings(header)))
    utf16_strings = sorted(set(extract_utf16le_strings(header)))

    windows = list(iter_record_windows(fel_path, start_offset, record_size))
    first = windows[0]
    last = windows[-1]

    sidecar = fel_path.with_name(f"{fel_path.stem}-config.json")
    sidecar_data = None
    if sidecar.exists():
        sidecar_data = json.loads(sidecar.read_text())

    print(f"file: {fel_path}")
    print(f"size_bytes: {len(data)}")
    print(f"header_bytes: {start_offset}")
    print(f"record_magic: 0x02e80046")
    print(f"record_size_bytes: {record_size}")
    print(f"record_count: {record_count}")
    print(f"trailing_bytes: {trailing_bytes}")
    print()
    print("time_range_utc:")
    print(f"  first_record_start: {first.started_at.isoformat()}")
    print(f"  first_record_end:   {first.ended_at.isoformat()}")
    print(f"  last_record_start:  {last.started_at.isoformat()}")
    print(f"  last_record_end:    {last.ended_at.isoformat()}")
    print(f"  nominal_interval_s: {(first.ended_at - first.started_at).total_seconds():.6f}")
    print()

    if sidecar_data:
        timing = sidecar_data.get("session_timing", {})
        print("sidecar_config:")
        for key in [
            "type",
            "instrument_uuid",
            "firmware_version",
            "session_id",
            "asset_name",
            "team_name",
        ]:
            if key in sidecar_data:
                print(f"  {key}: {sidecar_data[key]}")
        for key in ["session_start_at", "session_end_at"]:
            if key in timing:
                stamp = dt.datetime.fromtimestamp(timing[key] / 1000, tz=dt.timezone.utc)
                print(f"  {key}_utc: {stamp.isoformat()}")
        print()

    print("header_strings_ascii:")
    for item in ascii_strings[:20]:
        print(f"  - {item}")
    print()
    print("header_strings_utf16le:")
    for item in utf16_strings[:20]:
        print(f"  - {item}")
    print()
    if args.named:
        print(f"record_{args.record}_named_fields:")
        print(dump_named_record(fel_path, start_offset, record_size, args.record))
        print()
    print(f"record_{args.record}_float_groups:")
    print(dump_record_payload(fel_path, start_offset, record_size, args.record))

    if args.export_csv:
        exported = export_csv(fel_path, start_offset, record_size, args.export_csv, args.limit)
        print()
        print(f"csv_exported_rows: {exported}")
        print(f"csv_path: {args.export_csv}")


if __name__ == "__main__":
    main()
