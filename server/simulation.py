"""Real SUMO processes, paired demand and edge output for the browser."""
import hashlib
import json
import math
import random
import statistics
import xml.etree.ElementTree as ET
from pathlib import Path

import sumolib

from .accessibility import calculate, meters
from .catalog import MODEL_VERSION, PROJECTS, budget
from .data import SNAPSHOT, binary, command, ensure_snapshot, write_json


def network():
    return sumolib.net.readNet(str(SNAPSHOT / "astana.net.xml"))


def geo_shape(net, edge):
    return [list(net.convertXY2LonLat(x, y)) for x, y in edge.getShape()]


def pilot_corridor(net):
    """Pick a connected actual street around the nominated project coordinate."""
    origin = PROJECTS[0]["location"]
    edges = [edge for edge in net.getEdges() if edge.allows("bus") and edge.allows("passenger")
             and sum(lane.allows("passenger") for lane in edge.getLanes()) >= 2 and edge.getLength() > 80]
    if not edges:
        raise RuntimeError("В снимке нет улицы с двумя автомобильными полосами для пилота")
    anchor = min(edges, key=lambda edge: meters(geo_shape(net, edge)[len(edge.getShape()) // 2], origin))
    name = anchor.getName()
    nearby = [edge for edge in edges if (name and edge.getName() == name)
              and meters(geo_shape(net, edge)[0], origin) < 2500] or [anchor]
    best = None
    for start in nearby:
        for end in nearby:
            if start == end:
                continue
            route, _ = net.getFastestPath(start, end, vClass="bus")
            if not route or anchor not in route:
                continue
            length = sum(edge.getLength() for edge in route)
            if length > 6000:
                continue
            score = sum(edge.getLength() for edge in route if edge in nearby)
            if best is None or score > best[0]:
                best = (score, route)
    route = list(best[1]) if best else [anchor]
    affected = [edge for edge in route if edge in nearby and edge.getLanes()[0].allows("passenger")
                and edge.getLanes()[0].allows("bus")]
    if not affected:
        raise RuntimeError("Не найден подходящий коридор автобусной полосы")
    return dict(street=name or anchor.getID(), affectedLinks=[edge.getID() for edge in affected],
                routeLinks=[edge.getID() for edge in route], lengthMeters=round(sum(e.getLength() for e in affected)),
                geometry=dict(type="MultiLineString", coordinates=[geo_shape(net, edge) for edge in affected]))


def build_scenario(net, corridor, projects, folder):
    if not any(p["kind"] == "bus-lane" for p in projects):
        return SNAPSHOT / "astana.net.xml"
    root = ET.Element("edges")
    for edge_id in corridor["affectedLinks"]:
        edge = ET.SubElement(root, "edge", id=edge_id)
        ET.SubElement(edge, "lane", index="0", allow="bus")
    patch = folder / "bus-lane.edg.xml"
    ET.ElementTree(root).write(patch, encoding="utf-8", xml_declaration=True)
    output = folder / "scenario.net.xml"
    command([binary("netconvert"), "--sumo-net-file", SNAPSHOT / "astana.net.xml",
             "--edge-files", patch, "--output-file", output], folder)
    return output


def demand(net, options, corridor):
    rng = random.Random(options["seed"])
    # Edge length weighted uniform synthetic O/D. Not observed traffic counts.
    candidates = sorted([e for e in net.getEdges() if e.allows("passenger") and e.getLength() > 40], key=lambda e: e.getID())
    weights = [e.getLength() for e in candidates]
    trips, tries = [], 0
    while len(trips) < options["vehicles"] and tries < options["vehicles"] * 40:
        tries += 1
        start, end = rng.choices(candidates, weights=weights, k=2)
        if start == end:
            continue
        path, _ = net.getFastestPath(start, end, vClass="passenger")
        if not path or sum(e.getLength() for e in path) < 500:
            continue
        trips.append(dict(id=f"car-{len(trips)}", start=start.getID(), end=end.getID(),
                          depart=round(rng.random() * options["demandSeconds"], 2)))
    if len(trips) != options["vehicles"]:
        raise RuntimeError("Недостаточно связанных пар O/D в выбранном снимке")
    return sorted(trips, key=lambda t: (t["depart"], t["id"]))


def route_file(net, trips, corridor, options, folder):
    root = ET.Element("routes")
    ET.SubElement(root, "vType", id="car", vClass="passenger", emissionClass="HBEFA3/PC_G_EU4", speedFactor="1", speedDev="0")
    ET.SubElement(root, "vType", id="bus", vClass="bus", emissionClass="HBEFA3/Bus", speedFactor="1", speedDev="0")
    vehicles = []
    for trip in trips:
        path, _ = net.getFastestPath(net.getEdge(trip["start"]), net.getEdge(trip["end"]), vClass="passenger")
        if not path:
            raise RuntimeError(f"Проект разорвал маршрут {trip['id']}; сравнение остановлено")
        vehicles.append((trip["depart"], trip["id"], "car", path))
    bus_path = [net.getEdge(edge) for edge in corridor["routeLinks"]]
    for index, depart in enumerate(range(0, options["demandSeconds"], options["busHeadwaySeconds"])):
        vehicles.append((depart, f"bus-{index}", "bus", bus_path))
    for depart, vehicle_id, kind, path in sorted(vehicles, key=lambda t: (t[0], t[1])):
        vehicle = ET.SubElement(root, "vehicle", id=vehicle_id, type=kind, depart=str(depart), departLane="best", departSpeed="0")
        ET.SubElement(vehicle, "route", edges=" ".join(edge.getID() for edge in path))
        if kind == "bus":
            # Identical simple stop pattern in both runs; no real timetable/passenger model.
            for edge in path[::3]:
                if edge.getLength() > 60:
                    lanes = [lane for lane in edge.getLanes() if lane.allows("bus")]
                    ET.SubElement(vehicle, "stop", lane=lanes[0].getID(), endPos=str(round(edge.getLength() - 10, 2)), duration="20")
    path = folder / "routes.rou.xml"
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    return path, len(vehicles)


def simulate(net_path, trips, corridor, options, folder):
    folder.mkdir(parents=True, exist_ok=True)
    net = sumolib.net.readNet(str(net_path))
    routes, total = route_file(net, trips, corridor, options, folder)
    additional = ET.Element("additional")
    ET.SubElement(additional, "edgeData", id="traffic", file="edges.xml", excludeEmpty="true")
    ET.ElementTree(additional).write(folder / "output.add.xml", encoding="utf-8")
    end = options["demandSeconds"] + 3600
    # Write a GUI-loadable configuration as a reproducible artifact, too.
    config = ET.Element("configuration")
    inputs = ET.SubElement(config, "input")
    for tag, val in (("net-file", net_path), ("route-files", routes), ("additional-files", folder / "output.add.xml")):
        ET.SubElement(inputs, tag, value=str(val))
    ET.SubElement(ET.SubElement(config, "random_number"), "seed", value=str(options["seed"]))
    ET.SubElement(ET.SubElement(config, "time"), "end", value=str(end))
    config_path = folder / "simulation.sumocfg"
    ET.ElementTree(config).write(config_path, encoding="utf-8", xml_declaration=True)
    command([binary("sumo"), "-c", config_path, "--tripinfo-output", "trips.xml",
        "--tripinfo-output.write-unfinished", "true", "--tripinfo-output.write-undeparted", "true",
        "--device.emissions.probability", "1", "--statistic-output", "statistics.xml",
        "--duration-log.statistics", "true", "--no-step-log", "true", "--time-to-teleport", "-1"], folder, timeout=600)
    records = {}
    for trip in ET.parse(folder / "trips.xml").getroot().findall("tripinfo"):
        emissions = trip.find("emissions")
        departed = float(trip.get("depart", "-1")) >= 0
        records[trip.get("id")] = dict(kind=trip.get("vType"), departed=departed,
            completed=float(trip.get("arrival", "-1")) >= 0 and trip.get("vaporized", "") == "",
            duration=float(trip.get("duration", "0")), delay=float(trip.get("timeLoss", "0")),
            departDelay=float(trip.get("departDelay", "0")), waiting=float(trip.get("waitingTime", "0")),
            co2Kg=float(emissions.get("CO2_abs", "0")) / 1_000_000 if emissions is not None and departed else 0)
    edge_data = {}
    for edge in ET.parse(folder / "edges.xml").iter("edge"):
        edge_data[edge.get("id")] = {key: float(edge.get(key, "0")) for key in ("speed", "density", "waitingTime", "sampledSeconds")}
    stats = {}
    for kind in ("car", "bus"):
        all_trips = [r for r in records.values() if r["kind"] == kind]
        completed = [r for r in all_trips if r["completed"]]
        def mean(key):
            return round(statistics.mean(r[key] for r in completed), 2) if completed else None
        stats[kind] = dict(completed=len(completed), departed=sum(r["departed"] for r in all_trips),
            meanTravelSeconds=mean("duration"), meanDelaySeconds=mean("delay"), meanWaitingSeconds=mean("waiting"),
            meanDepartureDelaySeconds=mean("departDelay"))
    stats.update(expectedVehicles=total, completed=sum(r["completed"] for r in records.values()),
                 co2Kg=round(sum(r["co2Kg"] for r in records.values()), 3), simulationEndSeconds=end)
    stats["unfinished"] = total - stats["completed"]
    return stats, records, edge_data


def compare(net, before, after, affected):
    bstats, brecords, bedges = before
    astats, arecords, aedges = after
    metrics = {}
    for kind in ("car", "bus"):
        paired = sorted(key for key in brecords.keys() & arecords.keys()
                        if brecords[key]["completed"] and arecords[key]["completed"] and brecords[key]["kind"] == kind)
        metrics[kind] = dict(pairedCompletedTrips=len(paired))
        for key in ("duration", "delay", "waiting", "departDelay"):
            b = statistics.mean(brecords[i][key] for i in paired) if paired else None
            a = statistics.mean(arecords[i][key] for i in paired) if paired else None
            metrics[kind][key] = dict(before=round(b, 2) if b is not None else None,
                after=round(a, 2) if a is not None else None, delta=round(a - b, 2) if a is not None else None, unit="seconds")
    features = []
    for edge in net.getEdges():
        b, a = bedges.get(edge.getID()), aedges.get(edge.getID())
        bspeed = round(b["speed"] * 3.6, 2) if b and b["sampledSeconds"] > 0 else None
        aspeed = round(a["speed"] * 3.6, 2) if a and a["sampledSeconds"] > 0 else None
        features.append(dict(type="Feature", geometry=dict(type="LineString", coordinates=geo_shape(net, edge)),
            properties=dict(edgeId=edge.getID(), name=edge.getName(), before=bspeed, after=aspeed,
                delta=round(aspeed - bspeed, 2) if bspeed is not None and aspeed is not None else None,
                speedLimitKmh=round(edge.getSpeed() * 3.6, 2), busLane=edge.getID() in affected,
                unit="km/h", beforeSampledSeconds=b["sampledSeconds"] if b else 0,
                afterSampledSeconds=a["sampledSeconds"] if a else 0)))
    return dict(before=bstats, after=astats, paired=metrics,
        co2DeltaKg=round(astats["co2Kg"] - bstats["co2Kg"], 3),
        comparisonComplete=bstats["unfinished"] == 0 and astats["unfinished"] == 0), dict(type="FeatureCollection", features=features)


def run(options, folder, progress):
    snapshot = ensure_snapshot(progress)
    folder.mkdir(parents=True, exist_ok=True)
    finance = budget(options["selectedProjectIds"], options["yearlyBudgetBnKzt"], options["horizonYears"])
    if not finance["withinLimit"]:
        raise ValueError("CAPEX и OPEX превышают ежегодный учебный лимит")
    net = network()
    corridor = pilot_corridor(net)
    projects = [p for p in PROJECTS if p["id"] in options["selectedProjectIds"] and p["openingYear"] <= options["horizonYears"]]
    version = command([binary("sumo"), "--version"], folder).splitlines()[0]
    progress("Подготовка одинаковых поездок и автобусного коридора…")
    trips = demand(net, options, corridor)
    write_json(folder / "demand.json", trips)
    scenario_net = build_scenario(net, corridor, projects, folder)
    progress("SUMO: базовый прогон…")
    before = simulate(SNAPSHOT / "astana.net.xml", trips, corridor, options, folder / "before")
    progress("SUMO: прогон выбранного сценария…")
    after = simulate(scenario_net, trips, corridor, options, folder / "after")
    active_links = corridor["affectedLinks"] if any(p["kind"] == "bus-lane" for p in projects) else []
    traffic, traffic_layer = compare(net, before, after, active_links)
    progress("Расчёт пешей доступности школы, поликлиники и парка…")
    access, access_layers = calculate(projects)
    layers = dict(traffic=traffic_layer, **access_layers)
    for name, layer in layers.items():
        write_json(folder / f"{name}.geojson", layer)
    assumptions = [
        "Пилот центральной Астаны; OSM-снимок на дату загрузки, не исторический baseline 2024.",
        "Синтетические O/D: случайные пары дорог с весом по длине, одинаковые seed, отправления и типы машин до/после.",
        "Сеть стартует пустой, без прогрева. Параметры перекрёстков и недостающие теги OSM восстановлены netconvert, без калибровки.",
        "Маршруты пересчитываются по свободному времени; динамическое перераспределение спроса и выбор вида транспорта не моделируются.",
        "Проект автобусной полосы резервирует правую полосу выбранных многополосных участков только для автобусов.",
        "Одинаковый условный автобусный маршрут в обоих прогонах; остановки по 20 с, без модели пассажиров.",
        "Все машины HBEFA3/PC_G_EU4, автобусы HBEFA3/Bus; CO₂ за прогон, не AQI и не годовой прогноз.",
        "Средние изменения считаются по одним и тем же завершившим поездку автомобилям/автобусам.",
        "Школа, поликлиника и парк меняют пешую доступность; порождённые ими поездки пока не моделируются."]
    if not traffic["comparisonComplete"]:
        assumptions.append("Есть незавершённые поездки: средние относятся только к завершившим обе поездки, суммарный CO₂ нельзя трактовать как экономию при равном обслуженном спросе.")
    return dict(snapshot=snapshot, options=options, budget=finance, transport=traffic, accessibility=access,
        corridor=corridor, sumoVersion=version, modelVersion=MODEL_VERSION,
        networkSha256=hashlib.sha256((SNAPSHOT / "astana.net.xml").read_bytes()).hexdigest(),
        demandSha256=hashlib.sha256(json.dumps(trips, sort_keys=True).encode()).hexdigest(),
        assumptions=assumptions, layerNames=list(layers), confidence="synthetic-demand-uncalibrated")
