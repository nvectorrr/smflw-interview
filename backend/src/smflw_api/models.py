"""Public model choices and their server-controlled provider IDs."""

from typing import Literal

from fastapi import HTTPException

from smflw_api.settings import Settings

ModelKey = Literal["haiku", "sonnet"]


def resolve_model(settings: Settings, model: str) -> tuple[Settings, str]:
    if model == "haiku":
        model_id = settings.anthropic_model
    elif model == "sonnet":
        model_id = settings.anthropic_sonnet_model
    else:
        raise HTTPException(422, "Choose a supported classification model.")
    return settings.model_copy(update={"anthropic_model": model_id}), model_id


def get_models(settings: Settings) -> list[dict]:
    return [
        {"model": "haiku", "name": "Quick Bite", "model_id": settings.anthropic_model},
        {
            "model": "sonnet",
            "name": "The Food Inspector",
            "model_id": settings.anthropic_sonnet_model,
        },
    ]
