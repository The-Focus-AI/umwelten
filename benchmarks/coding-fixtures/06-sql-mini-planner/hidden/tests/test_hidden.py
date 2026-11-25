import unittest
from minisql import Database, execute_sql


class HiddenMiniSqlTest(unittest.TestCase):
    def _db(self) -> Database:
        db = Database()
        db.create_table(
            "users",
            [
                {"id": 1, "name": "Alice", "dept": "eng"},
                {"id": 2, "name": "Bob", "dept": "sales"},
                {"id": 3, "name": "Cara", "dept": None},
            ],
        )
        db.create_table(
            "orders",
            [
                {"id": 100, "user_id": 1, "status": "paid", "amount": 50},
                {"id": 101, "user_id": 1, "status": "open", "amount": None},
                {"id": 102, "user_id": 2, "status": "open", "amount": 20},
            ],
        )
        return db

    def test_three_valued_null_logic_in_where(self) -> None:
        db = self._db()
        # NULL = NULL and NULL != 'eng' are UNKNOWN (falsy in WHERE)
        self.assertEqual(
            execute_sql(db, "SELECT name FROM users WHERE dept = NULL"),
            [],
        )
        self.assertEqual(
            execute_sql(db, "SELECT name FROM users WHERE dept != 'eng' ORDER BY name ASC"),
            [{"name": "Bob"}],
        )
        # NOT NULL is UNKNOWN -> Cara (dept is None) must NOT match `NOT (dept = 'eng')`
        self.assertEqual(
            execute_sql(db, "SELECT name FROM users WHERE NOT (dept = 'eng') ORDER BY name ASC"),
            [{"name": "Bob"}],
        )
        # TRUE OR NULL -> TRUE (matches Cara too if left branch holds)
        self.assertEqual(
            execute_sql(
                db,
                "SELECT name FROM users WHERE id = 3 OR dept = 'sales' ORDER BY name ASC",
            ),
            [{"name": "Bob"}, {"name": "Cara"}],
        )
        # Explicit IS NULL matches Cara
        self.assertEqual(
            execute_sql(db, "SELECT name FROM users WHERE dept IS NULL"),
            [{"name": "Cara"}],
        )
        # False AND (NULL = NULL) -> False, so NOT (False AND NULL) -> TRUE!
        self.assertEqual(
            execute_sql(
                db,
                "SELECT name FROM users WHERE NOT (id = 999 AND dept = 'eng') AND dept IS NULL",
            ),
            [{"name": "Cara"}],
        )

    def test_left_join_with_right_table_where_anti_join_and_filter(self) -> None:
        db = self._db()
        # Anti-join: find users with zero orders!
        anti = execute_sql(
            db,
            "SELECT u.name FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE o.id IS NULL",
        )
        self.assertEqual(anti, [{"name": "Cara"}])

        # Filter right-table column in WHERE turns LEFT JOIN effectively into matching paid rows only (NO unmatched Bob/Cara)
        paid = execute_sql(
            db,
            "SELECT u.name, o.amount FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE o.status = 'paid'",
        )
        self.assertEqual(paid, [{"name": "Alice", "amount": 50}])

    def test_null_aware_aggregates_and_having_evaluation(self) -> None:
        db = self._db()
        # Alice has 2 orders (amounts 50 and None), Bob has 1 order (amount 20)
        rows = execute_sql(
            db,
            "SELECT o.user_id, COUNT(*) AS all_cnt, COUNT(o.amount) AS non_null_cnt, SUM(o.amount) AS total, AVG(o.amount) AS avg_amt FROM orders o GROUP BY o.user_id HAVING COUNT(o.amount) >= 1 ORDER BY o.user_id ASC",
        )
        self.assertEqual(
            rows,
            [
                {"user_id": 1, "all_cnt": 2, "non_null_cnt": 1, "total": 50, "avg_amt": 50.0},
                {"user_id": 2, "all_cnt": 1, "non_null_cnt": 1, "total": 20, "avg_amt": 20.0},
            ],
        )

        # Group where EVERY amount is NULL -> SUM/AVG/MIN/MAX return None, not 0
        db.create_table(
            "only_nulls",
            [{"grp": "g1", "val": None}, {"grp": "g1", "val": None}],
        )
        null_aggs = execute_sql(
            db,
            "SELECT grp, COUNT(*) AS rows_cnt, COUNT(val) AS val_cnt, SUM(val) AS s, AVG(val) AS a, MIN(val) AS mn, MAX(val) AS mx FROM only_nulls GROUP BY grp",
        )
        self.assertEqual(
            null_aggs,
            [{"grp": "g1", "rows_cnt": 2, "val_cnt": 0, "s": None, "a": None, "mn": None, "mx": None}],
        )

        # HAVING cannot be pushed into WHERE (WHERE doesn't filter groups on aggregate)
        filtered = execute_sql(
            db,
            "SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id HAVING SUM(amount) > 30",
        )
        self.assertEqual(filtered, [{"user_id": 1, "total": 50}])

    def test_empty_input_aggregate_with_vs_without_group_by(self) -> None:
        db = self._db()
        # Ungrouped aggregate on empty result emits 1 row: COUNT(*)=0, SUM/AVG=None
        ungrouped = execute_sql(
            db,
            "SELECT COUNT(*) AS cnt, COUNT(amount) AS non_null, SUM(amount) AS total FROM orders WHERE amount > 9999",
        )
        self.assertEqual(ungrouped, [{"cnt": 0, "non_null": 0, "total": None}])

        # Grouped aggregate on empty result emits 0 rows
        grouped = execute_sql(
            db,
            "SELECT user_id, COUNT(*) AS cnt FROM orders WHERE amount > 9999 GROUP BY user_id",
        )
        self.assertEqual(grouped, [])


if __name__ == "__main__":
    unittest.main()
