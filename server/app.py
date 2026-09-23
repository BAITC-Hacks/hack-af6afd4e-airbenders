"""Local API and static frontend. Run: python -m server"""
import json
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .catalog import BBOX, PROJECTS, budget
from .data import ROOT, RUNTIME, SNAPSHOT, binary, ensure_snapshot, osm_objects, read_json, write_json
from .simulation import network, pilot_corridor, run

app = FastAPI(title="Astana SUMO Pilot", version="1.0.0")
pool = ThreadPoolExecutor(max_workers=1)
lock = threading.Lock()
active_job = None
jobs = {}


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    selectedProjectIds: list[str] = Field(default_factory=list, max_length=4)
    seed: int = Field(default=42, ge=0, le=2147483647, strict=True)
    vehicles: int = Field(default=600, ge=20, le=2000, strict=True)
    demandSeconds: int = Field(default=900, ge=300, le=1800, strict=True)
    busHeadwaySeconds: int = Field(default=120, ge=30, le=600, strict=True)
    horizonYears: int = Field(default=3, ge=1, le=5, strict=True)
    yearlyBudgetBnKzt: float = Field(default=120, gt=0, le=1000)

    @field_validator("selectedProjectIds")
    @classmethod
    def validate_projects(cls, value):
        allowed = {p["id"] for p in PROJECTS}
        if len(value) != len(set(value)) or set(value) - allowed:
            raise ValueError("Неизвестные или повторяющиеся проекты")
        return value


@app.middleware("http")
async def local_mutations(request: Request, call_next):
    # Only same-origin browser writes. Bind localhost; no permissive CORS or arbitrary proxy.
    if request.method == "POST":
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Недопустимый Origin"}, status_code=403)
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            return JSONResponse({"detail": "Ожидается application/json"}, status_code=415)
    return await call_next(request)


def save_status(job_id, **changes):
    with lock:
        jobs[job_id].update(changes)
        status = dict(jobs[job_id])
    write_json(RUNTIME / "runs" / job_id / "status.json", status)


def worker(job_id, options):
    global active_job
    folder = RUNTIME / "runs" / job_id
    try:
        save_status(job_id, status="running", message="Подготовка…")
        progress = lambda message: save_status(job_id, message=message)
        if options is None:
            result = dict(snapshot=ensure_snapshot(progress))
        else:
            result = run(options, folder, progress)
        result["jobId"] = job_id
        result["createdAt"] = datetime.now(timezone.utc).isoformat()
        write_json(folder / "result.json", result)
        save_status(job_id, status="completed", message="Готово")
    except Exception as exc:
        (folder / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
        save_status(job_id, status="failed", message=str(exc))
    finally:
        with lock:
            active_job = None


def submit(options):
    global active_job
    with lock:
        if active_job:
            raise HTTPException(409, detail={"message": "Уже выполняется расчёт", "jobId": active_job})
        job_id = uuid4().hex
        active_job = job_id
        jobs[job_id] = dict(jobId=job_id, status="queued", message="В очереди", kind="prepare" if options is None else "scenario")
    folder = RUNTIME / "runs" / job_id
    folder.mkdir(parents=True, exist_ok=True)
    write_json(folder / "request.json", options)
    save_status(job_id)
    pool.submit(worker, job_id, options)
    return dict(jobId=job_id, status="queued")


def job_folder(job_id):
    if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
        raise HTTPException(404, "Прогон не найден")
    folder = RUNTIME / "runs" / job_id
    if not (folder / "status.json").is_file():
        raise HTTPException(404, "Прогон не найден")
    return folder


@app.get("/api/v1/health")
def health():
    try:
        binary("sumo")
        binary("netconvert")
        installed = True
    except RuntimeError:
        installed = False
    return dict(sumoInstalled=installed, snapshotReady=(SNAPSHOT / "astana.net.xml").exists(), activeJobId=active_job)


@app.get("/api/v1/projects/catalog")
def catalog():
    return dict(projects=PROJECTS, bbox=BBOX, defaultBudgetBnKzt=120)


@app.post("/api/v1/prepare", status_code=202)
def prepare():
    return submit(None)


@app.get("/api/v1/city/snapshot")
def snapshot():
    if not (SNAPSHOT / "astana.net.xml").exists():
        raise HTTPException(409, "Сначала подготовьте OSM или запустите сценарий")
    _, _, facilities = osm_objects()
    return dict(metadata=read_json(SNAPSHOT / "metadata.json"), facilities=facilities,
                corridor=pilot_corridor(network()))


@app.post("/api/v1/scenarios/run", status_code=202)
def start_scenario(scenario: Scenario):
    options = scenario.model_dump()
    if not budget(options["selectedProjectIds"], options["yearlyBudgetBnKzt"], options["horizonYears"])["withinLimit"]:
        raise HTTPException(422, "CAPEX и OPEX превышают ежегодный учебный лимит")
    return submit(options)


@app.get("/api/v1/runs/{job_id}")
def status(job_id: str):
    folder = job_folder(job_id)
    with lock:
        state = dict(jobs[job_id]) if job_id in jobs else read_json(folder / "status.json")
    if state["status"] in ("queued", "running") and job_id != active_job:
        state.update(status="failed", message="Сервер был перезапущен. Запустите расчёт повторно.")
    return state


@app.get("/api/v1/runs/{job_id}/results")
def results(job_id: str):
    folder = job_folder(job_id)
    if status(job_id)["status"] != "completed":
        raise HTTPException(409, "Расчёт ещё не завершён")
    return FileResponse(folder / "result.json", media_type="application/json")


@app.get("/api/v1/runs/{job_id}/layers/{lens}")
def layer(job_id: str, lens: Literal["traffic", "school", "clinic", "park"]):
    folder = job_folder(job_id)
    path = folder / f"{lens}.geojson"
    if status(job_id)["status"] != "completed" or not path.is_file():
        raise HTTPException(409, "Слой ещё не готов")
    return FileResponse(path, media_type="application/geo+json")


@app.get("/")
@app.get("/index.html")
@app.get("/outputs/astana-3d/real-city.html")
def frontend():
    return FileResponse(ROOT / "index.html")


app.mount("/src", StaticFiles(directory=ROOT / "src"), name="src")
