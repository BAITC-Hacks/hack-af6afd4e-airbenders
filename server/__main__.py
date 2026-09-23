import argparse
import uvicorn
from .data import ensure_snapshot

parser = argparse.ArgumentParser(description="Local Astana SUMO pilot")
parser.add_argument("--prepare", action="store_true", help="Download/cache OSM and build SUMO network")
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()
if args.prepare:
    print(ensure_snapshot(print))
else:
    uvicorn.run("server.app:app", host="127.0.0.1", port=args.port)
