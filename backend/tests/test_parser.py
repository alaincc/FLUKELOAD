from pathlib import Path
import unittest

from app.parser import find_record_layout, parse_fel_file


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_FEL = ROOT / "48274031" / "sessions" / "LS.035.fel"


class ParserTests(unittest.TestCase):
    def test_find_record_layout_matches_sample_file(self) -> None:
        with SAMPLE_FEL.open("rb") as handle:
            header_bytes, record_size, file_size = find_record_layout(handle)

        self.assertEqual(header_bytes, 1262)
        self.assertEqual(record_size, 744)
        self.assertGreater(file_size, record_size)

    def test_parse_fel_file_returns_sampled_rows(self) -> None:
        parsed = parse_fel_file(SAMPLE_FEL, sample_step=500, max_points=5)

        self.assertEqual(parsed["meta"]["sample_step"], 500)
        self.assertGreaterEqual(parsed["meta"]["effective_sample_step"], 500)
        self.assertEqual(parsed["meta"]["plotted_points"], 5)
        self.assertEqual(len(parsed["rows"]), 5)
        self.assertIn("load_calc_frequency_avg", parsed["series"])
        self.assertEqual(
            parsed["rows"][0]["record_index"],
            0,
        )
        self.assertGreater(
            parsed["rows"][-1]["record_index"],
            parsed["rows"][1]["record_index"],
        )
        self.assertGreater(
            parsed["rows"][-1]["record_index"],
            parsed["meta"]["record_count"] // 2,
        )


if __name__ == "__main__":
    unittest.main()
