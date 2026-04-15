from __future__ import annotations

import datetime as dt
import math
import struct
from math import ceil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Optional


FILETIME_EPOCH = dt.datetime(1601, 1, 1, tzinfo=dt.timezone.utc)
RECORD_MAGIC = bytes.fromhex("4600e802")
STAT_SUFFIXES = ("min", "max", "avg")
PHASES = ("a", "b", "c")


@dataclass(frozen=True)
class FieldSpec:
    index: int
    name: str
    confidence: str
    note: str = ""


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
            FieldSpec(104, "load_calc_phase_a_kw_reference", "low"),
            FieldSpec(107, "load_calc_phase_b_kw_reference", "low"),
            FieldSpec(110, "load_calc_phase_c_kw_reference", "low"),
            FieldSpec(113, "load_calc_total_kw_reference", "low"),
            FieldSpec(154, "load_calc_phase_a_current_aux", "low"),
            FieldSpec(155, "load_calc_phase_b_current_aux", "low"),
            FieldSpec(156, "load_calc_phase_c_current_aux", "low"),
            FieldSpec(157, "load_calc_total_current_aux", "low"),
            FieldSpec(176, "load_calc_nominal_ln_voltage_ref_1", "high"),
            FieldSpec(177, "load_calc_total_current_reference_1", "low"),
            FieldSpec(178, "load_calc_nominal_ln_voltage_ref_2", "high"),
            FieldSpec(179, "load_calc_nominal_ln_voltage_ref_3", "high"),
            FieldSpec(180, "load_calc_nominal_ln_voltage_ref_4", "high"),
            FieldSpec(181, "load_calc_phase_a_current_reference", "low"),
            FieldSpec(182, "load_calc_phase_b_current_reference", "low"),
            FieldSpec(183, "load_calc_phase_c_current_reference", "low"),
            FieldSpec(184, "load_calc_nominal_ln_voltage_ref_5", "high"),
            FieldSpec(185, "load_calc_total_current_reference_2", "low"),
        ]
    )
    return specs


def filetime_to_iso(value: int) -> str:
    stamp = FILETIME_EPOCH + dt.timedelta(microseconds=value / 10)
    return stamp.isoformat()


def read_u32_le(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def read_f32_le(data: bytes, offset: int) -> float:
    return struct.unpack_from("<f", data, offset)[0]


def find_record_layout(handle: BinaryIO) -> tuple[int, int, int]:
    first_chunk = handle.read(4096)
    first = first_chunk.find(RECORD_MAGIC)
    if first == -1:
      raise ValueError("Could not find record marker 0x02e80046")
    second = first_chunk.find(RECORD_MAGIC, first + 1)
    if second == -1:
      raise ValueError("Could not locate a second record marker in the first 4096 bytes")
    handle.seek(0, 2)
    size = handle.tell()
    handle.seek(0)
    return first, second - first, size


def parse_fel_file(path: Path, sample_step: int = 30, max_points: Optional[int] = None) -> dict:
    sample_step = max(1, sample_step)
    specs = build_field_specs()
    field_names = [spec.name for spec in specs]
    series = {name: [] for name in field_names}
    rows: list[dict] = []

    with path.open("rb") as handle:
        header_bytes, record_size, file_size = find_record_layout(handle)
        payload_size = file_size - header_bytes
        record_count = payload_size // record_size
        trailing_bytes = payload_size % record_size
        effective_sample_step = sample_step
        if max_points is not None and max_points > 0 and record_count > 0:
            effective_sample_step = max(sample_step, ceil(record_count / max_points))
        handle.seek(header_bytes)

        kept = 0
        first_start = None
        last_end = None
        reached_plot_limit = False

        for record_index in range(record_count):
            chunk = handle.read(record_size)
            if len(chunk) < 24 or chunk[:4] != RECORD_MAGIC:
                break
            start_ft = (read_u32_le(chunk, 4) << 32) | read_u32_le(chunk, 8)
            end_ft = (read_u32_le(chunk, 12) << 32) | read_u32_le(chunk, 16)
            if first_start is None:
                first_start = filetime_to_iso(start_ft)
            last_end = filetime_to_iso(end_ft)

            if record_index % effective_sample_step != 0:
                continue
            if max_points is not None and kept >= max_points:
                reached_plot_limit = True
                continue

            row = {
                "record_index": record_index,
                "started_at_utc": filetime_to_iso(start_ft),
                "ended_at_utc": filetime_to_iso(end_ft),
            }
            for spec in specs:
                value = read_f32_le(chunk, spec.index * 4)
                row[spec.name] = None if math.isnan(value) else value
                series[spec.name].append(None if math.isnan(value) else value)
            rows.append(row)
            kept += 1

    return {
        "meta": {
            "header_bytes": header_bytes,
            "record_size_bytes": record_size,
            "record_count": record_count,
            "trailing_bytes": trailing_bytes,
            "sample_step": sample_step,
            "effective_sample_step": effective_sample_step,
            "plotted_points": kept,
            "first_record_start": first_start,
            "last_record_end": last_end,
        },
        "fields": [
            {"name": spec.name, "confidence": spec.confidence, "note": spec.note}
            for spec in specs
        ],
        "rows": rows,
        "series": series,
    }
