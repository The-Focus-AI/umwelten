import unittest
from minisql import Database, execute_sql


class PublicMiniSqlTest(unittest.TestCase):
    def _db(self) -> Database:
        db = Database()
        db.create_table(
            "users",
            [
                {"id": 1, "name": "Alice", "tier": "pro"},
                {"id": 2, "name": "Bob", "tier": "free"},
                {"id": 3, "name": "Cara", "tier": "pro"},
            ],
        )
        db.create_table(
            "orders",
            [
                {"id": 10, "user_id": 1, "amount": 50},
                {"id": 11, "user_id": 1, "amount": 30},
                {"id": 12, "user_id": 3, "amount": 20},
            ],
        )
        return db

    def test_basic_select_where_and_inner_join(self) -> None:
        db = self._db()
        rows = execute_sql(
            db,
            "SELECT u.name, o.amount FROM users u INNER JOIN orders o ON u.id = o.user_id WHERE u.tier = 'pro' ORDER BY o.amount ASC",
        )
        self.assertEqual(
            rows,
            [
                {"name": "Cara", "amount": 20},
                {"name": "Alice", "amount": 30},
                {"name": "Alice", "amount": 50},
            ],
        )

    def test_basic_group_by_count(self) -> None:
        db = self._db()
        rows = execute_sql(
            db,
            "SELECT tier, COUNT(*) AS cnt FROM users GROUP BY tier ORDER BY tier ASC",
        )
        self.assertEqual(
            rows,
            [{"tier": "free", "cnt": 1}, {"tier": "pro", "cnt": 2}],
        )


if __name__ == "__main__":
    unittest.main()
