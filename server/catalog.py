"""Explicit pilot assumptions; all money is in billions of KZT."""

BBOX = (71.39, 51.105, 71.48, 51.17)  # west, south, east, north
MODEL_VERSION = "astana-pilot-1"
PROJECTS = [
    dict(id="brt", title="Автобусная полоса · пилот", sector="транспорт",
         capexBnKzt=18, annualOpexBnKzt=0.8, openingYear=1,
         location=[71.431, 51.129], kind="bus-lane"),
    dict(id="school-esil", title="Новая школа · пилот", sector="образование",
         capexBnKzt=12, annualOpexBnKzt=0.6, openingYear=1,
         location=[71.453, 51.158], kind="school"),
    dict(id="park", title="Новый парк · пилот", sector="зелёные зоны",
         capexBnKzt=9, annualOpexBnKzt=0.18, openingYear=1,
         location=[71.477, 51.108], kind="park"),
    dict(id="clinic-nura", title="Новая поликлиника · пилот", sector="медицина",
         capexBnKzt=15, annualOpexBnKzt=0.9, openingYear=1,
         location=[71.412, 51.17], kind="clinic"),
]


def budget(project_ids, yearly_limit, years):
    selected = [p for p in PROJECTS if p["id"] in project_ids]
    rows = []
    for year in range(1, years + 1):
        capex = sum(p["capexBnKzt"] for p in selected) if year == 1 else 0
        opex = sum(p["annualOpexBnKzt"] for p in selected if p["openingYear"] <= year)
        rows.append(dict(year=year, capexBnKzt=round(capex, 2), opexBnKzt=round(opex, 2),
                         remainingBnKzt=round(yearly_limit - capex - opex, 2)))
    return dict(years=rows, selectedCount=len(selected),
                capexBnKzt=round(sum(p["capexBnKzt"] for p in selected), 2),
                totalOpexBnKzt=round(sum(r["opexBnKzt"] for r in rows), 2),
                withinLimit=all(r["remainingBnKzt"] >= 0 for r in rows),
                yearlyLimitBnKzt=yearly_limit, assumptions=[
                    "Учебный ежегодный лимит; CAPEX и OPEX — допущения, не городская смета.",
                    "CAPEX оплачивается в первый год; содержание — ежегодно после ввода."])
