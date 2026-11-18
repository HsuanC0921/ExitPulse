"""連線池的交易回復與斷線重連整合測試。"""
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import od_postgres

POSTGRES = os.getenv('EXITPULSE_DATABASE_URL') or os.getenv('PGDATABASE')


@unittest.skipUnless(POSTGRES, 'PostgreSQL connection not configured')
class WorkerTests(unittest.TestCase):
    def test_pool_reuses_rolls_back_and_reconnects_its_own_terminated_socket(self):
        pool = od_postgres.ConnectionPool()
        try:
            self.assertEqual(len(pool.connections), 2)
            with pool.connection() as db:
                pid = db.info.backend_pid
                od_postgres.search_schema(db, 'exitpulse_ref')
            with pool.connection() as db:
                self.assertEqual(db.info.backend_pid, pid)
                self.assertNotIn('exitpulse_ref', db.execute('SHOW search_path').fetchone()[0])
            with self.assertRaises(od_postgres.psycopg.errors.DivisionByZero):
                with pool.connection() as db:
                    db.execute('SELECT 1/0')
            with pool.connection() as db:
                self.assertEqual(db.execute('SELECT 7').fetchone()[0], 7)
            # Only terminate this test's idle connection, never other service backends.
            with od_postgres.database() as control:
                control.execute('SELECT pg_terminate_backend(%s)', (pid,))
            with pool.connection() as db:
                self.assertNotEqual(db.info.backend_pid, pid)
                self.assertEqual(db.execute('SELECT 9').fetchone()[0], 9)
        finally:
            pool.close()
