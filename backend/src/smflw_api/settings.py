from functools import lru_cache

from pydantic import HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: HttpUrl
    supabase_publishable_key: SecretStr
    supabase_service_key: SecretStr | None = None
    cleanup_queue_url: str | None = None
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-haiku-5-5"
    anthropic_sonnet_model: str = "claude-sonnet-5-5"
    aws_region: str = "eu-central-1"
    public_web_url: HttpUrl = "http://127.0.0.1:5173"
    image_bucket: str = "hotdog-local"
    s3_endpoint_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
