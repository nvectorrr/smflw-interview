from smflw_api.settings import get_settings
from supabase import Client, create_client


def get_supabase() -> Client:
    settings = get_settings()
    return create_client(
        str(settings.supabase_url),
        settings.supabase_publishable_key.get_secret_value(),
    )
