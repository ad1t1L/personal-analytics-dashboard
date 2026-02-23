from sqlalchemy import create_engine, text

DATABASE_URL = "mysql+pymysql://root:Richbrian88%21@localhost:3306/plannerhub"

engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        print("DB Connected:", result.scalar())
except Exception as e:
    print("DB Connection Failed:")
    print(e)