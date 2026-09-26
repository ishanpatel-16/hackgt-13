1 ESP32
- Add platformIO IDE extension (VSCode)
- Open project folder (gateway or node) using extension
    - *You may only work on one at time*
    - *To upload to esp use the platformIO extension on the left and go under devices, select port and click checkmark to run*

2 Portal-end (Backend Server)
- Install Python3
- CD inside portal-end/backend and run “pip install “fastapi[standard]””
    - *To run use command “fastapi dev” while CD inside folder*
- Run "python3 -m pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv alembic bleak"
- **SQL Debug Lab** (simple page to test DB without hardware):
    - Start backend: `fastapi dev` then open http://localhost:8000/debug
    - CRUD: create/edit/delete Reports/Nodes/Users/Messages, view stats, fake heartbeat/report injection
    - API docs: http://localhost:8000/docs
- **Share local SQLite with team (seed_data.json workflow)**:
    - `portal.db` stays gitignored. Share `seed_data.json` instead.
    - Export: `python scripts/export_db.py` (produces `seed_data.json`) → commit & push
    - Import (teammate after pull): `alembic upgrade head && python scripts/seed_db.py` or `bash scripts/setup.sh` (one cmd)
    - Schema changed? Edit `models/*.py` then: `alembic revision --autogenerate -m "describe"` → `alembic upgrade head` → `python scripts/export_db.py` → commit both `alembic/versions/*` and `seed_data.json`
    - In-browser also: Export / Import buttons on /debug, `POST /api/debug/reset`, `POST /api/debug/seed_random?count=5`
    - Disable debug routes in prod: `DEBUG=0 fastapi dev`

3 Portal-end (Frontend Server)
- Install npm (https://nodejs.org/en/download)
- CD inside portal-end/responder-portal
- Alvy setup react in here please (I'm no expert 😞)
    - *What do I need to install?*