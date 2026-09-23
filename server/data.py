"""A local, versioned OSM snapshot. Public services are used only on preparation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from .catalog import BBOX, MODEL_VERSION

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
SNAPSHOT = RUNTIME / "snapshot"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


def binary(name):
    """Support a pip wheel, SUMO_HOME or a system installation."""
    candidate = shutil.which(name)
    if candidate:
        return candidate
    locations = []
    if os.environ.get("SUMO_HOME"):
        locations.append(Path(os.environ["SUMO_HOME"]) / "bin")
    try:
        import sumo
        locations.append(Path(sumo.__file__).parent / "bin")
    except ImportError:
        pass
    for folder in locations:
        for suffix in (".exe", ""):
            path = folder / (name + suffix)
            if path.is_file():
                return str(path)
    raise RuntimeError(f"{name} не найден. Установите requirements.txt или задайте SUMO_HOME.")


def command(args, folder, timeout=240):
    folder.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(a) for a in args], cwd=folder, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=timeout,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    with (folder / "commands.log").open("a", encoding="utf-8") as handle:
        handle.write("\n" + subprocess.list2cmdline([str(a) for a in args]) + "\n")
        handle.write(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name}: {result.stderr[-1800:]}")
    return result.stdout


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    tmp.replace(path)


def ensure_snapshot(progress=lambda message: None):
    SNAPSHOT.mkdir(parents=True, exist_ok=True)
    osm = SNAPSHOT / "astana.osm.xml"
    meta_path = SNAPSHOT / "metadata.json"
    if not osm.exists():
        progress("Загрузка дорожной сети и учреждений из OpenStreetMap…")
        w, s, e, n = BBOX
        box = f"({s},{w},{n},{e})"
        query = f'[out:xml][timeout:90];(way["highway"]{box};nwr["amenity"~"^(school|clinic|hospital)$"]{box};nwr["leisure"="park"]{box};);(._;>;);out body;'
        failures = []
        for endpoint in OVERPASS:
            try:
                req = urllib.request.Request(endpoint, data=urllib.parse.urlencode({"data": query}).encode(),
                    headers={"User-Agent": "AstanaCitySystems-pilot/1.0", "Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=120) as response:
                    raw = response.read(40_000_001)
                if len(raw) > 40_000_000:
                    raise ValueError("Снимок превышает лимит 40 MB")
                root = ET.fromstring(raw)
                if root.tag != "osm" or root.find("remark") is not None or root.find("way") is None:
                    raise ValueError("Overpass не вернул дорожную сеть")
                sha = hashlib.sha256(raw).hexdigest()
                write_json(meta_path, dict(id="osm-astana-" + sha[:12], sha256=sha, bbox=BBOX,
                    downloadedAt=datetime.now(timezone.utc).isoformat(), source="OpenStreetMap contributors",
                    sourceUrl="https://www.openstreetmap.org/copyright", endpoint=endpoint,
                    license="ODbL-1.0", query=query, osmTimestamp=root.find("meta").get("osm_base") if root.find("meta") is not None else None,
                    modelVersion=MODEL_VERSION))
                temp = osm.with_suffix(".tmp")
                temp.write_bytes(raw)
                temp.replace(osm)
                break
            except Exception as exc:
                failures.append(f"{endpoint}: {exc}")
        else:
            raise RuntimeError("Не удалось загрузить OSM. Повторите подготовку позже. " + "; ".join(failures))
    network = SNAPSHOT / "astana.net.xml"
    build_path = SNAPSHOT / "network-build.json"
    build_config = dict(version="motor-network-1", bbox=list(BBOX), osmSha256=read_json(meta_path)["sha256"])
    if not network.exists() or not build_path.exists() or read_json(build_path) != build_config:
        progress("netconvert: построение сети SUMO…")
        temporary = SNAPSHOT / "building.net.xml"
        command([binary("netconvert"), "--osm-files", osm, "--output-file", temporary,
                 "--geometry.remove", "--junctions.join", "--tls.guess-signals",
                 "--tls.discard-simple", "--tls.join", "--tls.default-type", "actuated",
                 "--keep-edges.by-vclass", "passenger,bus",
                 "--keep-edges.in-geo-boundary", ",".join(map(str, BBOX)),
                 "--no-turnarounds", "--output.street-names", "true"], SNAPSHOT)
        temporary.replace(network)
        write_json(build_path, build_config)
    return read_json(meta_path)


def osm_objects():
    root = ET.parse(SNAPSHOT / "astana.osm.xml").getroot()
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.findall("node")}
    ways = {w.get("id"): [n.get("ref") for n in w.findall("nd") if n.get("ref") in nodes]
            for w in root.findall("way")}
    facilities, highways = [], []
    for obj in root:
        tags = {t.get("k"): t.get("v") for t in obj.findall("tag")}
        if obj.tag == "way" and "highway" in tags:
            highways.append((ways[obj.get("id")], tags))
        kind = tags.get("amenity")
        if tags.get("leisure") == "park":
            kind = "park"
        if kind not in ("school", "clinic", "hospital", "park"):
            continue
        refs = ([obj.get("id")] if obj.tag == "node" else ways.get(obj.get("id"), []) if obj.tag == "way"
                else [ref for member in obj.findall("member") if member.get("type") == "way"
                      for ref in ways.get(member.get("ref"), [])])
        points = [nodes[ref] for ref in set(refs) if ref in nodes]
        if not points:
            continue
        coord = [sum(p[i] for p in points) / len(points) for i in (0, 1)]
        facilities.append(dict(id=f"{obj.tag}/{obj.get('id')}", kind="clinic" if kind == "hospital" else kind,
                               title=tags.get("name", kind), coordinates=coord))
    return nodes, highways, facilities
