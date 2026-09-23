"""Explicit integration check: python -m unittest discover -s tests -p test_sumo.py"""
import tempfile
import unittest
from pathlib import Path
import sumolib

from server.app import Scenario
from server.data import RUNTIME, SNAPSHOT
from server.simulation import build_scenario, compare, demand, network, pilot_corridor, simulate
from server.catalog import PROJECTS


@unittest.skipUnless((SNAPSHOT / "astana.net.xml").exists(), "Run python -m server --prepare first")
class SumoIntegrationTests(unittest.TestCase):
    def test_identical_scenario_is_zero_and_bus_lane_is_real(self):
        RUNTIME.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=RUNTIME) as temporary:
            folder = Path(temporary)
            net = network()
            corridor = pilot_corridor(net)
            options = Scenario(vehicles=20, demandSeconds=300).model_dump()
            trips = demand(net, options, corridor)
            self.assertEqual(trips, demand(net, options, corridor))
            before = simulate(SNAPSHOT / "astana.net.xml", trips, corridor, options, folder / "before")
            after = simulate(SNAPSHOT / "astana.net.xml", trips, corridor, options, folder / "after")
            result, _ = compare(net, before, after, [])
            self.assertTrue(result["comparisonComplete"])
            self.assertEqual(result["co2DeltaKg"], 0)
            self.assertEqual(result["paired"]["car"]["duration"]["delta"], 0)
            changed = sumolib.net.readNet(str(build_scenario(net, corridor, [PROJECTS[0]], folder)))
            for edge_id in corridor["affectedLinks"]:
                self.assertTrue(net.getEdge(edge_id).getLanes()[0].allows("passenger"))
                self.assertFalse(changed.getEdge(edge_id).getLanes()[0].allows("passenger"))
                self.assertTrue(changed.getEdge(edge_id).getLanes()[0].allows("bus"))
                self.assertTrue(changed.getEdge(edge_id).allows("passenger"))


if __name__ == "__main__":
    unittest.main()
