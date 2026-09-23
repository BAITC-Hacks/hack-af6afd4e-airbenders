"""Walking paths on OSM ways, expressed as sample coverage (not population)."""
import heapq
import math
import statistics
from .catalog import BBOX
from .data import osm_objects


def meters(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(lat), (a[1] - b[1]) * 110540)


def walking_graph():
    nodes, highways, facilities = osm_objects()
    graph = {}
    for refs, tags in highways:
        if tags.get("highway") in ("motorway", "motorway_link", "trunk", "trunk_link", "construction", "proposed"):
            continue
        if tags.get("foot") in ("no", "private") or (tags.get("access") in ("no", "private") and tags.get("foot") not in ("yes", "designated", "permissive")):
            continue
        for a, b in zip(refs, refs[1:]):
            distance = meters(nodes[a], nodes[b])
            graph.setdefault(a, {})[b] = distance
            graph.setdefault(b, {})[a] = distance
    return nodes, graph, facilities


def nearest_distances(nodes, graph, facilities):
    distances, queue = {}, []
    for facility in facilities:
        node = min(graph, key=lambda n: meters(nodes[n], facility["coordinates"]))
        connector = meters(nodes[node], facility["coordinates"])
        if connector > 300:  # Do not jump large gaps in the walking network.
            continue
        if connector < distances.get(node, math.inf):
            distances[node] = connector
            heapq.heappush(queue, (connector, node))
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != distances[node]:
            continue
        for neighbor, length in graph[node].items():
            new = cost + length
            if new < distances.get(neighbor, math.inf):
                distances[neighbor] = new
                heapq.heappush(queue, (new, neighbor))
    return distances


def calculate(projects):
    nodes, graph, facilities = walking_graph()
    if not graph:
        return dict(available=False, reason="В снимке нет пешеходного графа"), {}
    w, s, e, n = BBOX
    # One point per ~400 m cell, stable ordering; does not weight dense mapping more heavily.
    cells = {}
    for key in sorted(graph):
        lon, lat = nodes[key]
        if w <= lon <= e and s <= lat <= n:
            cell = (int((lon - w) / .006), int((lat - s) / .0036))
            cells.setdefault(cell, key)
    sample = list(cells.values())
    if not sample:
        return dict(available=False, reason="В пределах пилота нет контрольных точек"), {}
    metrics, layers = {}, {}
    for kind in ("school", "clinic", "park"):
        before_facilities = [f for f in facilities if f["kind"] == kind]
        added = [dict(id=p["id"], kind=kind, title=p["title"], coordinates=p["location"]) for p in projects if p["kind"] == kind]
        before = nearest_distances(nodes, graph, before_facilities)
        after = nearest_distances(nodes, graph, before_facilities + added)
        def summary(distances):
            times = [distances[key] / 80 for key in sample if key in distances]
            return dict(coveredPercent=round(100 * sum(t <= 15 for t in times) / len(sample), 1) if sample else None,
                        medianMinutes=round(statistics.median(times), 2) if times else None,
                        reachableSamples=len(times), totalSamples=len(sample))
        b, a = summary(before), summary(after)
        metrics[kind] = dict(before=b, after=a, deltaPercentagePoints=round(a["coveredPercent"] - b["coveredPercent"], 1),
                             improvedSamples=sum(after.get(key, math.inf) < before.get(key, math.inf) for key in sample),
                             existingFacilities=len(before_facilities), addedFacilities=len(added))
        layers[kind] = dict(type="FeatureCollection", features=[dict(type="Feature", geometry=dict(type="Point", coordinates=nodes[key]),
            properties=dict(beforeMinutes=round(before[key] / 80, 2) if key in before else None,
                            afterMinutes=round(after[key] / 80, 2) if key in after else None,
                            newlyCovered=before.get(key, math.inf) > 1200 and after.get(key, math.inf) <= 1200)) for key in sample])
    return dict(available=True, metrics=metrics, walkSpeedKmh=4.8, thresholdMinutes=15,
                method="OSM walking graph / multi-source Dijkstra / unweighted spatial samples",
                assumptions=["Доля контрольных точек в 15 минутах, не доля населения.",
                    "Пешком 4,8 км/ч; точка/среднее координат контура соединены с ближайшим узлом до 300 м, точный вход не известен.",
                    "Учтены OSM foot/access; тротуары, ограждения и входы могут быть неполными.",
                    "Мощность учреждений и нагрузка не рассчитываются."]), layers
