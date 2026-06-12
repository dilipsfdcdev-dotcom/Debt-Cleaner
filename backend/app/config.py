from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Async URL used by the FastAPI app (asyncpg driver)
    database_url: str = "postgresql+asyncpg://debt:debt@db:5432/debt_tracker"
    # Sync URL used by Alembic migrations (psycopg2 driver)
    database_url_sync: str = "postgresql+psycopg2://debt:debt@db:5432/debt_tracker"

    cors_origins: str = "*"


settings = Settings()
