"""分析派送：{script, arguments} -> {exitCode, output, error}，由 apps/api/runner.py 在行程池內呼叫。"""
import io
import sys
import traceback
from contextlib import redirect_stdout, redirect_stderr

import od_postgres
import query_od
import analyze_od
import station_info
import leaders


def dispatch(request):
    script, args = request['script'], request['arguments']
    output, errors = io.StringIO(), io.StringIO()
    code = 0
    with redirect_stdout(output), redirect_stderr(errors):
        try:
            if script == 'station_info.py':
                station_info.query(args[0], args[1] if len(args) > 1 else None)
            else:
                {'query_od.py': query_od.main, 'analyze_od.py': analyze_od.main, 'leaders.py': leaders.main,
                 'od_postgres.py': od_postgres.main}[script](args)
        except SystemExit as error:
            code = error.code if isinstance(error.code, int) else 1
        except od_postgres.MonthNotFound as error:
            code = 3
            print(error, file=sys.stderr)
        except od_postgres.psycopg.errors.QueryCanceled as error:
            code = 6
            print(error, file=sys.stderr)
        except ValueError as error:
            code = 2
            print(error, file=sys.stderr)
        except Exception:
            code = 1
            traceback.print_exc()
    return {'exitCode': code, 'output': output.getvalue(), 'error': errors.getvalue()}
