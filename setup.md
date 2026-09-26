1 ESP32
- Add platformIO IDE extension (VSCode)
- Open project folder (gateway or node) using extension
    - *You may only work on one at time*
    - *To upload to esp use the platformIO extension on the left and go under devices, select port and click checkmark to run*

2 Portal-end (Backend Server)
- Install Python3
- CD inside portal-end/backend and run “pip install “fastapi[standard]””
    - *To run use command “fastapi dev” while CD inside folder*
- Run "python3 -m pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv"

3 Portal-end (Frontend Server)
- Install npm (https://nodejs.org/en/download)
- CD inside portal-end/responder-portal
- Alvy setup react in here please (I'm no expert 😞)
    - *What do I need to install?*