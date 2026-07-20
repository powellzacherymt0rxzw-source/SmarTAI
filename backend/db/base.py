from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import model modules so Base.metadata is complete for create_all and Alembic.
from backend.db import models as _models  # noqa: E402,F401
