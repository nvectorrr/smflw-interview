from fastapi import FastAPI
from mangum import Mangum

from smflw_api.api import account, photos, teams

app = FastAPI(title="Hot dog or not API", version="0.5.0")
app.include_router(account.router)
app.include_router(photos.router)
app.include_router(teams.router)

handler = Mangum(app, lifespan="off")
