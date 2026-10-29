from typing import Annotated

from fastapi import Depends

from smflw_api.auth import AuthUser, require_user
from smflw_api.settings import Settings, get_settings

AppSettings = Annotated[Settings, Depends(get_settings)]
CurrentUser = Annotated[AuthUser, Depends(require_user)]
