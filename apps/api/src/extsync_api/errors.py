"""Consistent error codes + a typed API exception with FastAPI handlers."""
from __future__ import annotations

from enum import StrEnum

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ErrorCode(StrEnum):
    # ---- generic ----
    BAD_REQUEST = "BAD_REQUEST"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL = "INTERNAL"

    # ---- auth ----
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"
    EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED"
    TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED"
    INVALID_TWO_FACTOR = "INVALID_TWO_FACTOR"
    INVALID_TOKEN = "INVALID_TOKEN"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    SESSION_EXPIRED = "SESSION_EXPIRED"

    # ---- platform domain (also shared with the Agent, spec §34) ----
    AGENT_OFFLINE = "AGENT_OFFLINE"
    DOWNLOAD_FAILED = "DOWNLOAD_FAILED"
    INVALID_SIGNATURE = "INVALID_SIGNATURE"
    HASH_MISMATCH = "HASH_MISMATCH"
    INVALID_ARCHIVE = "INVALID_ARCHIVE"
    INVALID_MANIFEST = "INVALID_MANIFEST"
    INSUFFICIENT_DISK_SPACE = "INSUFFICIENT_DISK_SPACE"
    FILE_LOCKED = "FILE_LOCKED"
    CHROME_NOT_FOUND = "CHROME_NOT_FOUND"
    EXTENSION_NOT_LOADED = "EXTENSION_NOT_LOADED"
    NATIVE_HOST_NOT_REGISTERED = "NATIVE_HOST_NOT_REGISTERED"
    BRIDGE_NOT_CONNECTED = "BRIDGE_NOT_CONNECTED"
    RELOAD_TIMEOUT = "RELOAD_TIMEOUT"
    ROLLBACK_FAILED = "ROLLBACK_FAILED"
    AGENT_UPDATE_REQUIRED = "AGENT_UPDATE_REQUIRED"
    PERMISSION_APPROVAL_REQUIRED = "PERMISSION_APPROVAL_REQUIRED"
    INSTALL_LINK_EXPIRED = "INSTALL_LINK_EXPIRED"
    INSTALL_LINK_LIMIT_REACHED = "INSTALL_LINK_LIMIT_REACHED"
    PROJECT_SUSPENDED = "PROJECT_SUSPENDED"
    RELEASE_REVOKED = "RELEASE_REVOKED"

    # ---- releases / state machine ----
    INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"
    RELEASE_NOT_READY = "RELEASE_NOT_READY"
    UPLOAD_TOO_LARGE = "UPLOAD_TOO_LARGE"

    # ---- likes quota (mitmachim.top meter) ----
    DUPLICATE_EVENT = "DUPLICATE_EVENT"
    LIMIT_REACHED = "LIMIT_REACHED"


class APIError(Exception):
    """Raise anywhere to return a structured error response."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status_code,
            content={
                "error": {
                    "code": self.code.value,
                    "message": self.message,
                    "details": self.details,
                }
            },
        )


# Common constructors -------------------------------------------------------
def not_found(message: str = "המשאב לא נמצא") -> APIError:
    return APIError(ErrorCode.NOT_FOUND, message, status_code=status.HTTP_404_NOT_FOUND)


def forbidden(message: str = "אין לך הרשאה לפעולה הזו") -> APIError:
    return APIError(ErrorCode.FORBIDDEN, message, status_code=status.HTTP_403_FORBIDDEN)


def unauthorized(message: str = "נדרשת הזדהות") -> APIError:
    return APIError(
        ErrorCode.UNAUTHORIZED, message, status_code=status.HTTP_401_UNAUTHORIZED
    )


def conflict(message: str, code: ErrorCode = ErrorCode.CONFLICT) -> APIError:
    return APIError(code, message, status_code=status.HTTP_409_CONFLICT)


def install_attach_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error_handler(_: Request, exc: APIError) -> JSONResponse:
        return exc.to_response()

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        # exc.errors() may embed non-serializable objects (e.g. a ValueError in
        # `ctx`). Project each error to a safe, stable shape.
        clean = [
            {
                "type": e.get("type"),
                "loc": list(e.get("loc", [])),
                "msg": e.get("msg"),
            }
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": ErrorCode.VALIDATION_ERROR.value,
                    "message": "הקלט אינו תקין",
                    "details": {"errors": clean},
                }
            },
        )
