import unittest
from pydantic import ValidationError

from server.accessibility import nearest_distances
from server.app import Scenario
from server.catalog import budget
from server.simulation import compare


class LogicTests(unittest.TestCase):
    def test_budget_blocks_capex_plus_opex_and_carries_opex(self):
        result = budget(["brt"], 18, 3)
        self.assertFalse(result["withinLimit"])
        self.assertEqual(result["years"][0]["remainingBnKzt"], -0.8)
        self.assertEqual(result["years"][1]["capexBnKzt"], 0)
        self.assertEqual(result["totalOpexBnKzt"], 2.4)

    def test_reject_unknown_duplicate_and_unbounded_demand(self):
        for kwargs in ({"selectedProjectIds": ["unknown"]}, {"selectedProjectIds": ["brt", "brt"]},
                       {"vehicles": 2001}, {"seed": -1}, {"yearlyBudgetBnKzt": float("nan")},
                       {"vehicles": 20.5}, {"horizonYears": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                Scenario(**kwargs)

    def test_network_distance_respects_disconnected_components(self):
        nodes = {"a": (71.4, 51.1), "b": (71.4001, 51.1), "c": (71.5, 51.1)}
        graph = {"a": {"b": 800}, "b": {"a": 800}, "c": {}}
        result = nearest_distances(nodes, graph, [dict(coordinates=nodes["a"])])
        self.assertEqual(result["b"], 800)  # network distance, not the ~7m chord
        self.assertNotIn("c", result)
        self.assertEqual(nearest_distances(nodes, graph, []), {})

    def test_comparison_uses_same_completed_vehicles(self):
        class EmptyNet:
            def getEdges(self):
                return []
        def trip(duration, completed=True):
            return dict(kind="car", completed=completed, duration=duration, delay=10, waiting=2, departDelay=0)
        b = (dict(co2Kg=1, unfinished=0), {"one": trip(100), "two": trip(1000)}, {})
        a = (dict(co2Kg=1.2, unfinished=1), {"one": trip(120), "two": trip(50, False)}, {})
        result, _ = compare(EmptyNet(), b, a, [])
        self.assertEqual(result["paired"]["car"]["duration"]["delta"], 20)
        self.assertEqual(result["paired"]["car"]["pairedCompletedTrips"], 1)
        self.assertIsNone(result["paired"]["bus"]["duration"]["delta"])
        self.assertFalse(result["comparisonComplete"])


if __name__ == "__main__":
    unittest.main()
