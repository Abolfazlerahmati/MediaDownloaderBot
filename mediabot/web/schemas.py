"""Request bodies for the admin API. Field-level validation lives in the domain modules."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=512)


class PasswordBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=1, max_length=512)


class AppearanceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: str = Field(pattern="^(merchant|ios)$")
    mode: str = Field(pattern="^(light|dark|system)$")


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    changes: dict[str, Any] = Field(default_factory=dict)


class EnableBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class UrlCheckBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)


class TokenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=200)


class ConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: str = Field(default="")
